const request = require("supertest");
process.env.NODE_ENV = "test";
process.env.ALLOW_CLOSED_MARKET_EXECUTION = "true";
jest.setTimeout(120000);

jest.mock("../../src/services/news/news.engine", () => ({
  getProcessedNews: jest.fn().mockImplementation(async (sym) => ({
    symbol: sym || "",
    status: "VALID",
    signals: [
      {
        id: "jest-consensus",
        event: "Synthetic consensus for integration tests",
        verdict: "BUY",
        impact: "BULLISH",
        confidence: 80,
        sector: "GENERAL",
        mechanism: "TEST_STUB",
        isConsensus: true,
        status: "VALID",
      },
    ],
    stats: { total: 1, lastUpdated: new Date().toISOString() },
  })),
}));

jest.mock("../../src/services/marketData.service", () => ({
  validateSymbol: jest.fn().mockResolvedValue({ isValid: true, pricePaise: 200000 }),
  getLivePrices: jest.fn().mockResolvedValue({}),
  getLivePrice: jest.fn().mockResolvedValue(200000),
  resolvePrice: jest.fn(),
}));

/** Execution path uses `price.engine.getPrice`; mirror legacy resolvePrice behavior for tests. */
jest.mock("../../src/services/price.engine", () => ({
  getPrice: jest.fn().mockImplementation(async (sym) => {
    const s = String(sym || "").toUpperCase();
    if (s.includes("IDEM")) {
      return { pricePaise: 1000, source: "LIVE" };
    }
    if (s.includes("NIFTY")) {
      return { pricePaise: 2200000, source: "LIVE" };
    }
    if (s.includes("FIFO")) {
      return { pricePaise: 10000, source: "LIVE" };
    }
    return { pricePaise: 10000, source: "LIVE" };
  }),
}));

const app = require("../../src/app");
const mongoose = require("mongoose");
const Trade = require("../../src/models/trade.model");
const Holding = require("../../src/models/holding.model");
const ExecutionLock = require("../../src/models/executionLock.model");
const User = require("../../src/models/user.model");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

require("dotenv").config();
const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/trading_platform_test";

