/**
 * BEHAVIOR SIGNALS DERIVATION — PRE-TRADE CONTEXT (DB-DRIVEN)
 * Reads live trade history from DB to detect behavioral risk signals
 * at the moment of a new trade attempt.
 *
 * DISTINCT FROM behavior.engine.js:
 *   - behavior.engine.js:  post-trade pattern analysis on ClosedTrade[]
 *   - deriveBehaviorSignals: pre-trade risk signal, reads DB directly
 *
 * ALL thresholds from system.config — zero hardcoded values.
 * Deterministic: same trade history always yields same output.
 */
const Trade = require("../../models/trade.model");
const { SYSTEM_CONFIG } = require("../../config/system.config");
const logger = require("../../utils/logger");

const cfg = SYSTEM_CONFIG.behavior;
const intel = SYSTEM_CONFIG.intelligence.preTrade;

/**
 * Derives live behavioral risk signals from DB trade history for a given user.
 * Used as pre-trade context by the decision engine and guard layer.
 *
 * @param {string|ObjectId} userId
 * @param {string} [currentSymbol] — when set, revenge risk applies only to the same symbol (NSE-style)
 * @returns {Promise<{
 *   flags: string[],
 *   lastTradePnlPaise: number|null,
 *   timeSinceLastTradeMs: number|null,
 *   tradesLast24h: number,
 *   revengeRisk: boolean,
 *   overtradingRisk: boolean,
 *   fomoRisk: boolean,
 *   avgEntryPaiseLast10: number|null,
 *   priceBias: number|null
 * }>}
 */
const normalizeSymbolKey = (sym) =>
  sym ? String(sym).toUpperCase().trim().replace(/\.(NS|BO)$/, "") : null;

const deriveBehaviorSignals = async (userId, currentSymbol = null) => {
  if (!userId) {
    return _emptySignals();
  }

  const normalizedCurrentSymbol = normalizeSymbolKey(currentSymbol);

  // ── 1. Fetch recent trades from DB (no mock data, no constants) ────────────
  const now = Date.now();
  const window24h = now - 24 * 60 * 60 * 1000;

  // Fetch last 20 trades for signal derivation (chronological, most recent first)
  const recentTrades = await Trade.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  if (!recentTrades || recentTrades.length === 0) {
    return _emptySignals();
  }

  const flags = [];

  // ── 2. REVENGE TRADING SIGNAL ──────────────────────────────────────────────
  // Rule: last SELL trade was a loss AND new entry attempt is within the window.
  // Window unified with behavior.engine.js via cfg.revengeWindowMinutes.
  const revengeWindowMs = cfg.revengeWindowMinutes * 60 * 1000;

  const lastSell = recentTrades.find((t) => {
    if (t.type !== "SELL" || typeof t.pnlPaise !== "number") return false;
    if (normalizedCurrentSymbol) {
      return normalizeSymbolKey(t.symbol) === normalizedCurrentSymbol;
    }
    return true;
  });
  let lastTradePnlPaise = null;
  let timeSinceLastTradeMs = null;
  let revengeRisk = false;

  if (lastSell) {
    lastTradePnlPaise = lastSell.pnlPaise;
    timeSinceLastTradeMs = now - new Date(lastSell.createdAt).getTime();

    if (lastTradePnlPaise < 0 && timeSinceLastTradeMs < revengeWindowMs) {
      flags.push("REVENGE_TRADING_RISK");
      revengeRisk = true;
      logger.debug({ action: "BEHAVIOR_SIGNAL", flag: "REVENGE_TRADING_RISK", userId, timeSinceLastTradeMs });
    }
  }

  // ── 3. OVERTRADING SIGNAL ─────────────────────────────────────────────────
  // Rule: number of trades (any type) in last 24h exceeds limit.
  // Limit is cfg.overtradingPerDayLimit — config-driven, not hardcoded.
  const tradesLast24h = recentTrades.filter(t => {
    const ts = new Date(t.createdAt).getTime();
    return ts >= window24h;
  }).length;

  const overtradingRisk = tradesLast24h > cfg.overtradingPerDayLimit;
  if (overtradingRisk) {
    flags.push("OVERTRADING_RISK");
    logger.debug({ action: "BEHAVIOR_SIGNAL", flag: "OVERTRADING_RISK", userId, tradesLast24h });
  }

  // ── 4. FOMO SIGNAL ────────────────────────────────────────────────────────
  // Rule: if a new BUY entry price deviates significantly above the user's
  // recent average entry price, it suggests chasing a move (FOMO).
  // "Significant" = > 3% above the rolling average — config-driven via mistakeAnalysis.
  const buyTrades = recentTrades
    .filter(t => t.type === "BUY" && typeof t.pricePaise === "number" && t.pricePaise > 0)
    .slice(0, 10);

  let avgEntryPaiseLast10 = null;
  let fomoRisk = false;
  let priceBias = null;

  if (buyTrades.length >= 3) {
    // Average of last 10 BUY prices (population basis — deterministic)
    avgEntryPaiseLast10 = Math.round(
      buyTrades.reduce((acc, t) => acc + t.pricePaise, 0) / buyTrades.length
    );

    // priceBias: % deviation of most recent BUY price from rolling avg
    const latestBuy = buyTrades[0]; // sorted by createdAt desc → most recent first
    if (latestBuy) {
      priceBias = avgEntryPaiseLast10 > 0
        ? Number((((latestBuy.pricePaise - avgEntryPaiseLast10) / avgEntryPaiseLast10) * 100).toFixed(2))
        : null;

      // FOMO threshold: cost basis deviated > riskPercent.low above average
      // Uses mistakeAnalysis.riskPercent.low (default 5%) as the fomo threshold
      const fomoThresholdPct = SYSTEM_CONFIG.mistakeAnalysis.riskPercent.low;
      if (priceBias !== null && priceBias > fomoThresholdPct) {
        flags.push("FOMO_RISK");
        fomoRisk = true;
        logger.debug({ action: "BEHAVIOR_SIGNAL", flag: "FOMO_RISK", userId, priceBias });
      }
    }
  }

  return {
    flags,
    lastTradePnlPaise,
    timeSinceLastTradeMs,
    tradesLast24h,
    revengeRisk,
    overtradingRisk,
    fomoRisk,
    avgEntryPaiseLast10,
    priceBias,
  };
};

const _emptySignals = () => ({
  flags: [],
  lastTradePnlPaise: null,
  timeSinceLastTradeMs: null,
  tradesLast24h: 0,
  revengeRisk: false,
  overtradingRisk: false,
  fomoRisk: false,
  avgEntryPaiseLast10: null,
  priceBias: null,
});

module.exports = { deriveBehaviorSignals };
