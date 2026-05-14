/**
 * MARKET HOURS UTILITY
 *
 * Authority chain:
 *   1. In-memory calendar cache  — populated by marketCalendar.worker.js from MongoDB.
 *   2. Naive weekday / clock     — fallback for isSquareoffWindowEligible only (time-of-day
 *                                   checks still require clock; holiday check uses calendar).
 *
 * isMarketOpen() contract:
 *   - Calendar entry exists → authoritative (no fallback to weekday detection).
 *   - No cache entry for today → return false (fail-safe per trading system requirement).
 *
 * isSquareoffWindowEligible() contract:
 *   - Calendar says holiday → return false (calendar veto).
 *   - No cache entry / market open → fall through to clock check (is it past 15:20 IST?).
 *
 * refreshCalendarCache() is async and is called by the worker; all other exports are sync.
 */
const IST_TZ = "Asia/Kolkata";

// ---------------------------------------------------------------------------
// IST helpers
// ---------------------------------------------------------------------------

const getIstParts = (date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: IST_TZ,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  return map;
};

const toWeekdayIndex = (weekdayShort) => {
  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[weekdayShort] ?? -1;
};

/** Returns "YYYY-MM-DD" for the given Date object in IST. */
const getIstDateKey = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

/** Parses "HH:MM" or "HH:MM:SS" → total minutes since midnight. Returns null on bad input. */
const parseTimeToMinutes = (hhmm) => {
  if (!hhmm || typeof hhmm !== "string") return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

// ---------------------------------------------------------------------------
// In-memory calendar cache
// dateKey: "YYYY-MM-DD" (IST) or null if not yet populated.
// entry:   MarketCalendar document (plain object) or null (holiday / unknown).
// ---------------------------------------------------------------------------
let _cache = { dateKey: null, entry: null };

/**
 * Async — called by marketCalendar.worker.js every 60 s.
 * Reads today's MarketCalendar document from MongoDB and updates the module-level cache.
 * Silently ignores errors (stale cache remains if DB is temporarily unreachable).
 */
const refreshCalendarCache = async (now = new Date()) => {
  const MarketCalendar = require("../models/marketCalendar.model");
  const logger = require("./logger");
  const exchange = process.env.CALENDAR_EXCHANGE_MIC || "XNSE";
  const dateKey = getIstDateKey(now);

  try {
    const entry = await MarketCalendar.findOne({ date: dateKey, exchange }).lean();
    _cache = { dateKey, entry: entry || null };
    logger.info({ event: "MARKET_CALENDAR_CACHE_REFRESHED", date: dateKey, isOpen: entry?.isOpen ?? null });
  } catch (err) {
    require("./logger").warn({ event: "MARKET_CALENDAR_CACHE_REFRESH_FAIL", date: dateKey, message: err?.message });
    // Do NOT clear the cache on DB error — stale is safer than empty.
  }
};

// ---------------------------------------------------------------------------
// Public API (synchronous)
// ---------------------------------------------------------------------------

/**
 * Returns true only when the market is currently open based on the calendar.
 *
 * Calendar is the SOLE authority:
 *   - No cache entry for today → false (fail-safe — treat as CLOSED).
 *   - Calendar says isOpen=false → false (holiday).
 *   - Calendar says isOpen=true → compare current IST time to openTime/closeTime.
 */
const isMarketOpen = (now = new Date()) => {
  const dateKey = getIstDateKey(now);

  // Cache miss → fail-safe closed.
  if (_cache.dateKey !== dateKey || _cache.entry === null) return false;

  const { entry } = _cache;

  // Exchange holiday or known non-trading day.
  if (!entry.isOpen) return false;

  // Time-of-day check using calendar's own open/close times.
  const parts = getIstParts(now);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;

  const currentMinutes = hour * 60 + minute;
  const openMinutes = parseTimeToMinutes(entry.openTime) ?? 9 * 60 + 15;
  const closeMinutes = parseTimeToMinutes(entry.closeTime) ?? 15 * 60 + 30;

  return currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
};

/**
 * Returns a string describing the current market state.
 * Uses calendar when available; falls back to naive weekday + hardcoded NSE hours otherwise.
 */
const getMarketClockState = (now = new Date()) => {
  const dateKey = getIstDateKey(now);
  const parts = getIstParts(now);
  const day = toWeekdayIndex(parts.weekday);

  if (day === 0 || day === 6) return "WEEKEND";

  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return "CLOSED";

  const totalMinutes = hour * 60 + minute;

  // Use calendar entry when available for accurate times.
  if (_cache.dateKey === dateKey && _cache.entry !== null) {
    if (!_cache.entry.isOpen) return "HOLIDAY";
    const openMins = parseTimeToMinutes(_cache.entry.openTime) ?? 9 * 60 + 15;
    const closeMins = parseTimeToMinutes(_cache.entry.closeTime) ?? 15 * 60 + 30;
    if (totalMinutes < openMins) return "PRE_OPEN";
    if (totalMinutes <= closeMins) return "OPEN";
    return "POST_CLOSE";
  }

  // Naive fallback for clock state (no calendar data yet).
  const OPEN_MINUTES = 9 * 60 + 15;
  const CLOSE_MINUTES = 15 * 60 + 30;
  if (totalMinutes < OPEN_MINUTES) return "PRE_OPEN";
  if (totalMinutes <= CLOSE_MINUTES) return "OPEN";
  return "POST_CLOSE";
};

const isAfterMarketClose = (now = new Date()) => getMarketClockState(now) === "POST_CLOSE";

/** Minutes since midnight IST for the configured intraday squareoff time (default 15:20). */
const getSquareoffMinutesIst = () => {
  const raw = String(process.env.SQUAREOFF_TIME_IST || "15:20").trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) return 15 * 60 + 20;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return h * 60 + min;
};

