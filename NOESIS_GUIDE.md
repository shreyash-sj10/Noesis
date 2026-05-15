# NOESIS — Complete Project Defense Guide

**Purpose:** Interview preparation for the NOESIS codebase only. Every claim below is tied to files under `backend/` and `frontend/`. When the code and this doc disagree, **the code wins** — re-read the cited path before an interview.

**How to use:** Read one section at a time aloud as if a staff engineer is cross-examining you. For any gap, open the cited file and update your mental model.

---

## 1. One-line pitch & introduction

### One-line pitch (deliver without thinking)

**NOESIS is a behavior-aware, full-stack paper trading simulator for Indian NSE-oriented cash equities that enforces pre-trade discipline, atomic execution, and post-trade reflection—without a live broker.**

### Project overview (30–60 seconds)

NOESIS is not a charting toy or a spreadsheet with buttons. It is a **decision system** that treats each trade as a lifecycle: you must earn a **pre-trade authority token** (deterministic engines + optional AI explanation), execute through **idempotent, transactional** buy/sell paths with **integer paise** money math, and then receive **learning outcomes** when positions close (reflection engine + outbox worker). The React SPA in `frontend/src/v2/` is the operator console; the Node API in `backend/src/` is the source of truth. Market data comes from **Yahoo Finance** (and optional Finnhub for news)—not a licensed NSE feed—so the product is honest about simulation limits while still failing closed when prices are untrustable (`STALE`, drift checks).

---

## 2. Why you built it

### What problem existed before

Typical paper-trading apps record fills and PnL. They rarely capture **why** a trade was allowed, **whether the process was sound when the trade lost money**, or **whether automation (stop-loss, square-off) used the same rules as the human**. Retail learners also mix **delivery vs intraday** mental models with floating-point rupee math, which creates silent bugs at scale.

### Why existing solutions failed (for your goals)

- **Broker paper modes** optimize for order placement, not pedagogy or audit trails.
- **Spreadsheet trackers** have no enforced pre-trade gate, no idempotency, no concurrent-write safety.
- **Generic MERN demos** rarely combine replica-set transactions, outbox pattern, HMAC-bound execution payloads, and reflection taxonomy in one repo.

### Your specific insight

Separate **process from outcome**: a disciplined loss (`DISCIPLINED_LOSS`) is a success state for learning; a lucky profit with poor process (`LUCKY_PROFIT`) is a warning. Bind execution to a **cryptographic payload hash** of the trade plan so the UI cannot silently change size or product type after approval. Run side effects (reflection, analytics snapshots) through an **outbox** so the HTTP request stays fast and retries are explicit.

### What success looks like

A reviewer can trace any executed trade from UI click → pre-trade token → MongoDB rows → outbox job → reflection verdict, without hand-waving. The system refuses execution when the market clock or price integrity says no, and survives refresh/retry without double-spending balance or double-filling quantity.

---

## 3. Architecture

### Components and single responsibility

| Component | Responsibility | Primary location |
|-----------|----------------|------------------|
| React SPA | UX, server-state caching, session UX | `frontend/src/v2/` |
| Express app | HTTP routing, CORS, global middleware | `backend/src/app.js` |
| Controllers | Translate HTTP ↔ service calls | `backend/src/controllers/` |
| Services | Business workflows, orchestration | `backend/src/services/` |
| Engines | Pure decision logic (entry/exit/reflection) | `backend/src/engines/` |
| Models | Mongoose schemas, indexes | `backend/src/models/` |
| Workers / queue | Async polling, BullMQ when Redis healthy | `backend/src/workers/`, `queue/` |
| Infra | WS quotes, Redis health, runtime flags | `backend/src/infra/` |
| MongoDB | System of record | Atlas or local replica set |
| Redis (optional) | Cache, rate-limit store, pre-trade cache, BullMQ | `backend/src/utils/redisClient.js` |

### How components communicate

