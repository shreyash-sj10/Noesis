const User = require("../models/user.model");
const Holding = require("../models/holding.model");
const Trade = require("../models/trade.model");
const { getLivePrices, getLivePricesForPortfolio } = require("../services/marketData.service");
const Decimal = require("decimal.js");
const { analyzeBehavior } = require("../services/behavior.engine");
const { analyzeProgression } = require("../services/progression.engine");
const { calculateSkillScore } = require("../services/skill.engine");
const { normalizeTrade } = require("../domain/trade.contract");
const { mapToClosedTrades } = require("../domain/closedTrade.mapper");
const { analyzeReflection } = require("../engines/reflection.engine");
const {
  derivePortfolioPositionsState,
  derivePortfolioSummaryState,
} = require("../utils/systemState");
const { SYSTEM_STATE } = require("../constants/systemState");
const { adaptPortfolio, adaptPositions } = require("../adapters/portfolio.adapter");
const { ANALYTICS_SNAPSHOT_VALID_MS } = require("../constants/analyticsSnapshot.constants");
const { RECENT_TRADE_SNAPSHOT_BYPASS_MS } = require("../constants/systemConvergence.constants");
const logger = require("../utils/logger");
const { sendSuccess } = require("../utils/response.helper");

const PORTFOLIO_LIVE_PRICES_MAX_MS = 8000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(null), ms);
    }),
  ]);
}

/** Never fail portfolio HTTP because Yahoo throttled; MTM falls back to avg cost. */
async function safeLivePrices(symbols, { forPositions = false } = {}) {
  if (!symbols.length) return {};
  const fetcher = forPositions ? getLivePricesForPortfolio : getLivePrices;
  const budgetMs = forPositions ? PORTFOLIO_LIVE_PRICES_MAX_MS : PORTFOLIO_LIVE_PRICES_MAX_MS * 2;
  try {
    const result = await withTimeout(fetcher(symbols), budgetMs);
    if (result === null) {
      logger.warn({
        action: "PORTFOLIO_LIVE_PRICES_TIMEOUT",
        symbolCount: symbols.length,
        budgetMs,
        forPositions,
      });
      return {};
    }
    return result;
  } catch (err) {
    logger.warn({
      action: "PORTFOLIO_LIVE_PRICES_FALLBACK",
      message: err?.message || String(err),
      symbolCount: symbols.length,
    });
    return {};
  }
}

// buildClosedTrades has been replaced by src/domain/closedTrade.mapper.js

