# NOESIS Interview Master Guide

This is a single-source interview preparation document for your project.
Use it to answer product, architecture, backend, security, failure, and trade-off questions with clear structure.

---

## 1) One-Line Project Definition

NOESIS is a behavior-aware paper trading system that evaluates decision quality before trade execution, enforces correctness during execution, and generates post-trade learning feedback beyond simple profit/loss.

---

## 2) Problem, User, and Outcome (Product Clarity)

### Exact Problem (1 sentence)
Most trading platforms provide outcome feedback (profit/loss), but not process feedback (whether the decision itself was disciplined or emotional).

### Primary User Persona
Early-stage traders who understand basic setup concepts but struggle with consistency due to behavioral mistakes (revenge entries, poor risk-reward, plan deviation).

### Before vs After NOESIS
- Before: user learns from noisy outcomes and may reinforce bad behavior through lucky wins.
- After: user gets a decision-quality loop that surfaces patterns and teaches discipline independent of outcome.

### Why Existing Platforms Fail (Gap)
- Focus on execution and PnL analytics.
- Do not capture intent and plan quality.
- Do not classify process quality (disciplined vs lucky).

### Why NOESIS is Better
- Decision-first flow instead of execution-first flow.
- Deterministic risk/behavior controls before execution.
- Reflection and learning layers after trade close.

---

## 3) Core System Philosophy

### Pipeline
User Intent -> Decision -> Execution -> Reflection -> Learning

### Design Principles
- Correctness over convenience.
- Deterministic core, AI as assistive.
- Database as source of truth.
- Performance layers are optional and degradable.

---

## 4) Full End-to-End Flow (Login to Journal/Profile)

## Step 1: Authentication Entry
- User logs in with email/password.
- Backend verifies credentials and issues:
  - Access JWT (short-lived, used in Authorization header).
  - Refresh token (HttpOnly cookie, long-lived, stored hashed in DB).
  - CSRF token (refresh route protection).
- Frontend stores access token in memory and handles silent refresh flow on 401.

### Why this matters
- Access token in memory reduces persistent XSS theft risk.
- Refresh flow supports session continuity without re-login.
- Token type checks prevent refresh/access misuse.

## Step 2: Pre-Trade Decision Engine
- User submits trade plan: symbol, quantity, price, stop-loss/target, reasoning, optional pre-trade emotion.
- Backend evaluates deterministic pillars:
  - Risk-reward quality
  - Behavioral signals (ex: revenge pattern rules)
  - Market context alignment
- Returns verdict (ALLOW/CAUTION/BLOCK), scores, and pre-trade authority token.

### Authority token purpose
- Freezes approved decision context.
- Prevents changing payload after approval.

## Step 3: Execution Engine (Critical Path)
- User confirms trade with:
  - idempotency key
  - pre-trade token
  - execution payload
- Backend revalidates server-side:
  - auth and request validity
  - idempotency lock state
  - payload integrity
  - token validity and ownership
  - price freshness/drift controls
- Executes transaction-safe updates:
  - user balance
  - holdings
  - trade row
  - outbox event
- Marks lock complete and returns replay-safe response.

## Step 4: Reflection Engine (Async)
- Triggered after SELL close via outbox.
- Deterministic reflection classifies process quality:
  - DISCIPLINED_PROFIT
  - LUCKY_PROFIT
  - DISCIPLINED_LOSS
  - POOR_PROCESS variants
- Updates learning fields and behavior tags.
- AI summary runs as non-blocking enrichment.

## Step 5: Journal, Analytics, Profile
- Journal shows plan vs actual and learning per closed trade.
- Analytics aggregates behavior patterns, discipline score, progression.
- Profile updates trader-level behavior model and trend signals.

---

## 5) Architecture in Interview Language

### Frontend (React)
- Captures structured intent and displays decision/learning surfaces.
- Not trusted for enforcement.

