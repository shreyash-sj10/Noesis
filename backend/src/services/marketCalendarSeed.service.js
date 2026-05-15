/**
 * Naive NSE calendar seed: Mon–Fri open 09:15–15:30 IST, weekends closed.
 * Not holiday-accurate — use trading-calendar Docker sync for production.
 */
const MarketCalendar = require("../models/marketCalendar.model");
const logger = require("../utils/logger");

const EXCHANGE = () => (process.env.CALENDAR_EXCHANGE_MIC || "XNSE").toUpperCase();

const istDateKey = (d) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

const isWeekendIst = (d) => {
  const w = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", weekday: "short" }).format(d);
  return w === "Sat" || w === "Sun";
};

const addDays = (date, n) => {
  const x = new Date(date);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};

/**
 * @param {{ from?: string, to?: string }} opts YYYY-MM-DD
 * @returns {Promise<number>} days upserted
 */
async function seedNaiveCalendarRange(opts = {}) {
  const year = new Date().getFullYear();
  const from = opts.from || `${year}-01-01`;
  const to = opts.to || `${year + 1}-12-31`;
  const exchange = EXCHANGE();

  const ops = [];
  let cursor = new Date(`${from}T12:00:00.000Z`);
  const end = new Date(`${to}T12:00:00.000Z`);

  while (cursor <= end) {
    const date = istDateKey(cursor);
    const weekend = isWeekendIst(cursor);
    ops.push({
      updateOne: {
        filter: { date, exchange },
        update: {
          $set: {
            date,
            exchange,
            isOpen: !weekend,
            openTime: "09:15",
            closeTime: "15:30",
            isHalfDay: false,
          },
        },
        upsert: true,
      },
    });
    cursor = addDays(cursor, 1);
  }

  if (ops.length === 0) return 0;

  const BATCH = 500;
  let total = 0;
  for (let i = 0; i < ops.length; i += BATCH) {
    const res = await MarketCalendar.bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
    total += res.upsertedCount + res.modifiedCount;
  }

  logger.info({
    event: "MARKET_CALENDAR_NAIVE_SEED",
    exchange,
    from,
    to,
    dayCount: ops.length,
    writeAck: total,
  });
  return ops.length;
}

module.exports = { seedNaiveCalendarRange, istDateKey };