- **Client → API:** HTTPS JSON under `/api/*`; JWT access in `Authorization: Bearer`; refresh via HttpOnly cookie + CSRF on `POST /api/auth/refresh` (`auth.controller.js`, `frontend/src/v2/api/api.js`).
- **API → DB:** Mongoose inside `runInTransaction()` for trade hot paths (`backend/src/utils/transaction.js` — verify in codebase).
- **API → market data:** `price.engine.js` → Yahoo provider; optional Finnhub for news.
- **API → client realtime:** WebSocket `/api/ws/live-quote` (`infra/liveQuoteWs.js`) mirrors quote path used by `GET /api/market/quote`.
- **API → async:** Outbox inserts in trade transaction; `outbox.worker.js` polls and dispatches handlers.

### Where state lives and why

| State | Where | Why |
|-------|--------|-----|
| Money, holdings, trades | MongoDB | Must be transactional and durable |
| Access JWT | Memory on client (`accessTokenStore.js`) | Reduces XSS token theft vs localStorage |
| Refresh token | HttpOnly cookie | Not readable by JS |
| UI server data | TanStack Query | Cache, refetch, stale times per feature |
| Ephemeral quotes | Redis + in-memory tiers | Protect Yahoo; serve UI fast |
| Pre-trade token | MongoDB `PreTradeToken` (+ optional Redis cache) | Survives restart; multi-instance safe |

### Whiteboard view

One **Node process** (today) runs HTTP + WebSocket + in-process timers (outbox, SL monitor, square-off, calendar sync, sweeper, executor). One **MongoDB replica set** holds authoritative state. Optional **Redis** improves cache and queues but is not required for trade correctness (degraded mode paths exist in `server.js`).

### Why this architecture over the obvious alternative

- **Monolith API + SPA** instead of microservices: interview artifact and learning product; operational simplicity; clear request tracing.
- **MongoDB + transactions** instead of Postgres: document model fits trade/holding snapshots; you still paid the cost of **replica set** for multi-document atomicity.
- **Outbox polling** instead of only synchronous reflection: user-facing latency stays bounded; retries are inspectable via `Outbox` collection.

### If each component goes down

| Failure | Effect |
|---------|--------|
| MongoDB down | API readiness fails (`/ready`); trades cannot commit |
| Redis down | Rate limits may be per-instance; BullMQ squareoff may fall back to poll; pre-trade may read DB only; core trades still work |
| Yahoo / quotes stale | Execution blocked when `STALE`; UI may still show cached quotes with session labels |
| Single API instance killed | In-flight HTTP may fail; idempotency keys allow safe client retry; outbox may leave `PROCESSING` until recovery logic runs |
| WebSocket drop | UI falls back to HTTP quote refresh (`useMarketQuote` patterns) |

### Single points of failure (honest)

- **One MongoDB cluster** (no multi-region story in repo).
- **One active API instance** for correct background job semantics unless you externalize workers (`backend/docs/BACKGROUND_WORKERS_SCALE.md`).
- **JWT_SECRET** compromise breaks auth and pre-trade HMAC trust.

### Architecture interview questions

**Why separate engines from services?** Engines stay pure and unit-tested (`backend/tests/unit/entry.engine.test.js`, etc.). Services handle I/O, clocks, and persistence.

**What if you replaced MongoDB?** You would need another store with **multi-document ACID** (or sagas everywhere). Every `runInTransaction` block and unique index (`ExecutionLock`, `Holding`) would need a migration plan.

**Request flow (generic):** Client → `app.js` global middleware (`requestTrace`, `metricsOnRequest`, `helmet`, `express.json`, `mongoSanitize`, CORS) → route middleware chain → controller → service → models → `error.middleware.js` envelope.

**Where it breaks under load:** Per-user trade rate limit (`trade.route.js`); Yahoo throttle (`p-queue` in price engine); Mongo write contention on hot user documents; duplicate outbox pollers if you scale API horizontally without coordination.

