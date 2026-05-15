/**
 * Home page view model — all mapping from hooks/API shapes to UI props.
 * No React. No JSX. Safe for tests.
 */
import type { DecisionCardProps } from "../../components/decision/DecisionCard";
import type { PortfolioSummary } from "../../hooks/usePortfolioSummary";
import type { TraceLine } from "../../hooks/useTraceData";
import { formatINR, formatSignedINR, fromPaise } from "../../../utils/currency.utils.js";

export type SystemStateVM = {
  netEquityDisplay: string;
  unrealizedPnlDisplay: string;
  riskStatusHeadline: string;
  riskStatusSub: string;
};

export type SystemStatusVM = {
  marketStatus: "OPEN" | "CLOSED";
  marketReason: string;
  dataStatus: "SYNCED" | "DELAYED";
  dataReason: string;
  executionStatus: "READY" | "ACTION REQUIRED";
  executionReason: string;
};

export type NextActionVariant = "loading" | "new_user" | "learning" | "active" | "review";

export type NextActionVM =
  | {
      variant: "loading";
      headline: string;
      sub: string;
      reasoning: string;
    }
  | {
      variant: "new_user";
      headline: string;
      sub: string;
      reasoning: string;
      ctaLabel: string;
    }
  | {
      variant: "learning";
      headline: string;
      sub: string;
      reasoning: string;
      ctaLabel: string;
    }
  | {
      variant: "active";
      headline: string;
      sub: string;
      reasoning: string;
      ctaLabel: string;
    }
  | {
      variant: "review";
      headline: string;
      sub: string;
      reasoning: string;
      topItem: DecisionCardProps;
      ctaLabel: string;
    }

export type BehaviorInsightVM =
  | {
      kind: "insufficient";
      missing: string;
      nextStep: string;
    }
  | {
      kind: "insight";
      pattern: string;
      impact: string;
      correction: string;
    };

export type EventLogEntryVM = {
  id: string;
  time: string;
  type: string;
  message: string;
};

const ACTION_RANK: Record<string, number> = { BLOCK: 3, GUIDE: 2, ACT: 1 };

/** Urgent first: BLOCK > GUIDE > ACT, then higher confidence. */
export function sortAttentionByUrgency(items: DecisionCardProps[]): DecisionCardProps[] {
  return [...items].sort((a, b) => {
    const ra = ACTION_RANK[a.decision.action] ?? 0;
    const rb = ACTION_RANK[b.decision.action] ?? 0;
    if (rb !== ra) return rb - ra;
    return b.decision.confidence - a.decision.confidence;
  });
}

function formatMoneyPaise(paise: number): string {
  if (!Number.isFinite(paise)) return "Not enough data yet";
  return formatINR(Math.round(paise));
}

function signedPaise(paise: number): string {
  if (!Number.isFinite(paise)) return "Not enough data yet";
  return formatSignedINR(Math.round(paise));
}

export function buildSystemState(
  accountSummary: PortfolioSummary | null,
  portfolioLoading: boolean,
  summaryFetchFailed: boolean,
  sortedAttention: DecisionCardProps[],
  positionCount: number,
): SystemStateVM {
  if (portfolioLoading) {
    return {
      netEquityDisplay: "Preparing your workspace",
      unrealizedPnlDisplay: "Preparing your workspace",
      riskStatusHeadline: "Preparing your workspace",
      riskStatusSub: "Pulling live account and risk context.",
    };
  }

  if (summaryFetchFailed || !accountSummary) {
    return {
      netEquityDisplay: "Not enough data yet",
      unrealizedPnlDisplay: "Not enough data yet",
      riskStatusHeadline: "Unavailable",
      riskStatusSub: "Portfolio summary is not available right now.",
    };
  }

  if (accountSummary.isDegraded) {
    return {
      netEquityDisplay: formatMoneyPaise(accountSummary.netEquityPaise),
      unrealizedPnlDisplay: signedPaise(accountSummary.unrealizedPnLPaise),
      riskStatusHeadline: "Partial data",
      riskStatusSub: "Some live fields may be missing — figures are best-effort.",
    };
  }

  const hasBlock = sortedAttention.some((i) => i.decision.action === "BLOCK");
  const hasGuide = sortedAttention.some((i) => i.decision.action === "GUIDE");

  let riskHead = "Stable";
  let riskSub = "No items in your review queue.";
  if (hasBlock) {
    riskHead = "Action required";
    riskSub = "At least one holding is in a blocked risk band.";
  } else if (hasGuide) {
    riskHead = "Action required";
    riskSub = "Guidance is available on one or more holdings.";
  } else if (positionCount === 0) {
    riskHead = "No exposure";
    riskSub = "Open a position to activate portfolio risk signals.";
  }

  return {
    netEquityDisplay: formatMoneyPaise(accountSummary.netEquityPaise),
    unrealizedPnlDisplay: signedPaise(accountSummary.unrealizedPnLPaise),
    riskStatusHeadline: riskHead,
    riskStatusSub: riskSub,
  };
}

