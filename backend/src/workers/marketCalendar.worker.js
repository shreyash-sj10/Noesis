/**
 * MARKET CALENDAR WORKER
 *
 * Responsibilities:
 *  1. On startup: warm the in-memory calendar cache from MongoDB (fast, no Docker
 *     service required — works even when the Docker container is not running).
 *  2. On startup: kick off a background sync from the Docker service (non-blocking).
 *  3. Every CALENDAR_CACHE_REFRESH_MS (default 60s): refresh in-memory cache from DB.
 *  4. Every CALENDAR_SYNC_INTERVAL_MS (default 24h): re-sync from Docker service then
 *     refresh cache.
 *
 * Never throws — all failures are logged and swallowed so the app continues with
 * whatever data exists in MongoDB (fail-safe: empty cache → market treated as CLOSED).
 */
const { syncCalendar } = require("../services/marketCalendarSync.service");
const { seedNaiveCalendarRange } = require("../services/marketCalendarSeed.service");
const {
  refreshCalendarCache,
  getMarketClockState,
  getIstWallClock,
  isCalendarDocumentMissingToday,
  getIstDateKey,
} = require("../utils/marketHours.util");
const logger = require("../utils/logger");

/** When Docker sync returns 0 rows, seed weekday calendar (dev default on). */
const shouldSeedFallback = () => {
  const flag = String(process.env.CALENDAR_SEED_FALLBACK || "").toLowerCase();
  if (flag === "false" || flag === "0") return false;
  if (flag === "true" || flag === "1") return true;
  return process.env.NODE_ENV === "development";
};

const CACHE_REFRESH_MS = Number(process.env.CALENDAR_CACHE_REFRESH_MS || 60 * 1000);
const SYNC_INTERVAL_MS = Number(process.env.CALENDAR_SYNC_INTERVAL_MS || 24 * 60 * 60 * 1000);

let _cacheTimer = null;
let _syncTimer = null;
/** Throttle missing-calendar CRITICAL logs (ms). */
let _lastMissingCalendarLogMs = 0;

/**
 * Runs one sync cycle: Docker service → MongoDB → in-memory cache.
 * Errors are swallowed so the worker never crashes the process.
 */
const runSyncAndRefresh = async () => {
  let synced = 0;
  try {
    synced = await syncCalendar();
  } catch (err) {
    logger.warn({ event: "MARKET_CALENDAR_SYNC_FAILED", message: err?.message });
  }

  if (synced === 0 && shouldSeedFallback() && isCalendarDocumentMissingToday()) {
    try {
      const year = new Date().getFullYear();
      await seedNaiveCalendarRange({ from: `${year}-01-01`, to: `${year + 1}-12-31` });
      logger.warn({
        event: "MARKET_CALENDAR_FALLBACK_SEED",
        message:
          "Docker calendar sync unavailable — applied naive weekday seed. Set TRADING_CALENDAR_URL for NSE holidays.",
      });
    } catch (seedErr) {
      logger.warn({ event: "MARKET_CALENDAR_FALLBACK_SEED_FAILED", message: seedErr?.message });
    }
  }

  await runCacheRefresh();
};

/**
 * Refreshes the in-memory cache from MongoDB only (no Docker call).
 */
const runCacheRefresh = async () => {
  try {
    await refreshCalendarCache();
  } catch (err) {
    logger.warn({ event: "MARKET_CALENDAR_CACHE_REFRESH_FAILED", message: err?.message });
  }
  maybeLogMissingTradingDayCalendar();
};

/**
 * Weekday 08:00–16:00 IST: if there is still no MarketCalendar row for today,
 * log CRITICAL at most once per hour (ops visibility).
 */
const maybeLogMissingTradingDayCalendar = () => {
  const now = new Date();
  const clock = getMarketClockState(now);
  if (clock === "WEEKEND") return;
  const { hour } = getIstWallClock(now);
  if (hour < 8 || hour > 16) return;
  if (!isCalendarDocumentMissingToday(now)) return;

  const t = Date.now();
  if (t - _lastMissingCalendarLogMs < 60 * 60 * 1000) return;
  _lastMissingCalendarLogMs = t;

  logger.error({
    event: "MARKET_CALENDAR_ROW_MISSING_TODAY",
    message:
      "No MarketCalendar document for today (IST). isMarketOpen() remains false until Mongo has a row — run TRADING_CALENDAR_URL sync or seed.",
    istDateKey: getIstDateKey(now),
  });
};

/**
 * Start the calendar worker.
 *
 * Returns a promise that resolves once the initial DB cache warm-up is done
 * so callers can await it before starting market-sensitive services.
 * The Docker sync runs in background and does not block startup.
 */
const startMarketCalendarWorker = async () => {
  // Step 1: Warm cache from DB immediately (fast — DB is already connected at this point).
  await runCacheRefresh();

  // Step 2: Kick Docker sync in background — does NOT block server startup.
  // If the Docker service is unavailable, syncCalendar() returns 0 and logs a warning.
  runSyncAndRefresh().catch(() => {});

  // Step 3: Periodic cache refresh (every 60s) — keeps today's entry fresh across midnight.
  if (!_cacheTimer) {
    _cacheTimer = setInterval(() => {
      runCacheRefresh().catch(() => {});
    }, CACHE_REFRESH_MS);
    if (_cacheTimer.unref) _cacheTimer.unref(); // Don't prevent process exit in tests
  }

  // Step 4: Periodic Docker sync (every 24h) to pick up late holiday announcements.
  if (!_syncTimer) {
    _syncTimer = setInterval(() => {
      runSyncAndRefresh().catch(() => {});
    }, SYNC_INTERVAL_MS);
    if (_syncTimer.unref) _syncTimer.unref();
  }

  logger.info({ event: "MARKET_CALENDAR_WORKER_STARTED", cacheRefreshMs: CACHE_REFRESH_MS });
};

/** Stop timers (used in graceful shutdown or tests). */
const stopMarketCalendarWorker = () => {
  if (_cacheTimer) { clearInterval(_cacheTimer); _cacheTimer = null; }
  if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null; }
};

module.exports = { startMarketCalendarWorker, stopMarketCalendarWorker };