---

## 4. System flow — three critical journeys

Know these cold. Draw each on a whiteboard without opening the repo.

### Flow A — Register + first session

1. **User** submits email/password on `/register` (SPA).
2. **Client** `POST /api/auth/register` with Zod-validated body (`auth.route.js`).
3. **Server** hashes password (`user.model.js` pre-save bcrypt), creates `User` with default `balance` in **paise** (default 10_000_000 paise = ₹100,000 in seed semantics — verify `user.model.js`).
4. **DB after register:** one `users` document: `email`, `password` hash, `balance`, `reservedBalancePaise: 0`, empty holdings via separate collection later.
5. **Login** `POST /api/auth/login` issues short-lived **access JWT** (`tokenType: "access"`) + sets **refresh** HttpOnly cookie; may return `csrfToken` for SPA (`auth.controller.js`).
6. **Client** `AuthContext.jsx` stores access token in memory, mirrors CSRF to `sessionStorage` when cookies are cross-origin opaque.
7. **Bootstrap** on dashboard load: if no access token, `bootstrapAccessTokenFromCookies()` → `POST /api/auth/refresh` with `X-CSRF-Token` → new access JWT.
8. **UI** loads portfolio via TanStack Query (`usePortfolioSummary`), session strip via `useMarketSession` → `GET /api/market/session`.

**User sees:** login → dashboard with cash/equity KPIs; top bar **SESSION OPEN** or **AFTER HOURS** (not a fake “market LIVE” label).

### Flow B — Pre-trade token + BUY (happy path)

**User action:** Completes trade wizard, clicks execute buy.

| Step | Layer | What happens |
|------|--------|----------------|
| 1 | Client | Validates form locally; calls `POST /api/intelligence/pre-trade` with plan fields |
| 2 | Route | `intelligence.route.js` → `validatePreTradePayload` → `preTradeGuard.service.js` |
| 3 | Service | Loads news/behavior context; `evaluateEntryDecision` (twice — note `productType` omitted on `plan` in engine calls, but bound in HMAC at token issue — `preTradeGuard.service.js` lines ~91–132) |
| 4 | Authority | `issueDecisionToken` in `preTradeAuthority.store.js`: UUID token, `payloadHash = HMAC-SHA256(JWT_SECRET, canonical JSON)`, `expiresAt`, `state: VALID`; optional Redis `pretrade:{token}` |
| 5 | DB write | `PreTradeToken` insert; AI explanation may run async — does not block token |
| 6 | Client | Receives token + verdict; user confirms; `POST /api/trades/buy` with `Authorization`, `Idempotency-Key`, `pre-trade-token`, body matching hashed fields |
| 7 | Middleware chain | `protect` → `tradeLimiter` (per-user, Redis if available) → `enforceRequestId` → `validateTradePayload` (Zod) → `enforceBuyReview` (token required) → `checkMarketClock` → controller |
| 8 | Service | `trade.service.js`: replay check on `ExecutionLock`; `getPrice` — reject `STALE`; `runInTransaction` |
| 9 | Txn | Claim token `VALID→IN_USE`; verify `payloadHash`; debit `User.balance`; upsert `Holding`; insert `Trade`; write `ExecutionLock` COMPLETED with stored response; token `CONSUMED` |
| 10 | Response | Structured envelope + `meta.traceId` |
| 11 | Client | Invalidates portfolio queries; UI shows new position |

**Atomic:** Token claim + balance + holding + trade + lock completion are intended to commit or roll back together inside the session transaction (verify `trade.service.js` `executeBuyWithIdempotency` / similar entry points).

**Safe retry:** Same `Idempotency-Key` + same body → replay stored envelope; different body → `PAYLOAD_MISMATCH`.

**User sees on failure:** Rate limit message; market closed queue message; `PRICE_STALE`; 401 → silent refresh attempt then logout if refresh fails.

