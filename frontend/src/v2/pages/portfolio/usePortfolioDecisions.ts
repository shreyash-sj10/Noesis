import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { DecisionCardProps } from "../../components/decision/DecisionCard";
import { buildDecision } from "../../domain/decision/buildDecision";
import type { DecisionListStatus } from "../../types/decisionUi";
import { queryKeys } from "../../queryKeys";
import { fetchPortfolioData, type PortfolioPosition } from "../../data/portfolioData";
import { openDecisionPanel } from "../../trade-flow";
import { useAuth } from "../../../features/auth/useAuth.jsx";

function mapRowsToItems(rows: PortfolioPosition[]): DecisionCardProps[] {
  return rows.map((p) => {
    const decision = buildDecision(p);
    return {
      title:           p.symbol,
      decision,
      meta:            {
        pnlPct: p.pnlPct,
        quantity: p.quantity,
        avgPricePaise: p.avgPricePaise,
        currentPricePaise: p.currentPricePaise,
        unrealizedPnLPaise: p.unrealizedPnLPaise,
        changePct: p.dayChangePct ?? undefined,
        dayChangePct: p.dayChangePct,
        isFallback: p.isFallback,
      },
      onPrimaryAction: () =>
        openDecisionPanel(p.symbol, {
          decision,
          meta: { pnlPct: p.pnlPct, quantity: p.quantity, side: "SELL" },
          warnings: [],
        }),
    };
  });
}

async function loadPortfolio(): Promise<DecisionListStatus> {
  const { rows, degraded, fetchFailed } = await fetchPortfolioData();
  return {
    items: mapRowsToItems(rows),
    source: degraded || fetchFailed ? "fallback" : "api",
    isLoading: false,
    isError: fetchFailed,
    isDegraded: degraded,
  };
}

export function usePortfolioDecisions(): DecisionListStatus {
  const { user, isLoading: authLoading } = useAuth();

  const q = useQuery({
    queryKey: queryKeys.portfolio,
    queryFn: loadPortfolio,
    enabled: !authLoading && Boolean(user),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });

  if (q.isPending && !q.data) {
    return {
      items: [],
      source: "api",
      isLoading: true,
      isError: false,
      isDegraded: false,
    };
  }

  const data = q.data;
  if (data) {
    return {
      ...data,
      isLoading: q.isFetching && data.items.length === 0,
    };
  }

  return {
    items: [],
    source: "fallback",
    isLoading: false,
    isError: true,
    isDegraded: false,
  };
}

export type { PortfolioPosition } from "../../data/portfolioData";