const getPortfolioSummary = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).lean();

    if (!user) {
      return sendSuccess(res, req, { success: false, message: "User not found" }, 404);
    }
    const holdingsDocs = await Holding.find({ userId }).lean();

    const winRatePromise = computeWinRate(userId);
    const pendingTradePromise = Trade.find({
      user: userId,
      status: "PENDING_EXECUTION",
    })
      .sort({ createdAt: -1 })
      .select("symbol type quantity pricePaise totalValuePaise status createdAt _id preTradeEmotion")
      .lean();

    // 1. Get Live Prices
    const holdingSymbols = holdingsDocs.map((h) => h.symbol);
    const livePrices = await safeLivePrices(holdingSymbols, { forPositions: true });

    // 2. Compute MTM
    let unrealizedPnL = new Decimal(0);
    let currentEquityValue = new Decimal(0);

    holdingsDocs.forEach((data) => {
      const symbol = data.symbol;
      const liveQuote = livePrices[symbol];
      const livePrice = liveQuote?.pricePaise;
      const effectivePrice = livePrice !== undefined ? livePrice : data.avgPricePaise;
      const marketValue = new Decimal(data.quantity).mul(effectivePrice);
      const costBasis = new Decimal(data.quantity).mul(data.avgPricePaise);
      const gain = marketValue.sub(costBasis);
      unrealizedPnL = unrealizedPnL.add(gain);
      currentEquityValue = currentEquityValue.add(marketValue);
    });

    // 3. Aggregate Behavioral Insights (PHASE 3: Snapshot First)
    let behavior, progression, skillAudit;
    const snapshotMs = user.analyticsSnapshot?.lastUpdated
      ? new Date(user.analyticsSnapshot.lastUpdated).getTime()
      : 0;
    const lastActMs = user.lastTradeActivityAt ? new Date(user.lastTradeActivityAt).getTime() : 0;
    const recentTradeWindow = lastActMs && Date.now() - lastActMs < RECENT_TRADE_SNAPSHOT_BYPASS_MS;
    const tradeNewerThanSnapshot = lastActMs && lastActMs > snapshotMs;
    const snapshotBypassed = Boolean(recentTradeWindow || tradeNewerThanSnapshot);
    const hasValidSnapshot =
      !snapshotBypassed &&
      user.analyticsSnapshot &&
      Date.now() - snapshotMs < ANALYTICS_SNAPSHOT_VALID_MS;
    
    let recentBehaviors = [];
    let journalInsights = { topMistake: "NONE", frequency: 0, last10Summary: { winRate: 0, avgPnL: 0 }, timePatterns: "INSUFFICIENT_DATA", disciplineTrend: "STABLE" };

    if (hasValidSnapshot) {
       logger.info("Portfolio snapshot analysis fulfilled from cache", { 
         action: "PORTFOLIO_SNAPSHOT_HIT", 
         userId: user._id, 
         source: "SNAPSHOT" 
       });


       skillAudit = {
         score: user.analyticsSnapshot.skillScore,
         trend: user.analyticsSnapshot.trend,
         breakdown: { discipline: user.analyticsSnapshot.disciplineScore }
       };
       // H-10 read-path: prefer behaviorTags (post-fix snapshots); fall back to tags for legacy rows.
       behavior = {
         success: true,
         patterns: (
           Array.isArray(user.analyticsSnapshot.behaviorTags) &&
           user.analyticsSnapshot.behaviorTags.length > 0
             ? user.analyticsSnapshot.behaviorTags
             : user.analyticsSnapshot.tags || []
         ).map((t) => ({
           type: t,
           confidence: null,
         })),
         disciplineScore: user.analyticsSnapshot.disciplineScore,
       };
       progression = { success: true, trend: user.analyticsSnapshot.trend, changes: [], narrative: "Performance snapshot active." };

       journalInsights = user.analyticsSnapshot.journalInsights || journalInsights;
       
       const top5 = await Trade.find({ user: userId }).sort({ createdAt: -1 }).limit(5).lean();
       recentBehaviors = top5.map((t) => normalizeTrade(t));
    } else {
      try {
        const analysisTrades = await Trade.find({ user: userId }).sort({ createdAt: -1 }).limit(100).lean();
        const normalizedTrades = analysisTrades.map((trade) => normalizeTrade(trade));
        const closedTrades = mapToClosedTrades(normalizedTrades);
        const reflectionResults = closedTrades.map((ct) => analyzeReflection(ct));
        behavior = analyzeBehavior(closedTrades);
        progression = analyzeProgression(closedTrades);
        skillAudit = calculateSkillScore(closedTrades, reflectionResults, behavior, progression);

        const { calculateJournalInsights } = require("../engines/journalInsights.engine");
        journalInsights = calculateJournalInsights(closedTrades);
        recentBehaviors = normalizedTrades.slice(0, 5);

        logger.info("Live portfolio analytics recalibration complete", {
          action: "PORTFOLIO_COMPUTE",
          userId: user._id,
          tradeCount: analysisTrades.length,
        });
      } catch (e) {
        logger.warn({
          action: "PORTFOLIO_ANALYTICS_FALLBACK",
          userId,
          message: e?.message || String(e),
        });
        skillAudit = { score: 50, trend: "STABLE", breakdown: { discipline: 50 } };
        behavior = { success: false, patterns: [], disciplineScore: 50, dominantMistake: "None", mistakeFrequency: {}, riskProfile: null };
        progression = { success: false, trend: "STABLE", changes: [], narrative: "Analytics skipped — trade history could not be processed." };
        recentBehaviors = [];
      }
    }




    // 4. Construct Response (STRICT CONTRACT)
    const [winRate, pendingTradeRows] = await Promise.all([winRatePromise, pendingTradePromise]);

    const holdingsPositions = holdingsDocs.map((holding) => ({
      symbol: holding.symbol,
      quantity: Number(holding.quantity) || 0,
      avgPricePaise: Math.round(Number(holding.avgPricePaise) || 0),
      stopLossPaise: null,
      targetPricePaise: null,
    }));

    const summaryState = derivePortfolioSummaryState({
      holdingsCount: holdingsDocs.length,
      positions: holdingsDocs.map((data) => {
        const liveQuote = livePrices[data.symbol];
        const livePrice = liveQuote?.pricePaise;
        const investedVal = new Decimal(data.quantity).mul(data.avgPricePaise);
        const currentVal = new Decimal(data.quantity).mul(livePrice !== undefined ? livePrice : data.avgPricePaise);
        return {
          currentPricePaise: livePrice !== undefined ? livePrice : data.avgPricePaise,
          isFallback: livePrice === undefined || Boolean(liveQuote?.isFallback),
          investedValuePaise: Math.round(Number(investedVal)),
          currentValuePaise: Math.round(Number(currentVal)),
          unrealizedPnL: Math.round(Number(currentVal.sub(investedVal))),
          pnlPct: 0,
        };
      }),
      summary: {
        realizedPnL: user.realizedPnL || 0,
        unrealizedPnL: Math.round(Number(unrealizedPnL)),
        netEquity: Math.round(Number(new Decimal(user.balance).add(currentEquityValue))),
        winRate,
        skillAudit,
        behaviorInsights: behavior,
      },
    });

    const availableBalance = user.balance - (user.reservedBalancePaise || 0);

    const pendingOrders = pendingTradeRows.map((t) => ({
      tradeId: String(t._id),
      symbol: t.symbol,
      side: t.type,
      quantity: t.quantity,
      pricePaise: t.pricePaise,
      totalValuePaise: t.totalValuePaise,
      status: t.status,
      createdAt: t.createdAt,
      preTradeEmotion: t.preTradeEmotion || null,
    }));

    const rawResponseData = {
      state: summaryState,
      balance: availableBalance,
      totalInvested: user.totalInvested || 0,
      realizedPnL: user.realizedPnL || 0,
      unrealizedPnL: Math.round(Number(unrealizedPnL)),
      netEquity: Math.round(Number(new Decimal(user.balance).add(currentEquityValue))),
      winRate,
      holdings: holdingsPositions,
      skillAudit,
      behaviorInsights: {
        success: behavior.success,
        patterns: behavior.patterns || [],
        dominantMistake: behavior.dominantMistake || "None",
        mistakeFrequency: behavior.mistakeFrequency || {},
        journalInsights: { ...journalInsights, ...user.analyticsSnapshot?.journalInsights },
        riskProfile: behavior.riskProfile,
        progression: progression.success ? progression : null,
        recentBehaviors: recentBehaviors.map(t => ({
          symbol: t.symbol,
          type: t.type,
          behavior: t.reasoning || "Analyzing...",
          timestamp: t.createdAt
        }))
      },
      pendingOrders,
    };

    const response = {
      success: true,
      state: summaryState,
      data: adaptPortfolio(rawResponseData),
      meta: {
        timestamp: new Date().toISOString(),
        version: "3.1.1-fixed-contract",
        analyticsSnapshotValidMs: ANALYTICS_SNAPSHOT_VALID_MS,
        analyticsSnapshotSource: hasValidSnapshot ? "cache" : "live",
        systemStateVersion: user.systemStateVersion ?? 0,
        snapshotBypassed,
        snapshotBypassReason: snapshotBypassed
          ? recentTradeWindow
            ? "RECENT_TRADE_WINDOW"
            : "TRADE_AFTER_SNAPSHOT"
          : undefined,
      }
    };

    sendSuccess(res, req, response);

  } catch (error) {
    next(error);
  }
};