### Flow C — SELL / close + reflection (async)

1. User sells (or SL monitor / square-off triggers sell path in automation services).
2. Trade moves through statuses (`trade.model.js` enums include `CLOSED`, `EXECUTED_PENDING_REFLECTION`, etc.).
3. **Outbox** event inserted (e.g. trade closed) — worker picks up (`outbox.worker.js`, default poll `OUTBOX_POLL_MS` ~5s).
4. Handler invokes **reflection** pipeline (`reflection.engine.js` + `exit.engine.js`) → learning outcome enum.
5. **User** sees updated journal / metrics on next fetch — not necessarily in the same HTTP response as sell.

**Not atomic with HTTP:** Reflection is eventual; user may briefly see “pending reflection” states.

### Flow D — Session status UX (clarification fix)

- **Backend truth:** `GET /api/market/session` (calendar + IST clock).
- **Top bar:** `useMarketSession` + `topbarSessionLabel()` → **SESSION OPEN** / **AFTER HOURS**.
- **Home status row:** `buildSystemStatus(..., sessionSnap)` — Market **OPEN/CLOSED** from API; Data **SYNCED/DELAYED** (never “LIVE” for feeds).

---

## 5. Tech stack (with tradeoffs)

For each choice, answer: *why this, what you gain, what you give up, what breaks if it disappears.*

| Choice | Why NOESIS | Gain | Give up | If removed |
|--------|------------|------|---------|------------|
| **MongoDB** | Document model for trades/holdings; team familiarity | Flexible schema, horizontal scaling story on Atlas | SQL joins, strict relational constraints in DB | Project stops without replica set transactions |
| **Express 4** | Ecosystem, middleware model | Fast to ship, huge middleware catalog | Built-in perf vs Fastify/Hono | Rewrite routing layer |
| **React 19 + Vite 7** | Modern SPA DX | Fast HMR, lean deploy as static `dist/` | SEO without SSR | Rebuild UI stack |
| **TanStack Query** | Server-state cache | Declarative refetch, stale times | Global client state complexity | Manual fetch + cache bugs |
| **JWT access + cookie refresh** | SPA on separate origin | Stateless access verification | Refresh rotation discipline | Session store alternative |
| **bcryptjs** | Password hashing in `user.model` | Well understood | Argon2 memory hardness | Must swap hash algo + migrate |
| **Zod** | `validateTradePayload`, auth schemas | Runtime + clear errors | Bundle size on edge | Manual validation drift |
| **yahoo-finance2** | Free quotes for paper sim | No commercial data contract | Rate limits, unofficial | Need licensed feed for production realism |
| **Winston + Morgan** | Ops logs | JSON structured logs | Not full OpenTelemetry | Harder distributed trace |
| **ws** | Live quote stream | Lower latency UI | LB sticky upgrades | HTTP-only quotes |
| **Jest + Vitest** | Split backend/frontend tests | CI parity | E2E browser gap | Less confidence in UI regressions |

**Not acceptable alone for architecture questions:** “I was familiar with it.” Pair familiarity with **failure mode** or **constraint** (e.g. replica set required because of `runInTransaction`).

---

## 6. Data model

MongoDB uses **10 Mongoose models** (`backend/src/models/`):

| Collection / model | Purpose |
|--------------------|---------|
| `User` | Auth, cash balance (paise), analytics snapshot fields |
| `Trade` | Buy/sell ledger, statuses, reflection fields, paise amounts |
| `Holding` | Aggregated position per `userId + symbol + tradeType` |
| `PreTradeToken` | Authority tokens, HMAC hash, TTL, state machine |
| `ExecutionLock` | Per-user idempotency + stored response replay |
| `Outbox` | Async jobs with retry metadata |
| `MarketCalendar` | NSE session / holiday rows |
| `Trace` | Trace persistence (supporting observability) |
| `Stock` | Symbol metadata (as used in codebase) |
| `SystemExecutionState` | Square-off / system claim coordination |