export function buildNextAction(
  portfolioLoading: boolean,
  attentionLoading: boolean,
  positionItems: DecisionCardProps[],
  sortedAttention: DecisionCardProps[],
  profileItems: DecisionCardProps[],
): NextActionVM {
  if (portfolioLoading || attentionLoading) {
    return {
      variant: "loading",
      headline: "Preparing your workspace",
      sub: "Syncing portfolio, behavior, and risk signals.",
      reasoning: "This prevents acting on partial data.",
    };
  }

  if (positionItems.length > 0 && sortedAttention.length > 0) {
    const top = sortedAttention[0];
    return {
      variant: "review",
      headline: "Action required",
      sub: `Review ${top.title} first: ${top.decision.action} at ${top.decision.confidence}% confidence.`,
      reasoning: "This item currently has the highest risk impact in your open book.",
      topItem: top,
      ctaLabel: "Review top risk",
    };
  }

  if (positionItems.length > 0) {
    return {
      variant: "active",
      headline: "Portfolio is active",
      sub: "Your positions are currently within policy limits.",
      reasoning: "Continue monitoring for regime shifts or sudden volatility.",
      ctaLabel: "Inspect positions",
    };
  }

  const activityCount = profileItems.length;
  if (activityCount === 0) {
    return {
      variant: "new_user",
      headline: "No trade history detected",
      sub: "You are at setup stage with no completed or active trades yet.",
      reasoning: "The system needs your first trade cycle to start generating personalized guidance.",
      ctaLabel: "Open market scanner",
    };
  }

  if (activityCount < 3) {
    return {
      variant: "learning",
      headline: "Learning phase in progress",
      sub: `Only ${activityCount} trade signal${activityCount === 1 ? "" : "s"} observed so far.`,
      reasoning: "More trade outcomes are needed before behavior and risk baselines become reliable.",
      ctaLabel: "Place next planned trade",
    };
  }

  return {
    variant: "learning",
    headline: "No active positions",
    sub: "Your account is currently flat.",
    reasoning: "Create a planned position to re-activate live decision guidance.",
    ctaLabel: "Explore setups",
  };
}

export function takeAttentionSlice(sorted: DecisionCardProps[], max: number): DecisionCardProps[] {
  return sorted.slice(0, max);
}

export function buildBehaviorInsight(profileItems: DecisionCardProps[]): BehaviorInsightVM {
  const first = profileItems[0];
  if (!first) {
    return {
      kind: "insufficient",
      missing: "Not enough data yet. The behavior model needs more completed trade outcomes.",
      nextStep: "Close at least 3 planned trades with journal notes to unlock pattern analysis.",
    };
  }
  const pattern = first.title?.trim() || "";
  const impact = first.decision.reason?.trim() || "";
  const correction =
    (typeof first.meta?.journalInsight === "string" && first.meta.journalInsight.trim()) ||
    impact ||
    "";
  if (!pattern && !impact && !correction) {
    return {
      kind: "insufficient",
      missing: "Not enough data yet. Current behavior signals are too weak.",
      nextStep: "Record the setup thesis and exit reason for your next few trades.",
    };
  }
  return {
    kind: "insight",
    pattern: pattern || "Execution drift under volatility",
    impact: impact || "This behavior can reduce expectancy when risk increases.",
    correction: correction || "Follow your predefined invalidation level before changing position size.",
  };
}

