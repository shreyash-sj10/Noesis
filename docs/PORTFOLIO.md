# NOESIS — Portfolio & Resume Pack

*Behavior-Aware Trading Intelligence Platform (NSE paper trading). Use this document for GitHub, Notion, PDF exports, or interview prep. Adjust first person (“I built…”) if you prefer.*

---

## Name

**NOESIS** — *Behavior-Aware Trading Intelligence Platform* (NSE paper trading)

*Alternative subtitle:* Process-first Indian equity simulator with deterministic pre-trade gates and post-trade reflection.

---

## Summary

NOESIS is a **full-stack paper trading platform** for the **Indian equity market (NSE)**. It simulates **delivery** and **intraday (buy-only)** flows with **brokerage-like rules**: IST sessions, **holiday-aware market open/close**, **T+1-style settlement thinking**, and **intraday auto square-off** near **15:20 IST**—without connecting to a live broker or moving real money.

Unlike typical “PnL dashboards,” the product treats **trader psychology and intent** as **first-class data**: users capture **entry reasoning** before trades; **rule-based engines** score **setup, market context, and behavior** and can **block** execution; every trade stores an **immutable decision snapshot**. After exits, a **reflection layer** classifies **how** the exit happened relative to the original plan (e.g. stop vs panic vs target), separating **disciplined outcomes** from **lucky ones** so the app does not reinforce bad process just because PnL was positive.

**AI is optional and non-authoritative**: it may summarize decisions in plain English; **all BUY/AVOID/WAIT verdicts are deterministic and auditable**—same inputs, same outputs, with strong automated tests.

---

## Architecture

**High level**

- **Client:** React + TanStack Query (React Query); trade terminal, portfolio, journal/analytics-oriented UI.
- **API:** Node.js 20 + Express; Zod validation; layered routes (auth, trades, intelligence, market, portfolio/analysis).
- **Core domain:** Modular **services** + **pure “engine” modules** (entry, exit, reflection, risk, behavior) for testability and clear boundaries.
- **Persistence:** MongoDB + Mongoose; **replica set + multi-document transactions** for money, holdings, trades, and **outbox** rows committed together.
- **Caching / optional infra:** Redis (Upstash-style REST when enabled) for price cache, auth cache slices, rate limits, debounce locks; **system remains logically correct when Redis is off** (degraded paths).
- **Market data:** Yahoo Finance–backed quote path with **throttling** and tiered resolution (Redis → memory → live → stale handling with **execution blocked on stale**).
- **Background work:** In-process **interval workers** (outbox consumer, stop/target monitor, square-off scheduler, calendar refresh). **Documented constraint:** designed for **single API instance** to avoid duplicate automation unless you later split workers + distributed locks.

**Cross-cutting**

- Structured logging (Winston), request **trace IDs**, `/health`, `/ready`, metrics hooks.
- **Security middleware:** Helmet, CORS allowlist, mongo sanitization, JWT access + HttpOnly refresh + CSRF for refresh, trade rate limits.

---

## Features

**Trading & market realism (simulated)**

- Delivery vs intraday products; intraday **auto square-off**; market open checks tied to **calendar data** (fail-safe behavior when calendar is missing vs square-off window semantics—documented in README).
- **Queued execution** when market closed where applicable (pending execution → sweeper/executor path).
- **Stop-loss and take-profit automation** via polling worker; debouncing / locks to reduce duplicate triggers.

**Behavior & learning**

- Pre-trade capture: **reasoning**, conviction, plan fields.
- **Behavioral flags** from recent history (e.g. revenge-style same-symbol re-entry risk, FOMO near square-off, panic exits—see engines and `preTradeGuard` / behavior services).
- **Analytics snapshot**: skill/discipline-style composites, tags, trends after enough closed history.

**Safety & integrity**

- **Pre-trade token** with **HMAC over canonical trade fields** so execution cannot drift from what was scored.
- **Idempotent execution** via execution locks; **payload hash mismatch** rejects “replay with different body.”
- **Integer paise** end-to-end for monetary fields; drift checks vs live quote at execution.

**UX / product**

- Clear verdict UX (BUY / CAUTION / AVOID), score breakdowns, degraded modes when data or AI is unavailable (no fake numbers for “unknown PnL”).
- Guided / beginner-oriented flows (wizard, checklist, templates) as described in README.

---

## Tech stack

| Area | Choices |
|------|--------|
| Frontend | React, Vite, TanStack Query |
| Backend | Node.js 20, Express |
| Data | MongoDB (Mongoose), replica-set transactions |
| Cache / queue (optional) | Redis / Upstash REST; BullMQ paths where applicable with fallbacks |
| Validation | Zod |
| Auth | JWT access (short TTL, in-memory on client), refresh in HttpOnly cookie, CSRF on refresh |
| Market data | yahoo-finance2 (throttled); optional Finnhub keys per env docs |
| AI (optional) | Google Gemini — synthesis only |
| Testing | Jest, mongodb-memory-server (replica set for txn tests) |
| CI | GitHub Actions |
| Deploy (documented) | e.g. Railway single instance; static frontend |

---

## Why I built it

Most trading tools **record execution** (price, qty, time) but are **blind to intent and psychology**: a revenge trade and a disciplined plan look identical in the database. That makes it hard for beginners to **learn process** and easy to **misread luck as skill**.

This project exists to:

1. **Force explicit planning and self-awareness** before risk is taken (even simulated).
2. **Enforce minimum plan quality** (e.g. risk/reward) server-side, not only in the UI.
3. **Feed back on behavior**, not only on PnL—so “green days” that came from broken process are not celebrated the same way as disciplined ones.