### Keys and indexes (high signal)

- **Holding:** unique `{ userId, symbol, tradeType }` — prevents duplicate position rows for same product class (`holding.model.js`).
- **PreTradeToken:** unique `token`; TTL on `expiresAt`.
- **ExecutionLock:** unique per `{ userId, requestId }` (idempotency); legacy global idempotency index dropped at startup (see server logs / migration scripts).
- **Trade:** scoped idempotency index per user (see startup log `idx_trade_user_idempotency_uniq`).

### Enums matter

`productType`: `DELIVERY` | `INTRADAY` — affects square-off and holding key.  
`Trade.status` — includes `PENDING_EXECUTION`, `CLOSED`, `EXECUTED_PENDING_REFLECTION`, etc. — drives UI and workers.

### Walkthrough: DB after one complete BUY (simplified)

Assume user had ₹100,000 cash, buys 10 shares RELIANCE delivery at ₹2,500.00 (250000 paise/share) — illustrative numbers only:

- **users:** `balance` decreased by `quantity * pricePaise` (+ fees if modeled); `totalInvested` increased.
- **holdings:** one row `(userId, RELIANCE, DELIVERY)` with `quantity: 10`, `avgPricePaise: 250000`.
- **trades:** one `BUY` `EXECUTED` with `pricePaise`, `totalValuePaise`, `stopLossPaise`, `targetPricePaise`.
- **pretradetokens:** token row `state: CONSUMED` or deleted per consume path.
- **executionlocks:** `COMPLETED` with `responseData` for replay.

After **SELL** closing the position: holding quantity zeroed or removed; trade `CLOSED`; **outbox** row `PENDING` → `COMPLETED` after reflection; user `realizedPnL` updated per service rules.

### Corrupt state examples

- Double spend if idempotency bypassed — prevented by `ExecutionLock` + transaction.
- Token replay with altered qty — prevented by `payloadHash` mismatch.
- Two holdings for same symbol — prevented by unique compound index.

---

## 7. Backend deep dive

### Request lifecycle (global order in `app.js`)

1. `requestTrace` — assigns trace / request ids.
2. `metricsOnRequest` — counters.
3. `helmet`, `express.json`, `mongoSanitize`.
4. Root probes: `/health`, `/ready`, `/metrics`.
5. CORS (allowlist `FRONTEND_URL` / `FRONTEND_URLS`, dev defaults include port **5180**).
6. `/api` cache-control no-store.
7. Morgan → Winston.
8. Mounted routers (`/api/auth`, `/api/trades`, …).
9. `error.middleware.js` last.

### Trade route middleware order (`trade.route.js`)

`protect` → `tradeLimiter` → `enforceRequestId` → `validateTradePayload` → `enforceBuyReview` / `enforceSellReview` → `checkMarketClock` → controller.

**`enforceBuyReview`:** requires `pre-trade-token` header/body — soft `userThinking` text check was removed as bypassable (comment in `trade.route.js` lines 77–88).

### Service layer rules

- **Routes:** HTTP concerns only.
- **Services:** orchestration, transactions, external I/O.
- **Engines:** no DB, no side effects — deterministic given inputs.

### SQL injection

Not applicable; Mongoose + `express-mongo-sanitize` for operator injection mitigation.

### Transactions

Trade execution paths use Mongo sessions (`claimPreTradeTokenInSession`, balance updates). Anything after commit via outbox is **eventually consistent**.

### Error handling

`AppError` with status codes; `error.middleware` shapes client JSON; unexpected errors logged; stack hidden in production (`NODE_ENV=production`).

### Background workers (`server.js` when not `NODE_ENV=test`)

