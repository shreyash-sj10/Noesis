/**
 * Home "attention" rail — derived from portfolio positions (single /portfolio query).
 */
import { useMemo } from "react";
import type { DecisionCardProps } from "../components/decision/DecisionCard";
import type { DecisionListStatus } from "../types/decisionUi";
import { usePortfolioDecisions } from "../pages/portfolio/usePortfolioDecisions";

function isUrgent(confidence: number, action: "ACT" | "GUIDE" | "BLOCK"): boolean {
  if (action === "BLOCK" || action === "GUIDE") return true;
  return action === "ACT" && confidence < 72;
}

function attentionFromPortfolioItems(items: DecisionCardProps[]): DecisionCardProps[] {
  const urgent = items.filter(({ decision }) => isUrgent(decision.confidence, decision.action));
  if (urgent.length > 0) return urgent;
  return items.slice(0, 5);
}

export function useAttentionDecisions(): DecisionListStatus {
  const portfolio = usePortfolioDecisions();

  const items = useMemo(
    () => attentionFromPortfolioItems(portfolio.items),
    [portfolio.items],
  );

  return {
    items,
    source: portfolio.source,
    isLoading: portfolio.isLoading,
    isError: portfolio.isError,
    isDegraded: portfolio.isDegraded,
  };
}
