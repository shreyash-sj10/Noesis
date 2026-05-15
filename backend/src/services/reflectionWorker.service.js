const eventBus = require("../utils/eventBus");
const Trade = require("../models/trade.model");
const User = require("../models/user.model");
const Outbox = require("../models/outbox.model");
const { REFLECTION_MAX_ATTEMPTS } = require("../constants/systemConvergence.constants");
const { analyzeReflection } = require("../engines/reflection.engine");
const { runInTransaction } = require("../utils/transaction");
const { generateReflectionSummary } = require("./aiExplanation.service");
const { generateLesson } = require("./lessonGenerator");
const { translateTags } = require("../utils/behaviorTranslator");
const { getTraceId } = require("../context/traceContext");
const { persistUserAnalyticsSnapshot } = require("./analytics.service");
const logger = require("../utils/logger");

const processTradeClosedEvent = async ({ tradeId, userId }) => {
  const _start = Date.now();
  logger.info(`[ReflectionWorker] Start event: TRADE_CLOSED | tradeId: ${tradeId} | userId: ${userId}`);
  
  // ─── PHASE 1: DETERMINISTIC REFLECTION (Retry-Safe via DB transaction) ────────
  // This block is the ONLY part that runs on BullMQ retry.
  // AI is NOT inside this block — retries cannot cause duplicate AI calls.
  try {
    await runInTransaction(async (session) => {
      const trade = await Trade.findById(tradeId).session(session);
      if (!trade) return;

      // Idempotency guard: terminal reflection states — skip entirely
      if (trade.reflectionStatus === "DONE" || trade.reflectionStatus === "FAILED") return;

      if (!(await User.exists({ _id: userId }).session(session))) return;

      const entryTrade = await Trade.findById(trade.entryTradeId).session(session);
    
      // PHASE 4 FIX: Explicitly resolve entry price with fallback chain.
      const safeEntryPrice =
        entryTrade?.entryPlan?.entryPricePaise ??
        entryTrade?.entryPlan?.pricePaise ??
        entryTrade?.pricePaise ??
        0;

      const reflection = analyzeReflection({
        ...entryTrade?.entryPlan,
        entryPricePaise: safeEntryPrice,
        exitPricePaise: trade.pricePaise,
        pnlPaise: trade.pnlPaise,
      });
      const reflectionScore = Math.max(0, 100 - (reflection.deviationScore || 0));
      trade.learningOutcome = {
        verdict: reflection.verdict,
        insight: reflection.insight,
        improvementSuggestion: reflection.improvement,
      };
      const timeline =
        trade.intelligenceTimeline && typeof trade.intelligenceTimeline === "object"
          ? { ...trade.intelligenceTimeline }
          : {};
      const rawPreTrade = timeline.preTrade;
      const safePre =
        rawPreTrade && typeof rawPreTrade === "object" && !Array.isArray(rawPreTrade)
          ? { ...rawPreTrade }
          : { riskLevel: null, flags: [], reasoning: [] };
      trade.intelligenceTimeline = {
        ...timeline,
        preTrade: safePre,
        postTrade: {
          ...(timeline.postTrade || {}),
          outcome: reflection.executionPattern,
          behavioralFlags: Array.isArray(reflection.tags) ? reflection.tags : [],
          alignment: reflection.verdict || timeline.postTrade?.alignment,
          insightSummary: reflection.insight || timeline.postTrade?.insightSummary,
          observations:
            Array.isArray(timeline.postTrade?.observations) && timeline.postTrade.observations.length > 0
              ? timeline.postTrade.observations
              : [reflection.insight].filter(Boolean),
        },
      };
      trade.markModified("intelligenceTimeline");
      trade.trace.timeline.push({
        stage: "REFLECTION_COMPLETED",
        metadata: { verdict: reflection.verdict },
      });

      const lesson = generateLesson(trade, reflection);
      trade.lesson = lesson;

      trade.behaviorTranslation = translateTags(reflection.tags || []);

      trade.status = "COMPLETE";
      trade.reflectionStatus = "DONE";

      await trade.save({ session });
    });

    try {
      const traceId = getTraceId();
      await Outbox.create([
        {
          type: "USER_ANALYTICS_SNAPSHOT",
          payload: {
            userId: String(userId),
            tradeId: String(tradeId),
            ...(traceId ? { traceId } : {}),
          },
          status: "PENDING",
          nextAttemptAt: new Date(),
          retryCount: 0,
        },
      ]);
    } catch (enqueueErr) {
      logger.error({
        action: "ANALYTICS_OUTBOX_ENQUEUE_FAILED",
        userId: String(userId),
        message: enqueueErr?.message || String(enqueueErr),
      });
      try {
        await persistUserAnalyticsSnapshot(userId);
      } catch (persistErr) {
        logger.error({
          action: "ANALYTICS_OUTBOX_FALLBACK_FAILED",
          userId: String(userId),
          message: persistErr?.message || String(persistErr),
        });
      }
    }
  } catch (e) {
    logger.error("Reflection worker failed", e);
    try {
      const t = await Trade.findByIdAndUpdate(
        tradeId,
        { $inc: { reflectionJobAttempts: 1 } },
        { new: true }
      ).select("reflectionJobAttempts");
      const n = t?.reflectionJobAttempts ?? REFLECTION_MAX_ATTEMPTS;
      if (n >= REFLECTION_MAX_ATTEMPTS) {
        await Trade.findByIdAndUpdate(tradeId, {
          $set: { reflectionStatus: "FAILED" },
        });
        logger.error({
          action: "REFLECTION_PERMANENTLY_FAILED",
          tradeId,
          attempts: n,
          message: e?.message || String(e),
        });
        return;
      }
    } catch (markErr) {
      logger.error({ action: "REFLECTION_FAILURE_MARK_ERROR", tradeId, message: markErr?.message });
    }
    throw e;
  }

  logger.info(`[Observability] [ReflectionWorker] deterministic reflection time: ${Date.now() - _start}ms`);

  try {
    await User.findByIdAndUpdate(userId, {
      $inc: { systemStateVersion: 1 },
      $set: { lastTradeActivityAt: new Date() },
    });
  } catch (verErr) {
    logger.warn({ action: "REFLECTION_VERSION_BUMP_SKIPPED", userId, message: verErr?.message });
  }

  // ─── PHASE 2: AI POST-PROCESSING (Non-Blocking, NOT part of retry loop) ──────
  // This block is intentionally outside runInTransaction.
  // If THIS block fails, the error is caught here — it does NOT re-throw,
  // so BullMQ does NOT retry. AI failure is always non-fatal.

  // PHASE 2A: Generate and store AI reflection summary for the closed trade
  try {
    const finishedTrade = await Trade.findById(tradeId);
    if (finishedTrade && finishedTrade.reflectionStatus === "DONE") {
      // BUG-11 FIX: Use the ACTUAL entry trade price (different from exit price)
      const entryTrade = await Trade.findById(finishedTrade.entryTradeId);
      const entryPricePaise = entryTrade?.pricePaise || finishedTrade.pricePaise;
      const exitPricePaise = finishedTrade.pricePaise;

      const aiSummary = await generateReflectionSummary({
        entryPrice: entryPricePaise,
        exitPrice: exitPricePaise,
        pnlPct: finishedTrade.pnlPct || 0,
        behaviorTag: finishedTrade.learningOutcome?.verdict || "UNKNOWN",
        deviation: finishedTrade.learningOutcome?.improvementSuggestion || "None",
        preTradeEmotionEntry: entryTrade?.preTradeEmotion || null,
        preTradeEmotionExit: finishedTrade.preTradeEmotion || null,
      });

      if (aiSummary && aiSummary.meta) {
        delete aiSummary.meta.generatedAt;
      }

      const { buildLearningSurface } = require("../engines/learning.engine");
      const learningSurface = buildLearningSurface({
        closedTrade: finishedTrade,
        reflection: {
          mistakeTag: finishedTrade.intelligenceTimeline?.postTrade?.outcome,
          deviationScore: 0,
        },
        behavior: null,
        mistakeAnalysis: { primaryMistake: finishedTrade.intelligenceTimeline?.postTrade?.outcome },
        aiSummary
      });

      finishedTrade.learningSurface = learningSurface;
      finishedTrade.ai = aiSummary;
      finishedTrade.aiSummary = aiSummary;
      await finishedTrade.save();
      logger.info({ action: "AI_REFLECTION_SAVED", tradeId });
    }
  } catch (aiErr) {
    // BUG-10 FIX: AI errors DO NOT propagate — BullMQ must NOT retry for AI failures
    logger.error({ action: "AI_REFLECTION_FAILED", tradeId, error: aiErr.message });
  }

};

eventBus.on("TRADE_CLOSED", processTradeClosedEvent);
module.exports = { processTradeClosedEvent };