| Worker | Interval / trigger | If throws | If two instances |
|--------|-------------------|-----------|------------------|
| Outbox poller | `OUTBOX_POLL_MS` | Logged; retry/backoff on row | Duplicate work — mitigated by idempotent handlers, still noisy |
| Stop-loss monitor | ~30s | Logged per tick | Duplicate scans |
| Square-off scheduler | IST + claim model | Claim staleness envs | Race on same day claim |
| Market calendar | cache refresh + Docker sync | Degraded calendar seed in dev | Duplicate sync |
| Order sweeper / executor | cron / interval | Logged | Duplicate execution attempts — trade locks help |

---

## 8. Frontend deep dive

### State management

| Kind | Examples | Why |
|------|----------|-----|
| Server state | `usePortfolioSummary`, `useAttentionDecisions`, `useMarketSession` | Source of truth from API |
| Local UI | wizard steps, modal open, `behaviorAck` on home | Ephemeral |
| Auth | `AuthContext` user object; token in memory | Security + UX |

**On refresh:** TanStack Query refetches; access token re-bootstrap via refresh cookie; user may flash loading skeletons.

**Stale state:** Query `staleTime` / `refetchInterval` (session strip 60s). Portfolio invalidated after trade mutations.

### Auth flow (client)

- Token: **memory** (`accessTokenStore.js`), not localStorage for access.
- Attached: Axios interceptor in `api.js` adds `Authorization: Bearer`.
- **401:** coordinated `refreshInFlight` single refresh; retry once; else logout.
- CSRF: `sessionStorage` + cookie fallback for `POST /auth/refresh`.

### Realtime

- WebSocket `buildLiveQuoteWebSocketUrl()` — JWT in query string.
- On drop: HTTP polling hooks still work; user sees last cached quote with delayed labeling.
- Duplicate WS messages: UI should key off symbol + timestamp (verify hook implementation).

### Role-based UI

If `user.role` exists in model, **server must enforce** on every protected route (`auth.middleware`). Client-side hiding is UX only, not security.

### Error UX

- API errors normalized (`normalizeApiError.js`).
- Network fail: toast / inline error on forms.
- Session expired: redirect login after failed refresh.

---

## 9. Concurrency and edge cases (NOESIS)

### Two trades same symbol simultaneously

Mongo transaction + holding upsert serializes per document; second txn may fail validation (insufficient balance / quantity). Idempotency keys are per **request**, not per symbol — two different keys = two intentional trades.

### Pre-trade token replay with different body

`payloadHash` mismatch → rejection inside transaction (`trade.service.js`).

### Outbox worker crashes mid-job

Row may sit `PROCESSING` until timeout/recovery logic; events retry up to `maxAttempts`.

### Redis down during trade

Execution continues; rate limit store may be in-memory per instance; BullMQ paths degrade (`server.js` warnings).

### Client retries POST buy after timeout

Same idempotency key + same body → replay; different body → `PAYLOAD_MISMATCH`; never double-charge if lock completed.

### Stale quote on client

Server re-fetches via `getPrice`; `STALE` rejected at execution; `MAX_CLIENT_PRICE_DRIFT_PCT` can 422 if client price diverges.

---

## 10. Reliability and failure handling

| Operation | Failure mode | User sees | Recovery |
|-----------|--------------|-----------|----------|
| Buy | Mongo txn abort | Error envelope | Retry with same idempotency key |
| Buy | Market closed | Queued/rejected per `checkMarketClock` | Try in session |
| Buy | STALE price | 422-style message | Refresh quote |
| Reflection | Worker fail | Journal pending | Outbox retry |
| Calendar Docker down | Warning logs; seed fallback dev | Strip hint | `seed:calendar` |

**Observability today:** Winston logs, `/metrics` counters, `/api/observability/jobs/summary` for outbox depth — **no** Prometheus exporter in-tree.

---

## 11. Security and production practices

