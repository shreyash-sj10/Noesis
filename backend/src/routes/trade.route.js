const express = require("express");
const router = express.Router();

const protect = require("../middlewares/auth.middleware");
const {
  buyTrade,
  sellTrade,
  getTradeHistory,
  getTradeAsyncStatus,
} = require("../controllers/trade.controller");

const rateLimit = require("express-rate-limit");
const { ipKeyGenerator } = rateLimit;
const { RedisStore } = require("rate-limit-redis");
const redisClient = require("../utils/redisClient");
const { validateTradePayload } = require("../middlewares/validateTradePayload");
const { sendSuccess } = require("../utils/response.helper");

const tradeRateLimitBody = (req) => ({
  success: false,
  message: "Excessive trade requests. Cooldown required for institutional compliance.",
  traceId: req.traceId || req.requestId,
  error: {
    code: "RATE_LIMITED",
    message: "Excessive trade requests. Cooldown required for institutional compliance.",
    traceId: req.traceId || req.requestId,
    retryable: true,
  },
  meta: { traceId: req.traceId || req.requestId },
});

/**
 * Trade execution: limit by authenticated user (not raw IP).
 * With Redis (USE_REDIS=true): shared counters across horizontally scaled instances.
 * Without Redis: in-memory store — correct per-user keying for single instance; scale-out needs Redis.
 */
const tradeLimiter = rateLimit({
  windowMs: Number(process.env.TRADE_RATE_LIMIT_WINDOW_MS || 10 * 1000),
  max: Number(
    process.env.TRADE_RATE_LIMIT_MAX != null && process.env.TRADE_RATE_LIMIT_MAX !== ""
      ? process.env.TRADE_RATE_LIMIT_MAX
      : process.env.NODE_ENV === "test"
        ? 10
        : 5
  ),
  keyGenerator: (req) => {
    const uid = req.user?._id ?? req.user?.id;
    if (uid != null) return String(uid);
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    return ipKeyGenerator(ip);
  },

  message: tradeRateLimitBody,
  handler: async (req, res, _next, options) => {
    const retrySec = Math.max(1, Math.ceil(Number(options.windowMs) / 1000));
    res.set("Retry-After", String(retrySec));
    const body =
      typeof options.message === "function"
        ? await options.message(req, res)
        : options.message;
    sendSuccess(res, req, body, options.statusCode);
  },
  standardHeaders: true,
  legacyHeaders: false,
  ...(redisClient && redisClient.supportsRateLimitStore
    ? {
        store: new RedisStore({
          sendCommand: (...args) => redisClient.call(...args),
          prefix: process.env.TRADE_RATE_LIMIT_REDIS_PREFIX || "rl:trade:",
        }),
      }
    : {}),
});


// --- Execution Guards ---
/**
 * NOTE: enforceReview (decisionContext/userThinking text check) was removed.
 *
 * It was a weak gate: any caller could bypass it by sending `userThinking: "x"`.
 * The real enforcement is:
 *   1. enforceBuyReview / enforceSellReview — hard-require `preTradeToken`
 *   2. Service layer — claims token inside the Mongo transaction
 *      (userId + expiry + state=VALID checks), then verifies `payloadHash`
 *      matches the exact trade payload (symbol, price, qty, SL, target).
 *
 * A valid token CAN ONLY be issued by the pre-trade intelligence endpoint, so
 * removing the soft text-field check does not weaken the security model.
 */

const enforceRequestId = (req, res, next) => {
  const requestId = req.headers["idempotency-key"];
  if (!requestId || typeof requestId !== "string" || requestId.trim().length === 0) {
    return sendSuccess(res, req, {
      success: false,
      message: "REQUEST_ID_REQUIRED"
    }, 400);
  }
  next();
};

const enforceBuyReview = (req, res, next) => {
  const preTradeToken = req.headers["pre-trade-token"] || req.body.preTradeToken;
  const { stopLossPaise, targetPricePaise } = req.body;

  if (!stopLossPaise || !targetPricePaise) {
    return sendSuccess(res, req, {
      success: false,
      message: "PLAN_REQUIRED: Buy orders must include stopLossPaise and targetPricePaise."
    }, 403);
  }

  if (!preTradeToken) {
    return sendSuccess(res, req, {
      success: false,
      message: "PRE_TRADE_REQUIRED: Institutional trades must include a valid preTradeToken."
    }, 403);
  }

  req.body.token = preTradeToken;
  next();
};

const enforceSellReview = (req, res, next) => {
  const preTradeToken = req.headers["pre-trade-token"] || req.body.preTradeToken;

  if (!preTradeToken) {
    return sendSuccess(res, req, {
      success: false,
      message: "PRE_TRADE_REQUIRED: Sell orders must include a valid preTradeToken."
    }, 403);
  }

  req.body.token = preTradeToken;
  next();
};


const { isMarketOpen } = require("../services/marketHours.service");
const logger = require("../utils/logger");

const checkMarketClock = (req, res, next) => {
  const allowClosedMarketExecution = process.env.ALLOW_CLOSED_MARKET_EXECUTION === "true";
  if (!isMarketOpen() && !allowClosedMarketExecution) {
    logger.warn({
      action: "MARKET_CLOSED_EXECUTION",
      userId: req.user?._id,
      traceId: req.traceId || req.requestId,
      requestId: req.headers["idempotency-key"],
      message: "Order placed outside of active market hours. Execution queued.",
    });
  }
  next();
};

router.get("/execution-status/:tradeId", protect, getTradeAsyncStatus);
router.get("/", protect, getTradeHistory);

// Execution gates: tradeLimiter → enforceRequestId → payload validation → pre-trade token → market clock → handler
router.post("/buy", protect, tradeLimiter, enforceRequestId, validateTradePayload, enforceBuyReview, checkMarketClock, buyTrade);
router.post("/sell", protect, tradeLimiter, enforceRequestId, validateTradePayload, enforceSellReview, checkMarketClock, sellTrade);


module.exports = router;