/**
 * Returns true when the squareoff window is eligible to run.
 *
 * Combined authority:
 *   1. Calendar veto: if today is a known holiday → false (no squareoff on holidays).
 *   2. Weekend check (preserved for resilience when cache is empty).
 *   3. Clock check: current IST time >= configured squareoff time (e.g. 15:20).
 *
 * Note: unlike isMarketOpen, this function falls through to the clock check when the
 * calendar cache has no entry for today (conservative — still prevents squareoff on
 * weekends, but allows it on normal trading days even if calendar sync is lagging).
 */
const isSquareoffWindowEligible = (now = new Date()) => {
  const dateKey = getIstDateKey(now);

  // Calendar holiday veto — only when we have a confirmed "closed" entry.
  if (_cache.dateKey === dateKey && _cache.entry !== null) {
    if (!_cache.entry.isOpen) return false;
  }

  // Weekday guard (always enforced regardless of calendar).
  const parts = getIstParts(now);
  const day = toWeekdayIndex(parts.weekday);
  if (day === 0 || day === 6) return false;

  // Clock check: is it past the squareoff cutoff?
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;

  return hour * 60 + minute >= getSquareoffMinutesIst();
};

/** IST wall clock for operational alerts (hour 0–23 in Asia/Kolkata). */
const getIstWallClock = (now = new Date()) => {
  const parts = getIstParts(now);
  return {
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekdayShort: parts.weekday,
  };
};

/**
 * True when the in-memory cache is for "today" (IST) but Mongo returned no
 * MarketCalendar document — isMarketOpen() stays false (fail-safe).
 */
const isCalendarDocumentMissingToday = (now = new Date()) => {
  const dateKey = getIstDateKey(now);
  return _cache.dateKey === dateKey && _cache.entry === null;
};

/**
 * Single JSON snapshot for clients and ops: IST clock, NSE session bounds,
 * square-off time, calendar row presence, and execution gate (isMarketOpen).
 */
const getMarketSessionSnapshot = (now = new Date()) => {
  const dateKey = getIstDateKey(now);
  const clockState = getMarketClockState(now);
  const exchangeMic = String(process.env.CALENDAR_EXCHANGE_MIC || "XNSE").trim() || "XNSE";
  const squareoffTimeIst = String(process.env.SQUAREOFF_TIME_IST || "15:20").trim();
  const cacheAligned = _cache.dateKey === dateKey;
  const entry = cacheAligned ? _cache.entry : null;
  const openTimeIst = entry?.openTime ?? "09:15";
  const closeTimeIst = entry?.closeTime ?? "15:30";

  return {
    timeZone: IST_TZ,
    istDateKey: dateKey,
    clockState,
    isMarketOpen: isMarketOpen(now),
    isSquareoffWindowEligible: isSquareoffWindowEligible(now),
    exchangeMic,
    nseCashSession: {
      label: "NSE cash (regular)",
      openTimeIst,
      closeTimeIst,
      note:
        "Regular session is typically 09:15–15:30 IST. Intraday auto square-off uses squareoffTimeIst (default 15:20) before the official close.",
    },
    squareoffTimeIst,
    calendarRowPresent: entry !== null,
    calendarCacheAlignedToToday: cacheAligned,
    calendar: entry
      ? {
          date: entry.date,
          isOpen: entry.isOpen,
          openTime: entry.openTime,
          closeTime: entry.closeTime,
          holiday: entry.holiday ?? null,
          isHalfDay: Boolean(entry.isHalfDay),
        }
      : null,
    dataIntegrityHint:
      cacheAligned && entry === null
        ? "No MarketCalendar document for today in MongoDB — execution treats the session as CLOSED until a row exists (sync or seed)."
        : null,
  };
};

module.exports = {
  isMarketOpen,
  getMarketClockState,
  isAfterMarketClose,
  isSquareoffWindowEligible,
  getSquareoffMinutesIst,
  getIstDateKey,
  refreshCalendarCache,
  getIstWallClock,
  isCalendarDocumentMissingToday,
  getMarketSessionSnapshot,
};
