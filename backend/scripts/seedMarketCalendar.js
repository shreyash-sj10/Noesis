/**
 * Seed MarketCalendar rows when TRADING_CALENDAR_URL sync is unavailable (local dev).
 * Weekdays (Mon–Fri IST): isOpen=true, 09:15–15:30. Weekends: isOpen=false.
 * Does NOT include NSE holidays — use trading-calendar Docker sync for production accuracy.
 *
 * Usage (from backend/):
 *   node scripts/seedMarketCalendar.js
 *   node scripts/seedMarketCalendar.js --from 2026-01-01 --to 2026-12-31
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const MarketCalendar = require("../src/models/marketCalendar.model");
const { seedNaiveCalendarRange, istDateKey } = require("../src/services/marketCalendarSeed.service");

const EXCHANGE = (process.env.CALENDAR_EXCHANGE_MIC || "XNSE").toUpperCase();

const parseArg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return fallback;
  return process.argv[i + 1];
};

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error("Set MONGO_URI in backend/.env");
    process.exit(1);
  }

  const year = new Date().getFullYear();
  const from = parseArg("--from", `${year}-01-01`);
  const to = parseArg("--to", `${year + 1}-12-31`);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15_000 });

  const count = await seedNaiveCalendarRange({ from, to });

  const today = istDateKey(new Date());
  const todayRow = await MarketCalendar.findOne({ date: today, exchange: EXCHANGE }).lean();
  console.log(
    `Seeded ${count} day(s) for ${EXCHANGE} (${from} → ${to}). Today (${today}): isOpen=${todayRow?.isOpen ?? "?"}`,
  );
  console.log("Restart the API (or wait ~60s) so marketCalendar.worker refreshes the in-memory cache.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