describe("Institutional Trade Integrity Suite (Full Hardening Audit)", () => {
    let userToken;
    let userId;

    beforeAll(async () => {
        await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 20000 });
        // Use an existing test user or create one
        let user = await User.findOne({ email: "institutional-tester@marketpulse.ai" });

        if (!user) {
            user = await User.create({
                name: "Institutional Tester",
                email: "institutional-tester@marketpulse.ai",
                password: "password123",
                balance: 100000000, 
                realizedPnL: 0
            });
        } else {
            user.balance = 100000000;
            await user.save();
        }

        userId = user._id;
        userToken = jwt.sign(
            { userId: user._id, tokenType: "access" },
            process.env.JWT_SECRET || "default_secret"
        );
    }, 120000);

    afterAll(async () => {
        await mongoose.connection.close();
    });

    test("1. Full Lifecycle: BUY -> SELL -> Snapshot -> Reflection Integrity", async () => {
        const idempotencyBuy = randomUUID();
        const symbol = "NIFTY_HARDENED";

        const preBuy = await request(app)
            .post("/api/intelligence/pre-trade")
            .set("Authorization", `Bearer ${userToken}`)
            .send({
                symbol,
                side: "BUY",
                quantity: 10,
                pricePaise: 2200000,
                stopLossPaise: 2180000,
                targetPricePaise: 2250000,
                userThinking: "Analyzing demand zone. Momentum Breakout.",
            });

        expect(preBuy.status).toBe(200);
        const buyToken = preBuy.body.data?.token ?? preBuy.body.data?.authority?.token;

        const buyRes = await request(app)
            .post("/api/trades/buy")
            .set("Authorization", `Bearer ${userToken}`)
            .set("idempotency-key", idempotencyBuy)
            .set("pre-trade-token", buyToken)
            .send({
                symbol,
                side: "BUY",
                quantity: 10,
                pricePaise: 2200000,
                stopLossPaise: 2180000,
                targetPricePaise: 2250000,
                preTradeEmotion: "CALM",
                preTradeToken: buyToken,
                decisionContext: { stage: "FINAL_EXECUTION" },
                userThinking: "Momentum Breakout confirmed.",
            });

        expect(buyRes.status).toBe(201);

        const preSell = await request(app)
            .post("/api/intelligence/pre-trade")
            .set("Authorization", `Bearer ${userToken}`)
            .send({
                symbol,
                side: "SELL",
                pricePaise: 2200000,
                quantity: 10,
                userThinking: "Exit after build.",
            });
        expect(preSell.status).toBe(200);
        const sellToken = preSell.body.data?.token ?? preSell.body.data?.authority?.token;

        const idempotencySell = randomUUID();
        const sellRes = await request(app)
            .post("/api/trades/sell")
            .set("Authorization", `Bearer ${userToken}`)
            .set("idempotency-key", idempotencySell)
            .set("pre-trade-token", sellToken)
            .send({
                symbol,
                side: "SELL",
                quantity: 10,
                pricePaise: 2200000,
                preTradeEmotion: "DISCIPLINED",
                preTradeToken: sellToken,
                decisionContext: { stage: "EXIT_PROTOCOL" },
                userThinking: "Target reached.",
            });

        expect(sellRes.status).toBe(201);
        const sellTrade = sellRes.body.data;
        expect(sellTrade.side).toBe("SELL");
        expect(sellTrade).toHaveProperty("pnlPaise");
        // Fills use `getPrice` mock (2200000) for both legs → flat round-trip.
        expect(typeof sellTrade.pnlPaise).toBe("number");
        expect(sellTrade.pnlPaise).toBe(0);

        const persistedSell = await Trade.findById(sellTrade.tradeId).lean();
        expect(typeof persistedSell?.pnlPaise).toBe("number");
        expect(persistedSell.pnlPaise).toBe(0);
    }, 20000);

    test("2. System Enforcement: Reject Invalid Trade (Bad RR)", async () => {
        const symbol = "NIFTY_RR_FAIL";
        const preTradeRes = await request(app)
            .post("/api/intelligence/pre-trade")
            .set("Authorization", `Bearer ${userToken}`)
            .send({ 
                symbol, side: "BUY", pricePaise: 2200000, quantity: 10, stopLossPaise: 2195000, targetPricePaise: 2202000,
                userThinking: "Testing bad RR." 
            });

        // Invalid RR fails plan validation before a token is minted (preTradeGuard).
        expect(preTradeRes.status).toBe(400);
        expect(preTradeRes.body?.error?.code || preTradeRes.body?.message || "").toMatch(/INVALID|RR|PLAN/i);
    });

    test("3. Security Enforcement: Reject direct API call (no preTradeToken)", async () => {
        // Zod now enforces preTradeToken as required at the schema layer (400),
        // before enforceBuyReview even runs (403). Either gate correctly blocks
        // the request — the important invariant is that it is rejected.
        const bypassRes = await request(app)
            .post("/api/trades/buy")
            .set("Authorization", `Bearer ${userToken}`)
            .set("idempotency-key", randomUUID())
            .send({
                symbol: "BYPASS",
                side: "BUY",
                quantity: 1,
                pricePaise: 10000,
                stopLossPaise: 9000,
                targetPricePaise: 12000,
                decisionContext: { stage: "B" },
                userThinking: "Bypass attempt should be blocked by pre-trade gate.",
            });
        expect([400, 403]).toContain(bypassRes.status);
        expect(bypassRes.body?.success).toBe(false);
    });

    test("4. Idempotency Guard", async () => {
        const idempotencyKey = randomUUID();
        const symbol = "IDEM_TEST";
        const tokenRes = await request(app).post("/api/intelligence/pre-trade").set("Authorization", `Bearer ${userToken}`)
            .send({ symbol, side: "BUY", pricePaise: 1000, quantity: 1, stopLossPaise: 800, targetPricePaise: 1500, userThinking: "T" });
        const token = tokenRes.body.data?.token ?? tokenRes.body.data?.authority?.token;
        const payload = {
            symbol,
            side: "BUY",
            quantity: 1,
            pricePaise: 1000,
            stopLossPaise: 800,
            targetPricePaise: 1500,
            preTradeEmotion: "CALM",
            preTradeToken: token,
            decisionContext: { stage: "T" },
            userThinking: "Idempotency guard.",
        };

        const res1 = await request(app)
            .post("/api/trades/buy")
            .set("Authorization", `Bearer ${userToken}`)
            .set("idempotency-key", idempotencyKey)
            .set("pre-trade-token", token)
            .send(payload);
        expect(res1.status).toBe(201);
        const res2 = await request(app)
            .post("/api/trades/buy")
            .set("Authorization", `Bearer ${userToken}`)
            .set("idempotency-key", idempotencyKey)
            .set("pre-trade-token", token)
            .send(payload);
        expect(res2.status).toBe(201);
        expect(res2.body.data?.tradeId).toBe(res1.body.data?.tradeId);
    });

    test("5. FIFO Mapping", async () => {
       const symbol = "FIFO_TEST.NS";
       // Direct DB create to bypass complex setup
       await Trade.create({
           user: userId,
           symbol,
           type: "BUY",
           quantity: 10,
           pricePaise: 10000,
           totalValuePaise: 100000,
           stopLossPaise: 9000,
           targetPricePaise: 12000,
           rr: 2,
           idempotencyKey: randomUUID(),
           entryPlan: { entryPricePaise: 10000, stopLossPaise: 9000, targetPricePaise: 12000, rr: 2, intent: "L", reasoning: "T" },
           decisionSnapshot: { verdict: "BUY", score: 80, pillars: {} },
       });

       await Holding.create({
           userId,
           symbol,
           quantity: 10,
           avgPricePaise: 10000,
           tradeType: "DELIVERY",
       });

       const sellTokenRes = await request(app).post("/api/intelligence/pre-trade").set("Authorization", `Bearer ${userToken}`)
           .send({ symbol, side: "SELL", pricePaise: 10000, quantity: 5, userThinking: "Exit position" });
       const sellToken = sellTokenRes.body?.data?.token;

       const sellRes = await request(app)
           .post("/api/trades/sell")
           .set("Authorization", `Bearer ${userToken}`)
           .set("idempotency-key", randomUUID())
           .set("pre-trade-token", sellToken)
           .send({
               symbol,
               side: "SELL",
               quantity: 5,
               pricePaise: 10000,
               preTradeEmotion: "CONFIDENT",
               preTradeToken: sellToken,
               decisionContext: { stage: "F" },
               userThinking: "FIFO partial exit.",
           });

       expect(sellRes.status).toBe(201);
       const journalRes = await request(app).get("/api/journal/summary").set("Authorization", `Bearer ${userToken}`);
       const entries = journalRes.body.data?.entries || [];
       const cards = entries.filter((c) => c.symbol === symbol);
       expect(cards.length).toBe(1);
       expect(cards[0].quantity).toBe(5);
    });

    test("6. Rate Limiting", async () => {
        const statuses = [];
        for (let i = 0; i < 12; i++) {
            const r = await request(app)
                .post("/api/trades/buy")
                .set("Authorization", `Bearer ${userToken}`)
                .set("idempotency-key", randomUUID())
                .send({
                    symbol: "SPAM",
                    side: "BUY",
                    quantity: 1,
                    pricePaise: 100,
                    stopLossPaise: 90,
                    targetPricePaise: 120,
                    preTradeEmotion: "CALM",
                    decisionContext: { stage: "S" },
                    userThinking: "Rate limiter coverage — no valid pre-trade token.",
                });
            statuses.push(r.status);
        }
        expect(statuses.some((s) => s === 429)).toBe(true);
    }, 15000);
});