function isMarketOpenClientFallback(): boolean {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const totalMinutes = hour * 60 + minute;
  const isWeekday = !["Sat", "Sun"].includes(weekday);
  const openMinutes = 9 * 60 + 15;
  const closeMinutes = 15 * 60 + 30;
  return isWeekday && totalMinutes >= openMinutes && totalMinutes < closeMinutes;
}

export type MarketSessionSnapshot = {
  isMarketOpen: boolean;
  clockState?: string;
} | null;

export function buildSystemStatus(
  portfolioLoading: boolean,
  attentionLoading: boolean,
  hasAnyError: boolean,
  sortedAttention: DecisionCardProps[],
  session: MarketSessionSnapshot,
): SystemStatusVM {
  const isMarketOpen =
    session != null ? session.isMarketOpen : isMarketOpenClientFallback();

  const hasUrgent = sortedAttention.some(
    (item) => item.decision.action === "BLOCK" || item.decision.action === "GUIDE",
  );
  const isDataDelayed = portfolioLoading || attentionLoading || hasAnyError;

  const marketReason = isMarketOpen
    ? "NSE cash session is open (IST)."
    : session?.clockState
      ? marketClosedReasonFromClock(session.clockState)
      : "Outside NSE cash trading session (IST).";

  const executionStatus = hasUrgent ? "ACTION REQUIRED" : "READY";
  const executionReason = hasUrgent
    ? isMarketOpen
      ? "At least one position needs review before next execution."
      : "Review open risk; new orders queue until the session opens."
    : isMarketOpen
      ? "No blocking risk signal is active."
      : "Session closed — execution and automation are idle until open.";

  return {
    marketStatus: isMarketOpen ? "OPEN" : "CLOSED",
    marketReason,
    dataStatus: isDataDelayed ? "DELAYED" : "SYNCED",
    dataReason: isDataDelayed
      ? "Feeds are syncing or partially unavailable."
      : "Portfolio and risk feeds are synced (quotes may still be delayed after hours).",
    executionStatus,
    executionReason,
  };
}

function marketClosedReasonFromClock(clockState: string): string {
  switch (clockState) {
    case "WEEKEND":
      return "Weekend — no NSE cash session (IST).";
    case "HOLIDAY":
      return "Exchange holiday (IST calendar).";
    case "PRE_OPEN":
      return "Pre-open — cash session not started (IST).";
    case "POST_CLOSE":
      return "After close — NSE cash session ended for the day (IST).";
    default:
      return "Outside NSE cash trading session (IST).";
  }
}

function parseTraceLineForDisplay(line: TraceLine): EventLogEntryVM {
  const raw = line.text || "";
  const timeMatch = raw.match(/^\[([^\]]+)\]/);
  const time = timeMatch ? timeMatch[1].split(" ").slice(-1)[0] || timeMatch[1] : "—";
  const rest = raw.replace(/^\[[^\]]+\]\s*/, "").trim();
  const typeMatch = rest.match(/^(INFO|WARN|EXEC|ERR|DECISION|BLOCK|ACT|GUIDE|CHECK)\b/i);
  const rawT = typeMatch ? typeMatch[1].toUpperCase() : "LOG";
  const type = rawT.length <= 8 ? rawT : rawT.slice(0, 8);
  const body = typeMatch ? rest.slice(typeMatch[0].length).trim() : rest;
  const message = body.length > 120 ? `${body.slice(0, 117)}…` : body;
  return { id: line.id, time, type, message: message || raw };
}

export function buildEventLogs(lines: TraceLine[], max: number): EventLogEntryVM[] {
  return lines.slice(0, max).map(parseTraceLineForDisplay);
}

export function formatEntryInr(avgPricePaise: number | undefined): string {
  if (avgPricePaise == null || !Number.isFinite(avgPricePaise) || avgPricePaise <= 0) return "—";
  return `₹${fromPaise(avgPricePaise).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function attentionCtaLabel(action: string): string {
  if (action === "BLOCK") return "Review risk";
  if (action === "GUIDE") return "Review";
  return "View";
}

export function positionStatusFromDecision(action: string): string {
  if (action === "BLOCK") return "At risk";
  if (action === "GUIDE") return "Guided";
  return "OK";
}