---

## Problems faced

*Grounded in README “Lessons learned” and limitations; keep only bullets you personally implemented or debugged.*

1. **Correctness under concurrency:** concurrent orders and average-cost updates—addressed with **transactional updates** and **DB-side aggregation** for weighted average cost rather than naive read-modify-write races.
2. **Idempotency vs security:** replaying completed executions without verifying the payload could be abused—addressed with **stored request payload hash** and **PAYLOAD_MISMATCH** behavior.
3. **Behavior rules that were too broad:** early revenge-trading logic blocked unrelated symbols—tightened to **symbol-scoped** revenge windows.
4. **Market data reality:** unofficial/throttled feeds → **caching tiers**, strict **stale execution block**, and honest UX when live quotes are unavailable.
5. **Automation at scale:** in-process workers do not horizontally scale safely—**documented** operational constraint; mitigation patterns (locks, single replica) called out explicitly (`backend/docs/BACKGROUND_WORKERS_SCALE.md`).
6. **Token TTL vs UX:** short pre-trade token lifetime vs slow “wizard” journeys—known tradeoff; candidates for heartbeat or longer TTL policy.

---

## Design decisions

1. **Deterministic engines for decisions** — testable, explainable, interview-defensible; avoids “black box” AI trading claims.
2. **Behavioral veto floor** — low behavior score can **hard-block** regardless of attractive setup/market scores (thesis: psychology can invalidate a “good” chart).
3. **Pre-trade token + HMAC** — binds **scored plan** to **execution payload**; prevents silent tampering between screens.
4. **Outbox inside the transaction** — reflection/analytics jobs are triggered **exactly when** the trade state commits—no “trade saved but event lost” split.
5. **Human-in-the-loop for capital changes** — system-driven sells still go through the same conceptual **decision token** pathway as user sells (no hidden privileged path).
6. **Paise integers** — avoids floating-point money bugs; rounding at boundaries is explicit.
7. **Fail-safe market open** vs **square-off clock authority** — different defaults documented: safer to miss a session than trade on a holiday; square-off has stricter operational needs—handled deliberately.

---

## AI usage

- **What AI does:** Optional **post-decision explanation** / narrative synthesis (e.g. Gemini), best-effort; can return **UNAVAILABLE** with safe UI handling.
- **What AI does not do:** It does **not** place trades, change scores, or override engines. **Verdicts and blocks are rule-based and deterministic.**
- **Why that split:** Keeps the product **auditable** and avoids misleading “AI alpha” positioning while still helping beginners **understand** a structured decision record.

---

## System flow

**A. Auth**

Register/login → short-lived **access JWT** in app memory → refresh via **HttpOnly cookie** + **CSRF** header on refresh → optional Redis-backed identity cache (not a source of truth for balances).

**B. Pre-trade (intelligence)**

Client submits plan + reasoning → server: news/sentiment processing (with unavailable states) → behavioral history/flags → **risk/RR validation** → **entry engine** composite score + gates → if not blocked: issue **preTradeToken** + **payload hash** + optional AI explanation.

**C. Execution**

Client calls buy/sell with **idempotency key** + **preTradeToken** → rate limits / market clock → **idempotency replay or lock** → live price fetch (reject stale) → **Mongo transaction**: claim token, reserve/check balances, create/update trade, execute or queue, update holdings, **outbox event** on close paths, invariants check, complete lock, consume token.

**D. Post-trade**

Outbox worker processes **TRADE_CLOSED** → **reflection engine** updates learning fields → **analytics snapshot** recomputation → user sees journal/reflection cards and updated profile stats.

**E. Automation**

Interval workers: **stop/target monitoring** (market open, not in square-off window), **intraday square-off batch** with concurrency limits and a **once-per-day** execution claim pattern.

---

## Resume bullet points

Pick 3–5 for a one-page resume; tailor to backend vs full-stack vs fintech roles.

1. Architected and implemented a **full-stack NSE paper-trading simulator** with **delivery/intraday** flows, **IST market/session rules**, and **intraday square-off**, using **MongoDB transactions** for **atomic balances, holdings, trades, and outbox events**.
2. Built a **deterministic pre-trade intelligence pipeline** combining **risk/reward validation**, **news/sentiment context**, and **behavioral scoring** with a **hard behavioral veto**; persisted **immutable decision snapshots** on each trade for auditability.
3. Implemented **execution safety**: **HMAC-bound pre-trade tokens**, **idempotent trade requests** with **payload-hash replay protection**, **integer paise** monetary model, and **stale-quote execution blocking**.
4. Developed **post-trade reflection and analytics** driven by an **outbox pattern**, classifying exits vs plans to separate **disciplined vs lucky outcomes** and surface **repeatable behavioral patterns** from history.
5. Added **production-oriented middleware and observability**: structured logging with **trace correlation**, health/readiness endpoints, security headers, auth hardening (**HttpOnly refresh + CSRF**), and a **broad Jest suite** spanning **unit, integration, and concurrency** scenarios.
6. Scoped **optional AI** strictly to **non-blocking explanations** while keeping **all trading verdicts rule-based**, preserving **testable, deterministic** system behavior.

---

## Related docs

- Root `README.md` — full system specification, API reference, and runbook.
- `backend/docs/BACKGROUND_WORKERS_SCALE.md` — worker scaling constraints.
- `docs/SYSTEM_DESIGN.md`, `docs/FinalSystemArchitecture.md` — additional architecture material if present in this repo.

---

*Paper trading simulation only. No real money. Not affiliated with any exchange or brokerage.*
