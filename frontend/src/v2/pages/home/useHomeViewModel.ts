/**
 * Composes mandatory home data hooks only.
 * Account metrics use `usePortfolioSummary` (same source + mapper as Topbar) so cash and net equity never drift.
 */
import { useMemo } from "react";
import { useAttentionDecisions } from "../../hooks/useAttentionDecisions";
import { usePortfolioDecisions } from "../portfolio/usePortfolioDecisions";
import { usePortfolioSummary } from "../../hooks/usePortfolioSummary";
import { useMarketSession } from "../../hooks/useMarketSession";
import { useProfileDecisions } from "../../hooks/useProfileDecisions";
import { useTraceData } from "../../hooks/useTraceData";
import {
  buildSystemState,
  buildSystemStatus,
  buildNextAction,
  buildBehaviorInsight,
  buildEventLogs,
  sortAttentionByUrgency,
  takeAttentionSlice,
  type SystemStateVM,
  type SystemStatusVM,
  type NextActionVM,
  type BehaviorInsightVM,
  type EventLogEntryVM,
} from "./mapHomeViewModel";
import type { DecisionCardProps } from "../../components/decision/DecisionCard";
import { buildCapitalPlan, type CapitalPlanVM } from "../../lib/capitalPlan";

export type HomeViewModel = {
  systemStatus: SystemStatusVM;
  systemState: SystemStateVM;
  nextAction: NextActionVM;
  attentionTop3: DecisionCardProps[];
  /** Full sorted attention (for next-action top item); same source as attentionTop3 */
  sortedAttention: DecisionCardProps[];
  positions: DecisionCardProps[];
  behaviorInsight: BehaviorInsightVM;
  eventLogs: EventLogEntryVM[];
  capitalPlan: CapitalPlanVM | null;
  loading: {
    portfolio: boolean;
    metrics: boolean;
    attention: boolean;
    profile: boolean;
    trace: boolean;
  };
  errors: {
    portfolio: boolean;
    attention: boolean;
    profile: boolean;
    trace: boolean;
    summary: boolean;
  };
};

export function useHomeViewModel(): HomeViewModel {
  const attention = useAttentionDecisions();
  const portfolio = usePortfolioDecisions();
  const summaryQr = usePortfolioSummary();
  const profile   = useProfileDecisions();
  const trace     = useTraceData();
  const marketSession = useMarketSession();

  return useMemo(() => {
    const sortedAttention = sortAttentionByUrgency(attention.items);
    const attentionTop3   = takeAttentionSlice(sortedAttention, 3);
    const positionCount   = portfolio.items.length;

    const summaryLoading = summaryQr.isLoading;
    const summaryFailed = summaryQr.isError;
    const accountSummary = summaryQr.summary;
    const summaryReady = Boolean(accountSummary) || (!summaryLoading && !summaryFailed);
    const metricsBlocking = summaryLoading && !summaryReady;

    const systemState = buildSystemState(
      metricsBlocking ? null : accountSummary,
      metricsBlocking,
      summaryFailed,
      sortedAttention,
      positionCount,
    );
    const hasAnyError =
      portfolio.isError ||
      attention.isError ||
      profile.isError ||
      trace.isError ||
      summaryFailed;
    const sessionSnap =
      marketSession.data != null
        ? {
            isMarketOpen: marketSession.data.isMarketOpen,
            clockState: marketSession.data.clockState,
          }
        : null;
    const systemStatus = buildSystemStatus(
      metricsBlocking,
      metricsBlocking || (portfolio.isLoading && !summaryReady),
      hasAnyError,
      sortedAttention,
      sessionSnap,
    );

    const positionsBlocking =
      portfolio.isLoading && portfolio.items.length === 0 && !summaryReady;

    const nextAction = buildNextAction(
      metricsBlocking,
      positionsBlocking,
      portfolio.items,
      sortedAttention,
      profile.items,
    );

    const behaviorInsight = buildBehaviorInsight(profile.items);
    const eventLogs       = buildEventLogs(trace.lines, 8);
    const capitalPlan = accountSummary ? buildCapitalPlan(accountSummary) : null;

    return {
      systemStatus,
      systemState,
      nextAction,
      attentionTop3,
      sortedAttention,
      positions: portfolio.items,
      behaviorInsight,
      eventLogs,
      capitalPlan,
      loading: {
        portfolio: portfolio.isLoading && portfolio.items.length === 0,
        metrics: metricsBlocking,
        attention: attention.isLoading,
        profile:   profile.isLoading,
        trace:     trace.isLoading,
      },
      errors: {
        portfolio: portfolio.isError,
        attention: attention.isError,
        profile:   profile.isError,
        trace:     trace.isError,
        summary: summaryFailed,
      },
    };
  }, [
    attention.items,
    attention.isLoading,
    attention.isError,
    portfolio.items,
    portfolio.isLoading,
    portfolio.isError,
    summaryQr.summary,
    summaryQr.isLoading,
    summaryQr.isError,
    profile.items,
    profile.isLoading,
    profile.isError,
    trace.lines,
    trace.isLoading,
    trace.isError,
    marketSession.data,
  ]);
}
