/**
 * PRE-TRADE AUTHORITY STORE — PERSISTENT (DB-backed)
 *
 * Replaces the old in-memory Map with a MongoDB collection so tokens
 * survive server restarts and work correctly across multiple instances.
 *
 * Tokens are peeked until execution succeeds, then removed via deleteDecisionRecord /
 * consumeDecisionRecord (alias). issueDecisionToken, peekDecisionRecord, and deletes are async.
 */
const crypto = require("crypto");
const PreTradeToken = require("../../models/preTradeToken.model");
const { normalizeSymbol } = require("../../utils/symbol.utils");

// ── Integer coercion (same rules as before) ───────────────────────────────────
const toInteger = (value) => {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num);
};

const normalizeProductType = (value) => {
  const raw = typeof value === "string" ? value.toUpperCase().trim() : "";
  return raw === "INTRADAY" ? "INTRADAY" : "DELIVERY";
};

// ── HMAC key — must be present; fail hard at module load time rather than
//    silently using a known constant that makes payload hashes forgeable.
const HMAC_SECRET = process.env.JWT_SECRET;
if (!HMAC_SECRET) {
  throw new Error(
    "FATAL: JWT_SECRET environment variable is not set. " +
    "preTradeAuthority.store cannot initialise without a signing secret."
  );
}

// ── Deterministic payload hash (Canonical Stringify) ──────────────────────────
const buildPayloadHash = (payload) => {
  const canonical = {
    symbol: normalizeSymbol(payload.symbol) || "",
    productType: normalizeProductType(payload.productType),
    pricePaise: toInteger(payload.pricePaise),
    quantity: toInteger(payload.quantity),
    stopLossPaise: toInteger(payload.stopLossPaise),
    targetPricePaise: toInteger(payload.targetPricePaise),
  };

  // Strict canonical sorting for determinism (Phase 3)
  const sortedKeys = Object.keys(canonical).sort();
  const json = JSON.stringify(canonical, sortedKeys);

  // HMAC signing (Phase 2)
  return crypto
    .createHmac("sha256", HMAC_SECRET)
    .update(json)
    .digest("hex");
};

// ── Issue a new token and persist it to MongoDB ───────────────────────────────

const redisClient = require("../../utils/redisClient");
const logger = require("../../utils/logger");

/** Pre-trade authority token TTL (ms). Clamped 60s–15m; default 10m for wizard-style flows. */
const TOKEN_TTL_MS_RAW = Number(process.env.PRE_TRADE_TOKEN_TTL_MS);
const TOKEN_TTL_MS = (() => {
  const n = Number.isFinite(TOKEN_TTL_MS_RAW) ? TOKEN_TTL_MS_RAW : 10 * 60 * 1000;
  return Math.min(15 * 60 * 1000, Math.max(60 * 1000, n));
})();
const TOKEN_TTL_SEC = Math.max(60, Math.ceil(TOKEN_TTL_MS / 1000));


const issueDecisionToken = async ({ symbol, productType, pricePaise, quantity, stopLossPaise, targetPricePaise, verdict, userId }) => {
  const token = crypto.randomUUID();
  const payloadHash = buildPayloadHash({ symbol, productType, pricePaise, quantity, stopLossPaise, targetPricePaise });
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  const data = { token, userId: userId || null, payloadHash, verdict, expiresAt: expiresAt.getTime() };
  if (redisClient && redisClient.status === "ready") {
     try {
       await redisClient.set(`pretrade:${token}`, JSON.stringify(data), "EX", TOKEN_TTL_SEC);
     } catch(e) { /* fallback */ }
  }
  await PreTradeToken.create({
    token,
    userId: userId || null,
    payloadHash,
    verdict,
    expiresAt,
    state: "VALID",
  });

  return data;
};

/**
 * Read token without consuming it. Used until execution transaction succeeds.
 */
const peekDecisionRecord = async (token) => {
  if (!token) return null;

  if (redisClient && redisClient.status === "ready") {
    try {
      const str = await redisClient.get(`pretrade:${token}`);
      if (str) {
        const obj = JSON.parse(str);
        if (obj.expiresAt <= Date.now()) return null;
        return obj;
      }
    } catch (e) {
      /* fall through to Mongo */
    }
  }

  const record = await PreTradeToken.findOne({
    token,
    $or: [{ state: "VALID" }, { state: { $exists: false } }],
  }).lean();
  if (!record) return null;
  if (record.expiresAt <= new Date()) return null;
  if (record.state && record.state !== "VALID") return null;
  return {
    token: record.token,
    userId: record.userId,
    payloadHash: record.payloadHash,
    verdict: record.verdict,
    expiresAt: record.expiresAt instanceof Date ? record.expiresAt.getTime() : record.expiresAt,
  };
};

/**
 * Single-use after successful execution only. Call after DB commit succeeds.
 */
const deleteDecisionRecord = async (token) => {
  if (!token) return;
  if (redisClient && redisClient.status === "ready") {
    try {
      await redisClient.del(`pretrade:${token}`);
    } catch (e) {
      /* continue */
    }
  }
  await PreTradeToken.updateOne({ token }, { $set: { state: "CONSUMED" } });
};

/** @deprecated Use peekDecisionRecord — kept for backward-compatible imports. */
const getDecisionRecord = peekDecisionRecord;

const consumeDecisionRecord = deleteDecisionRecord;

// ── Test helpers (mirror of old __testables interface) ───────────────────────
const __testables = {
  buildPayloadHash,
  issueDecisionToken,
  getDecisionRecord,
  peekDecisionRecord,
  deleteDecisionRecord,
  consumeDecisionRecord,
  // clearStore: deletes all tokens — used in test teardown
  clearStore: async () => {
    await PreTradeToken.deleteMany({});
  },
  // getStoreSize: count of live tokens — used in test assertions
  getStoreSize: async () => PreTradeToken.countDocuments({}),
};

module.exports = {
  buildPayloadHash,
  issueDecisionToken,
  getDecisionRecord,
  peekDecisionRecord,
  deleteDecisionRecord,
  consumeDecisionRecord,
  __testables,
};
