const newsEngine = require("../news/news.engine");
const Trade = require("../../models/trade.model");
const { normalizeTrade } = require("../../domain/trade.contract");
const { mapToClosedTrades } = require("../../domain/closedTrade.mapper");
const adaptiveEngine = require("./adaptiveEngine.service");
const { explainDecision } = require("../aiExplanation.service");
const { issueDecisionToken } = require("./preTradeAuthority.store");
const { toHoldingsObject } = require("../../utils/holdingsNormalizer");
const Holding = require("../../models/holding.model");
const {
  evaluateEntryDecision,
  mapDecisionVerdictToAuthorityVerdict,
} = require("../../engines/entry.engine");
const { isValidStatus } = require("../../constants/intelligenceStatus");
const { SYSTEM_CONFIG } = require("../../config/system.config");
const logger = require("../../utils/logger");
const AppError = require("../../utils/AppError");
const { deriveBehaviorSignals } = require("./behaviorSignals.service");

/**
 * PRE-TRADE DECISION SNAPSHOT ENGINE
 */
const checkTradeRisk = async (tradeRequest, user) => {
  const cfg = SYSTEM_CONFIG.intelligence.preTrade;
  const { 
    symbol, type, quantity, userThinking, pricePaise, stopLossPaise, targetPricePaise, productType,
  } = tradeRequest;
  const finalPrice = Math.round(Number(pricePaise || 0));
  const finalSL = stopLossPaise === undefined || stopLossPaise === null ? null : Math.round(Number(stopLossPaise));
  const finalTP = targetPricePaise === undefined || targetPricePaise === null ? null : Math.round(Number(targetPricePaise));


  // LAYER 1: MARKET INTELLIGENCE
  const holdingDocs = await Holding.find({ userId: user._id });
  const holdings = toHoldingsObject(holdingDocs.map((holding) => ({
    symbol: holding.symbol,
    quantity: holding.quantity,
    avgPricePaise: holding.avgPricePaise,
  })));
  const newsResponse = await newsEngine.getProcessedNews(symbol, holdings);
  const consensus = newsResponse.signals?.[0];
  const marketStatus = newsResponse?.status || (consensus ? "VALID" : "UNAVAILABLE");

  // LAYER 2: BEHAVIORAL ANALYSIS
  const behaviorSignals = await deriveBehaviorSignals(user._id, symbol);
  const behavioralFlags = behaviorSignals.flags;
  const adaptiveProfile = await adaptiveEngine.getAdaptiveProfile(user._id);

  const history = await Trade.find({ user: user._id })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  const chronHistory = [...history].reverse();
  const closedTrades = mapToClosedTrades(chronHistory.map((t) => normalizeTrade(t)));

  // LAYER 3: ENTRY ENGINE (Decision ownership, deterministic inputs only)
  const normalizedProductType =
    String(productType || "DELIVERY").toUpperCase().trim() === "INTRADAY" ? "INTRADAY" : "DELIVERY";

  const entryDecisionBase = evaluateEntryDecision({
    plan: {
      side: type || "BUY",
      productType: normalizedProductType,
      pricePaise: finalPrice,
      stopLossPaise: finalSL,
      targetPricePaise: finalTP,
    },
    marketContext: {
      status: marketStatus,
      consensusVerdict: consensus?.verdict,
    },
    behaviorContext: {
      status: "VALID",
      flags: behavioralFlags,
      closedTrades,
    },
  });

  const initialInsight = {
    riskLevel: entryDecisionBase.baseRiskImpact > cfg.highRiskBoundary ? "HIGH" : "MEDIUM",
    reasoning: ["Standard protocol audit."],
  };
  const adapted = await adaptiveEngine.adaptWarning(initialInsight, adaptiveProfile);

  const entryDecision = evaluateEntryDecision({
    plan: {
      side: type || "BUY",
      productType: normalizedProductType,
      pricePaise: finalPrice,
      stopLossPaise: finalSL,
      targetPricePaise: finalTP,
    },
    marketContext: {
      status: marketStatus,
      consensusVerdict: consensus?.verdict,
      adaptedRiskLevel: adapted.adaptedRiskLevel,
    },
    behaviorContext: {
      status: "VALID",
      flags: behavioralFlags,
      closedTrades,
    },
  });

  if (type === "BUY" && entryDecision.planValidation && !entryDecision.planValidation.isValid) {
    throw new AppError(entryDecision.planValidation.errorCode || "INVALID_TRADE_PLAN", 400);
  }

  const rr = type === "BUY" ? entryDecision.rr : 0;
  const finalScore = entryDecision.riskScore;
  const verdict = mapDecisionVerdictToAuthorityVerdict(entryDecision.verdict);

  // PHASE 1 FIX: Issue token FIRST — AI must never block trade authorization.
  const authority = await issueDecisionToken({
    symbol,
    productType,
    pricePaise: finalPrice,
    quantity,
    stopLossPaise: finalSL,
    targetPricePaise: finalTP,
    verdict,
    userId: user._id,
  });

  const marketAlignment =
    marketStatus === "UNAVAILABLE" || consensus?.verdict == null
      ? "UNAVAILABLE"
      : consensus.verdict === type
        ? "ALIGNED"
        : "CONFLICTED";

  // AI runs in the BACKGROUND — fire-and-forget. Token is already issued.
  const decisionSignals = {
    verdict,
    score: finalScore,
    marketAlignment,
    ruleVerdict: verdict,
    marketSignals: { direction: consensus?.verdict, confidence: consensus?.confidence },
    behaviorSignals: { risk: adapted.adaptedRiskLevel, score: 100 - (behavioralFlags.length * cfg.behavioralScorePenaltyPerFlag) },
    riskSignals: { level: verdict === "BUY" ? "LOW" : "HIGH", score: finalScore },
  };
  // Non-blocking: explainDecision may be missing or sync under tests; never assume a Promise.
  Promise.resolve()
    .then(() => explainDecision(decisionSignals))
    .catch(() => null);

  logger.info({
    action: "PRE_TRADE_AUDIT",
    userId: user._id,
    symbol,
    verdict,
    score: finalScore,
    status: "SUCCESS"
  });



  // CONSTRUCT THE SNAPSHOT
  return {
    success: true,
    token: authority.token,
    expiresAt: authority.expiresAt,
    snapshot: {
       /** Required by intelligence.route for deriveDecisionState / clients. */
       verdict,
       market: {
          direction: consensus?.verdict ?? null,
          impact: consensus?.impact ?? null,
          mechanism: consensus?.mechanism ?? null,
          confidence: consensus?.confidence ?? null,
          alignment: consensus?.verdict === type ? "OPTIMAL" : "DIVERGENT",
          sector: consensus?.sector || "GENERAL",
          status: marketStatus,
          reason: marketStatus === "UNAVAILABLE" ? (newsResponse?.reason || "NO_MARKET_SIGNALS") : undefined,
       },
       pillars: {
          marketAlignment: {
             score: consensus?.verdict === type ? cfg.alignedScore : cfg.conflictedScore,
             status: consensus?.verdict === type ? "ALIGNED" : "CONFLICTED",
             reasoning: marketStatus === "UNAVAILABLE"
               ? "Data not available. Decision limited due to missing signals."
               : `Market consensus for ${symbol} is ${consensus?.verdict}. Entry ${type} is ${consensus?.verdict === type ? "synchronous" : "opposing"} with live intelligence.`
          },
          sectorCorrelation: {
             score: Number.isFinite(Number(consensus?.confidence))
               ? (consensus?.confidence > cfg.sectorStrongConfidence ? cfg.sectorStrongScore : cfg.sectorNeutralScore)
               : null,
             status: Number.isFinite(Number(consensus?.confidence))
               ? (consensus?.confidence > cfg.sectorStrongConfidence ? "STRONG" : "NEUTRAL")
               : "UNAVAILABLE",
             reasoning: Number.isFinite(Number(consensus?.confidence))
               ? `${consensus?.sector || "Sector"} signals are ${consensus?.confidence > cfg.sectorStrongConfidence ? "reinforcing" : "neutral"} regarding the current market action.`
               : "Data not available. Decision limited due to missing signals."
          },
          volumeSetupStrength: {
             score: null,
             status: "INFORMATIONAL",
             reasoning: "Setup analysis is informational only and does not affect deterministic decisioning."
          },
          behavioralRisk: {
             score: 100 - (behavioralFlags.length * cfg.behavioralDisciplinePenaltyPerFlag),
             status: behavioralFlags.length === 0 ? "DISCIPLINED" : "COMPROMISED",
             reasoning: behavioralFlags.length === 0 ? "No active behavioral biases detected." : `Detected: ${behavioralFlags.join(", ").replace(/_/g, " ")}. Emotional friction is high.`
          },
          rrQuality: {
             score: rr == null ? null : rr >= cfg.optimalRrThreshold ? cfg.rrOptimalScore : rr >= cfg.lowRrThreshold ? cfg.rrAcceptableScore : cfg.rrPoorScore,
             status: rr == null ? "UNAVAILABLE" : rr >= cfg.optimalRrThreshold ? "OPTIMAL" : rr >= cfg.lowRrThreshold ? "ACCEPTABLE" : "POOR",
             reasoning: rr == null
               ? "Reward-to-Risk ratio unavailable — insufficient market data to complete risk evaluation."
               : `Reward-to-Risk ratio of ${rr} ${rr >= cfg.lowRrThreshold ? "meets" : "fails"} professional capital preservation standards.`
          }
       },
       setup: {
          strategy: null,
          isValid: null,
          reason: "AI_SETUP_REMOVED_FROM_DECISION_PATH",
          confidence: null,
          status: "UNAVAILABLE",
          unavailableReason: "AI_NON_AUTHORITATIVE_BOUNDARY_ENFORCED",
       },
       behavior: {
          flags: behavioralFlags,
          sensitivity: adaptiveProfile.sensitivityLevel,
          disciplineScore: 100 - (behavioralFlags.length * cfg.behavioralDisciplinePenaltyPerFlag)
       },
       risk: {
          score: finalScore,
          rr: rr ?? null,
          verdict,
          level: verdict === "BUY" ? "OPTIMAL" : verdict === "WAIT" ? "CAUTION" : "EXTREME",
          status: entryDecision.status || "VALID",
          reason: entryDecision.reason || (entryDecision.reasons?.[0] ?? null),
       },
       bias: null,
       // AI explanation computed async in background after token issuance.
       // Not included in synchronous response — consumers read from cache.
       ai: null
    },
    authority: {
      token: authority.token,
      expiresAt: authority.expiresAt,
      verdict,
    },
  };
};

module.exports = { checkTradeRisk };