| Topic | Implementation |
|-------|----------------|
| Access JWT | `jwt.verify`, `tokenType === "access"` (`auth.middleware.js`) |
| Refresh | HttpOnly cookie; rotation in controller |
| CSRF | Required on refresh unless `SKIP_CSRF_DEV` (blocked in prod by `verify-env.js`) |
| Pre-trade replay | HMAC over canonical fields (`preTradeAuthority.store.js`) |
| Rate limits | Global + trade limiter; Redis-backed when available |
| XSS | React escaping; avoid `dangerouslySetInnerHTML` |
| Secrets | `JWT_SECRET`, `MONGO_URI` in env — never commit `.env` |

**JWT_SECRET leak:** attacker forges access tokens and pre-trade hashes — rotate secret invalidates all sessions; plan maintenance window.

---

## 12. Performance

**Measure before claiming in interviews:** run `curl` timing on `GET /api/portfolio/summary` and heaviest `POST /api/trades/buy` in dev.

**Known heavy paths:** pre-trade intelligence (news + engines); portfolio summary aggregation; Yahoo fetch cold.

**Caches:** quote tiers in `price.engine.js`; optional Redis; auth user cache **excludes balance** intentionally (`auth.middleware.js` comment).

**Bundle:** run `npm run build` in `frontend` and note `dist` asset sizes.

**First to break under load:** Yahoo throttle, Mongo hot user document, single-threaded Node event loop CPU.

---

## 13. Scalability and production thinking

**Current bottleneck:** in-process workers → **one API instance** recommended (`backend/docs/BACKGROUND_WORKERS_SCALE.md`).

**Horizontal scale blockers:** outbox poller duplication, square-off claims, SL monitor duplicate scans, in-memory rate limits without Redis.

**Fix path:** dedicated worker dyno, BullMQ-only scheduling, distributed locks on claims, Redis for all rate limits.

**Deploy:** `render.yaml` example — `healthCheckPath: /health`; frontend static on CDN; align `FRONTEND_URL` and `VITE_API_BASE_URL`.

**Migrations:** scripts in `backend/scripts/` — run with care on live DB; no automated zero-downtime story documented.

---

## 14. Testing

| Area | Count (verify with `npm test`) |
|------|--------------------------------|
| Backend test files | **48** `*.test.js` (includes `src/**/__tests__`) |
| Backend test cases | **201** total (last full run; **2** integration failures possible in `system.audit.test.js` — fix before claiming “all green”) |
| Frontend test files | **2** |
| Frontend test cases | **4** |

**Categories in repo:**

- **Unit:** engines, risk, reflection, adapters.
- **Integration:** `trade.flow.test.js`, market session contract, holdings, square-off.
- **Security:** `tests/security/auth.security.test.js`, `token.security.test.js`.
- **Concurrency:** `reflection.stress.test.js`.

**What tests miss:** Full browser E2E, licensed market data correctness, multi-instance worker races in CI.

**Important tests to explain:**

- `trade.flow.test.js` — end-to-end HTTP trade path.
- `trade.priceStale.test.js` — execution blocks stale quotes.
- `token.security.test.js` — auth edge cases.

---

## 15. Known limitations (say unprompted)

1. **Market data** is not NSE licensed; Yahoo/Finnhub can lag or fail.
2. **Single-instance workers** unless you redesign for scale.
3. **Pre-trade engine weights** omit `productType` on `plan` in `evaluateEntryDecision` calls — HMAC still binds product type at execution.
4. **Integration audit test** may fail on portfolio contract — check CI locally.
5. **Topbar ticker** can show % changes after hours — not “market open.”
6. **AI (Gemini)** is advisory only; never blocks token issuance.
7. **No Prometheus** — metrics are JSON counters only.

---

## 16. Future improvements (explainable only)

1. **Licensed NSE feed adapter** — new provider interface in `services/providers/`, same `price.engine` facade; high cost/complexity.
2. **Dedicated worker service** — move outbox/SL/square-off out of `server.js`; medium complexity; enables horizontal API.
3. **Pass `productType` into entry engine plan** — one-line architectural fix in `preTradeGuard.service.js` for scoring consistency.
4. **Playwright E2E** — login + buy + journal assertion; catches SPA regressions.
5. **OpenTelemetry** — trace export from `requestTrace` middleware.

