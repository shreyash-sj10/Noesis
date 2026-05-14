const Trade = require("../models/trade.model");
const User = require("../models/user.model");
const logger = require("../utils/logger");
const { ANALYTICS_SNAPSHOT_VALID_MS } = require("../constants/analyticsSnapshot.constants");
const { adaptProfile } = require("../adapters/profile.adapter");
const { normalizeTrade } = require("../domain/trade.contract");
const { mapToClosedTrades } = require("../domain/closedTrade.mapper");
const { sendSuccess } = require("../utils/response.helper");
const { buildProfileSurface } = require("../utils/profileSurface.util");
const { SYSTEM_CONFIG } = require("../config/system.config");

const getMe = (req, res) => {
  sendSuccess(res, req, {
    success: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
    },
  });
};

const getProfile = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).lean();
    if (!user) {
      return sendSuccess(res, req, { success: false, message: "User not found" }, 404);
    }

    const [totalTrades, sellTrades, winTrades, tradesChrono, pendingReflection] = await Promise.all([
      Trade.countDocuments({ user: userId }),
      Trade.countDocuments({ user: userId, type: "SELL" }),
      Trade.countDocuments({ user: userId, type: "SELL", pnlPaise: { $gt: 0 } }),
      /** Ascending FIFO needs full context — last-N-desc would often be orphan SELLs only. */
      Trade.find({ user: userId }).sort({ createdAt: 1 }).limit(400).lean(),
      Trade.exists({
        user: userId,
        reflectionStatus: "PENDING",
      }),
    ]);

    const winRate = sellTrades === 0 ? 0 : Number(((winTrades / sellTrades) * 100).toFixed(2));

    const normalized = tradesChrono.map((t) => normalizeTrade(t));
    let closed = [];
    try {
      closed = mapToClosedTrades(normalized);
    } catch (e) {
      logger.warn({
        action: "PROFILE_CLOSED_MAP_FALLBACK",
        userId: String(userId),
        message: e?.message || String(e),
      });
    }
    const recentLearning = closed.slice(-5);
    const profileSurface = buildProfileSurface(closed, user);

    const profileState = pendingReflection ? "STALE" : "READY";
    const revengeMs = SYSTEM_CONFIG.intelligence.preTrade.revengeWindowMs;
    const enforcedRiskFloor = {
      minRewardToRisk: SYSTEM_CONFIG.risk.minRr,
      revengeCooldownMinutes: Math.max(1, Math.round(revengeMs / 60000)),
      maxClientPriceDriftPct: SYSTEM_CONFIG.trade.maxClientPriceDriftPct,
    };

    sendSuccess(res, req, {
      success: true,
      data: adaptProfile(user, { totalTrades, winRate }, recentLearning, profileSurface),
      meta: {
        analyticsSnapshotLastUpdated: user.analyticsSnapshot?.lastUpdated || null,
        analyticsLastUpdatedAt: user.analyticsLastUpdatedAt || null,
        recentLearningSource: "closed_trades_fifo",
        analyticsSnapshotValidMs: ANALYTICS_SNAPSHOT_VALID_MS,
        systemStateVersion: user.systemStateVersion ?? 0,
        profileState,
        enforcedRiskFloor,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMe,
  getProfile
};
