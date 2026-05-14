const marketDataService = require('../services/marketData.service');
const { getPrice } = require('../services/price.engine');
const Holding = require("../models/holding.model");
const { toHoldingsObject } = require("../utils/holdingsNormalizer");
const { deriveIntelligenceState } = require("../utils/systemState");
const { adaptMarket } = require("../adapters/market.adapter");
const newsEngine = require('../services/news/news.engine');
const { sendSuccess } = require("../utils/response.helper");
const { getMarketSessionSnapshot } = require("../services/marketHours.service");

/** Align price.engine sources with UI / legacy quote contract (REAL | CACHE | STALE | …). */
const mapQuoteSource = (source) => {
  if (source === "LIVE") return "REAL";
  if (source === "REDIS" || source === "MEMORY") return "CACHE";
  if (source === "STALE") return "STALE";
  return "UNAVAILABLE";
};

const getQuote = async (req, res, next) => {
  try {
    const { symbol } = req.query;
    if (!symbol) return sendSuccess(res, req, { success: false, message: "Symbol required" }, 400);
    const engine = await getPrice(symbol);
    const mapped = mapQuoteSource(engine.source);
    const data = {
      pricePaise: engine.pricePaise,
      source: mapped,
      isStale: engine.source === "STALE",
      isFallback: engine.source === "STALE",
    };
    sendSuccess(res, req, { success: true, data });
  } catch (error) {
    next(error);
  }
};

const getHistory = async (req, res, next) => {
  try {
    const { symbol, period } = req.query;
    if (!symbol) return sendSuccess(res, req, { success: false, message: "Symbol required" }, 400);
    const data = await marketDataService.getHistorical(symbol, period);
    sendSuccess(res, req, { success: true, data });
  } catch (error) {
    next(error);
  }
};

const getNews = async (req, res, next) => {
  try {
    const { symbol } = req.query;

    let data;
    if (symbol) {
      const holdingsDocs = await Holding.find({ userId: req.user._id });
      const userHoldings = toHoldingsObject(holdingsDocs.map((holding) => ({
        symbol: holding.symbol,
        quantity: holding.quantity,
        avgPricePaise: holding.avgPricePaise,
      })));
      data = await newsEngine.getProcessedNews(symbol, userHoldings);
      const state = deriveIntelligenceState({ signals: data?.signals || [] });
      sendSuccess(res, req, { success: true, state, ...data });
    } else {
      const newsData = await newsEngine.getTopNews();
      sendSuccess(res, req, { success: true, ...newsData });
    }
  } catch (error) {
    next(error);
  }
};

const getFundamentals = async (req, res, next) => {
  try {
    const { symbol } = req.query;
    if (!symbol) return sendSuccess(res, req, { success: false, message: "Symbol required" }, 400);
    const data = await marketDataService.getFundamentals(symbol);
    sendSuccess(res, req, { success: true, data });
  } catch (error) {
    next(error);
  }
};

const validateSymbol = async (req, res, next) => {
  try {
    const { symbol } = req.query;
    if (!symbol) return sendSuccess(res, req, { success: false, message: "Symbol required" }, 400);
    const result = await marketDataService.validateSymbol(symbol);
    sendSuccess(res, req, { success: true, ...result });
  } catch (error) {
    next(error);
  }
};

const getPortfolioNews = async (req, res, next) => {
  try {
    const holdingsDocs = await Holding.find({ userId: req.user._id });
    const userHoldings = toHoldingsObject(holdingsDocs.map((holding) => ({
      symbol: holding.symbol,
      quantity: holding.quantity,
      avgPricePaise: holding.avgPricePaise,
    })));
    const data = await newsEngine.getPortfolioNews(userHoldings);
    const state = deriveIntelligenceState({ signals: data?.signals || [] });
    sendSuccess(res, req, { success: true, state, ...data });
  } catch (error) {
    next(error);
  }
};

const getIndices = async (req, res) => {
  try {
    const [indices, ticker] = await Promise.all([
      marketDataService.getMarketIndices(),
      marketDataService.getTickerData(),
    ]);
    const safeIndices = Array.isArray(indices) ? indices : [];
    const safeTicker  = Array.isArray(ticker)  ? ticker  : [];

    sendSuccess(res, req, {
      success: true,
      data: {
        indices: safeIndices,
        ticker:  safeTicker,
      },
      degraded: safeIndices.length === 0,
    });
  } catch (error) {
    sendSuccess(res, req, {
      success: true,
      data: { indices: [], ticker: [] },
      degraded: true,
      error: "fallback_mode",
    });
  }
};

/**
 * GET /api/market/session — IST clock + NSE session bounds + calendar presence (no DB quote fetch).
 * Public + rate-limited; safe for dashboard strip before heavy market calls.
 */
const getSession = (req, res) => {
  const snapshot = getMarketSessionSnapshot(new Date());
  sendSuccess(res, req, {
    success: true,
    state: snapshot.clockState,
    data: snapshot,
  });
};

const getMarketOverview = async (req, res) => {
  try {
    const [quotes, newsData] = await Promise.all([
      marketDataService.getMarketIndices(),
      newsEngine.getTopNews()
    ]);
    
    const indices = Array.isArray(quotes) ? quotes : [];

    sendSuccess(res, req, {
      success: true,
      data: {
        ...adaptMarket(indices, newsData),
        indices
      },
      degraded: indices.length === 0
    });
  } catch (error) {
    sendSuccess(res, req, {
      success: true,
      data: { indices: [], market: [], global: [] },
      degraded: true
    });
  }
};

module.exports = {
  getQuote,
  getHistory,
  getNews,
  getFundamentals,
  validateSymbol,
  getPortfolioNews,
  getIndices,
  getMarketOverview,
  getSession,
};
