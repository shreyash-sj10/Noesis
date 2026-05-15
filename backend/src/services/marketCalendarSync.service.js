/**
 * MARKET CALENDAR SYNC SERVICE
 *
 * Pulls the trading calendar for a given exchange from the
 * apptastic-software/trading-calendar Docker service and upserts
 * every day into the MarketCalendar collection.
 *
 * Docker image: ghcr.io/apptastic-software/trading-calendar:latest
 * Default URL:  http://localhost:8080
 * Docs:         https://github.com/apptastic-software/trading-calendar
 *
 * Environment variables:
 *   TRADING_CALENDAR_URL  — base URL of the Docker service (no trailing slash)
 *   CALENDAR_EXCHANGE_MIC — ISO 10383 MIC code (default: XNSE for NSE India)
 *
 * Fail-safe: any network or parse error is logged and swallowed — the app
 * continues with whatever data is already in MongoDB.
 */
const axios = require("axios");
const MarketCalendar = require("../models/marketCalendar.model");
const logger = require("../utils/logger");

const BASE_URL = () =>
  (process.env.TRADING_CALENDAR_URL || "http://localhost:8080").replace(/\/$/, "");
const EXCHANGE_MIC = () => process.env.CALENDAR_EXCHANGE_MIC || "XNSE";
const SYNC_TIMEOUT_MS = Number(process.env.CALENDAR_SYNC_TIMEOUT_MS || 15000);

/**
 * Returns YYYY-MM-DD strings for current year + next year so the calendar
 * is always populated at least 12 months ahead.
 */
const buildDateRange = () => {
  const year = new Date().getFullYear();
  return { from: `${year}-01-01`, to: `${year + 1}-12-31` };
};

/**
 * Normalize a single trading-day entry from the Docker service response.
 *
 * The service can return various shapes depending on version:
 *   { date, is_open, open, close, is_partial_day }
 *   { date, isOpen, openTime, closeTime, isHalfDay }
 * Both are handled below.
 */
const normalizeDay = (raw) => ({
  date: raw.date,
  isOpen: raw.is_open ?? raw.isOpen ?? true,
  openTime: (raw.open ?? raw.openTime ?? "09:15").substring(0, 5),   // "09:15:00" → "09:15"
  closeTime: (raw.close ?? raw.closeTime ?? "15:30").substring(0, 5),
  isHalfDay: raw.is_partial_day ?? raw.isPartialDay ?? raw.isHalfDay ?? false,
});

/**
 * Fetch raw trading-day array from the Docker service.
 * Tries two common endpoint shapes:
 *   /api/v1/tradingdays?mic=XNSE&from=...&to=...   (newer builds)
 *   /api/v1/markets/XNSE/tradingdays?from=...&to=... (older builds)
 */
const fetchFromService = async (mic, from, to) => {
  const base = BASE_URL();
  const endpoints = [
    `${base}/api/v1/tradingdays?mic=${mic}&from=${from}&to=${to}`,
    `${base}/api/v1/markets/${mic}/tradingdays?from=${from}&to=${to}`,
  ];

  let lastErr;
  for (const url of endpoints) {
    try {
      const { data } = await axios.get(url, { timeout: SYNC_TIMEOUT_MS });
      // Response might be an array directly or wrapped in a key
      const days = Array.isArray(data)
        ? data
        : data?.tradingDays ?? data?.calendar ?? data?.days ?? [];
      if (days.length > 0) return days;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("CALENDAR_SERVICE_EMPTY_RESPONSE");
};

/**
 * Main entry point: fetch + upsert.
 * Returns the number of days upserted, or 0 on failure.
 */
const syncCalendar = async () => {
  const mic = EXCHANGE_MIC();
  const { from, to } = buildDateRange();

  try {
    const raw = await fetchFromService(mic, from, to);
    if (!Array.isArray(raw) || raw.length === 0) {
      logger.warn({ event: "MARKET_CALENDAR_SYNC_EMPTY", mic, from, to });
      return 0;
    }

    const ops = raw
      .filter((d) => d?.date)
      .map((d) => {
        const norm = normalizeDay(d);
        return {
          updateOne: {
            filter: { date: norm.date, exchange: mic },
            update: { $set: { ...norm, exchange: mic } },
            upsert: true,
          },
        };
      });

    if (ops.length === 0) {
      logger.warn({ event: "MARKET_CALENDAR_SYNC_EMPTY", mic, from, to });
      return 0;
    }

    await MarketCalendar.bulkWrite(ops, { ordered: false });

    logger.info({
      event: "MARKET_CALENDAR_SYNCED",
      mic,
      from,
      to,
      count: ops.length,
    });
    return ops.length;
  } catch (err) {
    logger.warn({
      event: "MARKET_CALENDAR_SYNC_FAILED",
      mic,
      baseUrl: BASE_URL(),
      message: err.message,
      hint:
        "Start Docker: docker run -p 8080:8080 ghcr.io/apptastic-software/trading-calendar:latest — or npm run seed:calendar",
    });
    return 0;
  }
};

module.exports = { syncCalendar };