### Backend (Node.js + Express)
- Policy authority with 3 engines:
  - Pre-trade decision engine
  - Execution engine
  - Reflection engine
- Service layer owns domain logic; controllers remain thin.

### MongoDB
- Source of truth for financial and lifecycle state.
- Transactions enforce atomicity.
- Stores users, trades, holdings, execution locks, pre-trade tokens, outbox.

### Redis (Optional)
- Used for acceleration: cache/rate limiting/short-lived lookups.
- If down, system degrades in performance, not correctness.

### External Services
- Market data: context and price source.
- Gemini: human-readable explanation only.
- Neither controls correctness-critical decisions.

---

## 6) Critical Concepts You Must Explain Clearly

## A) Idempotency Key vs Payload Integrity
- Idempotency key alone prevents duplicate request handling.
- Key alone does not guarantee intent consistency.
- Add payload hash comparison:
  - same key + same hash -> replay safe response
  - same key + different hash -> reject (PAYLOAD_MISMATCH)

Interview line:
"Idempotency protects retry safety; payload hashing protects intent integrity."

## B) HMAC in NOESIS
- HMAC is generated server-side on canonical payload.
- Stored with pre-trade authority context.
- Execution recomputes and compares.
- Not a client-provided signature system.

Interview line:
"HMAC binds approved payload to execution so post-approval tampering is blocked."

## C) MongoDB Transactions
- Used for atomic multi-write financial updates.
- Requires replica set for true transaction guarantees.

Interview line:
"Financial state transitions are all-or-nothing inside Mongo transactions."

## D) Outbox Pattern
- Outbox event written in same transaction as trade commit.
- Guarantees async reflection/analytics are not lost.

Interview line:
"If trade commits, post-trade event must exist."

## E) Deterministic Core vs AI
- Decision and classification are deterministic.
- AI generates explanations only.
- AI failures never break correctness.

Interview line:
"AI is assistive, not authoritative."

## F) Paise-Based Money Model
- Integer paise avoids floating-point drift in finance.
- Backend/DB/API stay in paise.
- Display conversion to rupees happens at final UI surface.

Interview line:
"All internal money math is integer paise; conversion is display-only."

---

## 7) Failure Stories (Interview-Ready)

## Story 1: Idempotency Was Incomplete Without Payload Hash
Problem:
- Same key reused with changed payload could corrupt intent.
Fix:
- Store canonical payload hash with lock and verify on replay.
Learning:
- Deduplication is not enough; integrity binding is required.

## Story 2: Race Condition in Holdings Update
Problem:
- Read-modify-write caused stale-read overwrite under concurrent requests.
Fix:
- Move update logic to DB-level atomic operations + transaction control.
Learning:
- Application-level sequencing is insufficient for financial concurrency.

## Story 3: Behavioral Rule Was Over-Generalized
Problem:
- Global "recent loss" rule produced false revenge flags.
Fix:
- Added context (same symbol + time window + re-entry pattern).
Learning:
- Behavioral rules must be contextual to avoid false positives.

## Story 4: Token TTL vs Real User Flow
Problem:
- Strict short TTL caused friction for beginner decision time.
Fix:
- Reframed token lifetime as part of user journey (not only security variable).
Learning:
- Correct security design can still fail UX if user behavior is ignored.

---

## 8) Reliability and Degradation Model

## MongoDB Failure
- Execution fails closed.
- No fake success without persistence.

## Redis Failure
- Performance degrades.
- Core correctness unaffected.

## Worker/Queue Failure
- Reflection delayed, not lost (outbox durability).

## Market Data Failure
- Stale/unreliable data blocks execution.

## AI Failure
- Explanation unavailable.
- Decision/execution path unaffected.

---

## 9) Security Model (Layered)

- JWT access/refresh separation.
- Refresh token stored hashed in DB.
- CSRF protection on cookie-based refresh path.
- Schema validation + sanitization against injection.
- Rate limiting for auth/trade abuse resistance.
- CORS allowlist in production.
- Token type checks and expiry checks.
- No trust in frontend-side enforcement.

