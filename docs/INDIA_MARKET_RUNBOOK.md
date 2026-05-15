# India market operations runbook (NOESIS)

This runbook ties together **IST session authority**, **calendar data**, and **paper-trading behaviour** for NSE-oriented simulation.

## Session clock (authoritative behaviour)

- **Regular cash session (typical):** 09:15–15:30 **Asia/Kolkata (IST)**. Actual `openTime` / `closeTime` come from the `MarketCalendar` row for today (supports **half-day** closes).
- **`isMarketOpen()`:** Uses the in-memory calendar cache only. If **no row exists for today**, the session is treated as **CLOSED** (fail-safe).
- **Intraday auto square-off:** Controlled by `SQUAREOFF_TIME_IST` (default **15:20 IST**). This is **before** the 15:30 close by design (broker-style), not a bug.

## API: session snapshot

`GET /api/market/session` (rate-limited, no auth) returns:

- `istDateKey`, `clockState`, `isMarketOpen`, `isSquareoffWindowEligible`
- `exchangeMic` (default `XNSE`)
- `nseCashSession.openTimeIst` / `closeTimeIst`
- `squareoffTimeIst`
- `calendarRowPresent`, `calendar`, `dataIntegrityHint` (when today’s row is missing)

Use this for dashboards and alerting; do not duplicate session math in clients.

## Calendar sync

1. Prefer `TRADING_CALENDAR_URL` pointed at a running [trading-calendar](https://github.com/apptastic-software/trading-calendar) service so Mongo is populated.
2. Worker logs **`MARKET_CALENDAR_ROW_MISSING_TODAY`** (CRITICAL, throttled hourly) on **weekdays 08:00–16:00 IST** when today’s row is still missing — investigate sync or seed.

### Symptom: strip shows `NO CALENDAR ROW` / session always CLOSED / queued orders never fill

**Cause:** `isMarketOpen()` is **fail-safe**: no `MarketCalendar` document for **today’s IST date** → market treated as **closed**. The **execution executor** (`execution.executor.js`) returns immediately when `!isMarketOpen()`, so `PENDING_EXECUTION` trades stay queued even during real NSE hours.

Common triggers:

- Database wipe (`npm run db:clear`) removed `marketcalendars` collection.
- `TRADING_CALENDAR_URL` not running (Docker service on `localhost:8080` by default) so background sync upserts **0** rows.
- Backend never restarted after seeding (in-memory cache refreshes every `CALENDAR_CACHE_REFRESH_MS`, default 60s).

**Fix (pick one):**

```bash
# A) Accurate holidays — start calendar service, then restart API
docker run -p 8080:8080 ghcr.io/apptastic-software/trading-calendar:latest
# In backend/.env: TRADING_CALENDAR_URL=http://localhost:8080

# B) Local dev quick seed (weekdays only; no NSE holidays)
cd backend && npm run seed:calendar
# Restart backend or wait ~60s for cache refresh
```

Verify: `GET /api/market/session` → `calendarRowPresent: true`, `isMarketOpen: true` during 09:15–15:30 IST on a weekday.

## Pre-trade token TTL

- `PRE_TRADE_TOKEN_TTL_MS` (default **600000** = 10 minutes), clamped **60s–15m**.
- Redis hot key TTL tracks the same value.

## Trade rate limits

- Trade limiter sets **`Retry-After`** (seconds) on throttle responses so clients can backoff.

## Scaling reminder

- Run **one** API instance until background workers are split — see `backend/docs/BACKGROUND_WORKERS_SCALE.md`.
