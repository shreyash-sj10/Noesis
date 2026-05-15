/**
 * E2E: inject TRADE_CLOSED outbox row → poller → reflection persisted on trade.
 * Uses inline queue fallback (no Redis) so processTradeClosedEvent runs synchronously.
 */
process.env.NODE_ENV = "test";
process.env.USE_REDIS = "false";

const mongoose = require("mongoose");
const { randomUUID } = require("crypto");
const User = require("../../src/models/user.model");
const Trade = require("../../src/models/trade.model");
const Outbox = require("../../src/models/outbox.model");

jest.mock("../../src/services/aiExplanation.service", () => ({
  generateReflectionSummary: jest.fn().mockResolvedValue({ summary: "Integration reflection summary" }),
  parseTradeIntent: jest.fn(),
  generateExplanation: jest.fn(),
  generateFinalTradeCall: jest.fn(),
}));

jest.mock("../../src/services/analytics.service", () => ({
  persistUserAnalyticsSnapshot: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../src/queue/queue", () => ({
  tradeQueue: {
    add: async (jobName, payload) => {
      if (jobName === "TRADE_CLOSED") {
        const { processTradeClosedEvent } = require("../../src/services/reflectionWorker.service");
        await processTradeClosedEvent(payload);
      }
      return { status: "PROCESSED_SYNCHRONOUSLY" };
    },
  },
  registerInlineJobHandler: jest.fn(),
}));

jest.setTimeout(60000);

const mongoUri =
  process.env.MONGO_URI || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/trading_platform_test";

const { processOutbox } = require("../../src/workers/outbox.worker");

describe("Outbox TRADE_CLOSED → reflection (integration)", () => {
  let userId;

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });
    }
    const user = await User.create({
      name: "Outbox E2E",
      email: `outbox-e2e-${Date.now()}@test.local`,
      password: "password123",
      balance: 5_000_000,
    });
    userId = user._id;
  });

  afterAll(async () => {
    if (userId) {
      await Outbox.deleteMany({ "payload.userId": String(userId) });
      await Trade.deleteMany({ user: userId });
      await User.deleteOne({ _id: userId });
    }
  });

  it("processes TRADE_CLOSED outbox job and sets reflection on sell trade", async () => {
    const entry = await Trade.create({
      user: userId,
      symbol: "RELIANCE",
      type: "BUY",
      productType: "DELIVERY",
      quantity: 1,
      pricePaise: 100_000,
      totalValuePaise: 100_000,
      idempotencyKey: `e2e-entry-${randomUUID()}`,
      status: "EXECUTED",
      entryPlan: {
        entryPricePaise: 100_000,
        stopLossPaise: 95_000,
        targetPricePaise: 110_000,
      },
      trace: { timeline: [{ stage: "EXECUTION_COMMITTED" }] },
    });

    const sell = await Trade.create({
      user: userId,
      symbol: "RELIANCE",
      type: "SELL",
      productType: "DELIVERY",
      quantity: 1,
      pricePaise: 102_000,
      totalValuePaise: 102_000,
      idempotencyKey: `e2e-sell-${randomUUID()}`,
      pnlPaise: 2_000,
      pnlPct: 2,
      status: "CLOSED",
      reflectionStatus: null,
      entryTradeId: entry._id,
      trace: { timeline: [{ stage: "EXECUTION_COMMITTED" }] },
    });

    await Outbox.create({
      type: "TRADE_CLOSED",
      payload: { tradeId: String(sell._id), userId: String(userId) },
      status: "PENDING",
      nextAttemptAt: new Date(),
    });

    const waitForReflectionCompletion = async (tradeId, maxAttempts = 20) => {
      for (let i = 0; i < maxAttempts; i += 1) {
        await processOutbox();
        const state = await Trade.findById(tradeId).lean();
        if (state?.reflectionStatus === "DONE") return state;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return Trade.findById(tradeId).lean();
    };

    const updated = await waitForReflectionCompletion(sell._id);
    expect(updated.reflectionStatus).toBe("DONE");
    expect(updated.learningOutcome).toBeTruthy();
    expect(typeof updated.learningOutcome.verdict).toBe("string");
    expect(updated.status).toBe("COMPLETE");

    const outboxRow = await Outbox.findOne({
      type: "TRADE_CLOSED",
      "payload.tradeId": String(sell._id),
    }).lean();
    expect(outboxRow.status).toBe("COMPLETED");
  });
});