**Priority:** worker externalization + fix flaky integration tests before marketing “production ready.”

---

## 17. What you would do differently

**Reverse:** in-process everything in `server.js` — I would start with a **worker entrypoint** once the second scaling requirement appeared, because retrofitting coordination is harder than separating processes early.

**Change tech:** consider **Postgres** if relational reporting became first-class — but only with a migration budget; Mongo fits document trades well today.

**Under-engineered:** early **STATUS copy** conflated “data synced” with “market live” — confused users; fixed with session-aware labels (`useMarketSession`, `SYNCED`).

**Over-engineered:** dual pre-trade `evaluateEntryDecision` calls — could be one call with adapted context merged.

**Learned:** **idempotency + HMAC payload binding** is cheaper than debugging double trades in production.

---

## 18. The numbers (verify before interview)

Run these commands the week of your interview and update the table:

```bash
cd backend && npm test 2>&1 | tail -5
cd frontend && npm run test:unit
# Count routes: see Section API inventory below
```

| Metric | Value (codebase snapshot) |
|--------|---------------------------|
| REST route handlers (incl. root + `/api` duplicates) | **~44** HTTP handlers + **1** WebSocket path |
| Mongoose models | **10** |
| Backend test files | **48** |
| Backend test cases | **201** (confirm pass count) |
| Frontend test cases | **4** |
| Default dev ports | API **5001** (`.env.example`), SPA **5180** (`vite.config.js`) |
| Real users | **Honest:** personal / demo / interview — state your truth |
| Deployment | Render blueprint example; local dev primary |
| CI | `.github/workflows/ci.yml` — Node 20, Mongo 6 service |

### API inventory (checklist)

**Root:** `GET /health`, `GET /ready`, `GET /metrics`  
**Auth:** register, login, refresh, logout  
**Users:** me, profile  
**Trades:** buy, sell, list, execution-status  
**Portfolio:** summary, positions  
**Market:** session, indices, overview, validate, quote, history, fundamentals, news, news/portfolio, explore  
**Intelligence:** pre-trade, judge-trade, news, portfolio, global, timeline, profile  
**Journal / analysis / metrics / trace / observability** — see `backend/src/routes/`

---

## Red-flag checklist (before interview)

- [ ] Draw architecture from memory in under 3 minutes  
- [ ] Walk pre-trade → buy → outbox without notes  
- [ ] State limitations unprompted (Yahoo data, single instance, HMAC nuance)  
- [ ] Every “why Mongo/Express/JWT” answer includes a tradeoff  
- [ ] Resume claims match Section 18 numbers  

**If all checked:** you are defensible on NOESIS. **If not:** read the cited file until you can teach it.

---

## Quick file index (defense navigation)

| Topic | File |
|-------|------|
| App bootstrap | `backend/src/server.js` |
| HTTP stack | `backend/src/app.js` |
| Buy middleware | `backend/src/routes/trade.route.js` |
| Trade txn | `backend/src/services/trade.service.js` |
| Pre-trade HMAC | `backend/src/services/intelligence/preTradeAuthority.store.js` |
| Entry decision | `backend/src/engines/entry.engine.js` |
| Reflection | `backend/src/engines/reflection.engine.js` |
| Outbox | `backend/src/workers/outbox.worker.js` |
| Client API | `frontend/src/v2/api/api.js` |
| Auth UX | `frontend/src/features/auth/AuthContext.jsx` |
| Session UX | `frontend/src/v2/hooks/useMarketSession.ts` |
| Scale doc | `backend/docs/BACKGROUND_WORKERS_SCALE.md` |

---

*End of NOESIS_GUIDE.md — fill measured numbers in Section 18 after your latest `npm test` run.*