/**
 * Simple O(1) query for win rate counts.
 */
const computeWinRate = async (userId) => {
  const [sellTrades, winTrades] = await Promise.all([
    Trade.countDocuments({ user: userId, type: "SELL" }),
    Trade.countDocuments({ user: userId, type: "SELL", pnlPaise: { $gt: 0 } })
  ]);


  if (sellTrades === 0) return 0;
  return Number(((winTrades / sellTrades) * 100).toFixed(2));
};

/**
 * GET /api/portfolio/positions
 * Fetches all user holdings with live valuation and unrealized P&L metrics.
 */
const getPositions = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).lean();

    if (!user) {
      return sendSuccess(res, req, { success: false, message: "User not found" }, 404);
    }
    const holdingsDocs = await Holding.find({ userId }).lean();

    const holdingSymbols = holdingsDocs.map((holding) => holding.symbol);
    if (holdingSymbols.length === 0) {
      return sendSuccess(res, req, { success: true, state: SYSTEM_STATE.EMPTY, data: [] });
    }

    // Fetch live prices (non-fatal: empty map → cost-basis MTM in map below)
    const livePricesRaw = await safeLivePrices(holdingSymbols, { forPositions: true });
    const livePrices = livePricesRaw && typeof livePricesRaw === "object" ? livePricesRaw : {};

    const positions = holdingsDocs.map((data) => {
      const symbol = data.symbol;
      const liveQuote = livePrices[symbol];
      const livePrice = liveQuote?.pricePaise;
      const dayChangePct =
        liveQuote?.changePercent != null && Number.isFinite(Number(liveQuote.changePercent))
          ? Number(liveQuote.changePercent)
          : null;

      // Fallback: Use avgCost as currentPrice if live fetch failed
      const currentPrice = livePrice !== undefined ? livePrice : data.avgPricePaise;
      if (livePrice === undefined) {
        logger.warn({
          service: "portfolio.controller",
          step: "POSITION_LIVE_QUOTE_FALLBACK",
          status: "WARN",
          data: { symbol },
          timestamp: new Date().toISOString(),
        });
      }

      const investedValue = new Decimal(data.quantity).mul(data.avgPricePaise).toNumber();
      const currentValue = new Decimal(data.quantity).mul(currentPrice).toNumber();
      const unrealizedPnL = new Decimal(currentValue).sub(investedValue).toNumber();

      return {
        symbol: symbol.split(".")[0],
        fullSymbol: symbol,
        quantity: data.quantity,
        avgPricePaise: Math.round(data.avgPricePaise),
        currentPricePaise: Math.round(currentPrice),
        source: liveQuote?.source || "FALLBACK",
        isFallback: liveQuote ? Boolean(liveQuote.isFallback) : true,
        investedValuePaise: Math.round(investedValue),
        currentValuePaise: Math.round(currentValue),
        unrealizedPnL: Math.round(unrealizedPnL),
        pnlPct: investedValue > 0 ? Number(((unrealizedPnL / investedValue) * 100).toFixed(2)) : 0,
        dayChangePct,
      };
    });

    const state = derivePortfolioPositionsState({
      holdingsCount: holdingsDocs.length,
      positions,
    });

    sendSuccess(res, req, { success: true, state, data: adaptPositions(positions) });
  } catch (error) {
    next(error);
  }
};

module.exports = { getPortfolioSummary, getPositions };