Short answer:
"Security is layered across identity, input boundary, execution integrity, and request abuse controls."

---

## 10) Scalability Narrative (10x / 100x / 1000x)

## 10x
- Optimize queries/indexes, improve caching, tune worker throughput.

## 100x
- Separate workers from API instances, introduce stronger queue orchestration, harden provider strategy.

## 1000x
- Read models/precomputed analytics, distributed workers, sharding strategy (user-scoped), stronger observability and SLO controls.

Key interview statement:
"First scale tuning, then architecture extraction, then distributed redesign."

---

## 11) Interruption-Style Short Answers

## "What exactly is NOESIS?"
"A behavior-aware paper trading system that evaluates decision quality before trade, enforces safe execution, and reflects after close to classify discipline vs luck."

## "How do you detect revenge trade?"
"Using deterministic contextual signals, not emotion inference: recent loss plus same-symbol rapid re-entry and rule-deviation patterns."

## "What if API is called directly, bypassing frontend?"
"Backend revalidates all constraints; frontend is guidance only."

## "What if user spams buy button?"
"Idempotency lock plus payload hash and DB constraints prevent duplicate execution."

## "What if model blocks a good trade?"
"Rules are explainable and tunable; system can caution vs block depending on risk profile and calibration."

## "Are you predicting market direction?"
"No. The product optimizes decision discipline, not prediction."

---

## 12) Drill Set (High-Value Q&A)

## Q: Same idempotency key with different payload?
A: Reject with payload mismatch after hash comparison; replay only allowed for exact intent match.

## Q: Mongo transaction on standalone or replica set?
A: Replica set required for true transaction guarantees.

## Q: Where are access and refresh tokens stored?
A: Access token in memory; refresh token in HttpOnly cookie; refresh hash in DB.

## Q: What breaks if Redis restarts?
A: Cache/rate-limit behavior and latency degrade; financial correctness remains intact.

## Q: Gemini timeout during pre-trade/reflection?
A: AI path degrades to unavailable/fallback; deterministic decision and execution stay unchanged.

---

## 13) 30-sec, 60-sec, and 90-sec Pitch Templates

## 30-sec
"NOESIS is a behavior-aware paper trading system. It evaluates risk and discipline before execution, enforces transaction-safe and idempotent execution in the backend, and reflects after trade close to classify whether the process was disciplined or luck-driven."

## 60-sec
"The system has three stages: pre-trade decision, execution, and reflection. In pre-trade, deterministic engines evaluate risk, behavior, and market context, then issue a short-lived authority token bound to payload integrity. During execution, backend enforces idempotency, payload consistency, token validity, and price freshness, then commits balance, holdings, trade, and outbox atomically in MongoDB. After close, async reflection classifies process quality and updates journal/profile analytics. Redis and AI are optional accelerators; correctness remains database-backed and deterministic."

## 90-sec (Narrative)
"I built NOESIS after seeing that outcome-only feedback in trading is misleading. A poor decision can still make money once and reinforce bad behavior. So I designed a decision-quality loop: before execution, the system evaluates risk and discipline; during execution, it enforces correctness with idempotency, integrity checks, and transaction-safe updates; after trade close, it reflects on process quality and updates learning insights. The key design principle is separating deterministic correctness from assistive intelligence: AI explains, but never decides."

---

## 14) Red Flags to Avoid in Interviews

- "Redis guarantees correctness."
- "Idempotency just means key exists."
- "AI decides trade quality."
- "Mongo transactions work the same on standalone."
- "Frontend prevents bad trades."
- "Profit means good decision."

---

## 15) Final Summary to Memorize

NOESIS is not just a trading app. It is a controlled decision-quality system:
- Evaluate whether trade should happen.
- Execute safely if approved.
- Learn from process quality after close.

In one line:
Correctness is deterministic, learning is continuous, and performance layers are optional.

