import { keepPreviousData, useQuery } from "@tanstack/react-query";
import api from "../api/api.js";
import { queryKeys } from "../queryKeys";
import {
  readPortfolioSummaryCache,
  writePortfolioSummaryCache,
} from "../lib/portfolioSummaryCache";
import { useAuth } from "../../features/auth/useAuth.jsx";

/** Integer paise fields — backend `adaptPortfolio` uses *Paise* / legacy aliases on some keys. */
function toPaiseInt(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v);
}

export type PendingOrderSummary = {
  tradeId: string;
  symbol: string;
  side: string;
  quantity: number;
  pricePaise: number;
  totalValuePaise: number;
  status: string;
  createdAt?: string;
  /** Self-reported mood when the order was placed. */
  preTradeEmotion?: string | null;
};

export type PortfolioSummary = {
  netEquityPaise: number;
  balancePaise: number;
  unrealizedPnLPaise: number;
  realizedPnLPaise: number;
  totalInvestedPaise: number;
  totalPnlPct: number;
  winRate: number;
  isDegraded: boolean;
  /** Orders placed but not yet executed into holdings (e.g. market closed). */
  pendingOrders: PendingOrderSummary[];
};

/** Safe default when summary is still loading or unavailable (e.g. policy / risk layers). */
export const EMPTY_PORTFOLIO_SUMMARY: PortfolioSummary = {
  netEquityPaise: 0,
  balancePaise: 0,
  unrealizedPnLPaise: 0,
  realizedPnLPaise: 0,
  totalInvestedPaise: 0,
  totalPnlPct: 0,
  winRate: 0,
  isDegraded: true,
  pendingOrders: [],
};

/**
 * Single source of truth for mapping `GET /portfolio/summary` JSON (`res.data.data`)
 * to UI `PortfolioSummary` (integer paise + `formatINR` divides by 100 for ₹).
 */
export function mapPortfolioSummaryPayload(d: unknown): PortfolioSummary | null {
  if (d == null || typeof d !== "object") return null;
  const row = d as Record<string, unknown>;
  const rawPending = Array.isArray(row.pendingOrders)
    ? (row.pendingOrders as PendingOrderSummary[])
    : [];
  return {
    netEquityPaise: toPaiseInt(row.netEquity ?? row.totalValuePaise),
    balancePaise: toPaiseInt(row.balancePaise ?? row.balance),
    unrealizedPnLPaise: toPaiseInt(row.unrealizedPnLPaise ?? row.unrealizedPnL),
    realizedPnLPaise: toPaiseInt(row.realizedPnLPaise ?? row.realizedPnL),
    totalInvestedPaise: toPaiseInt(row.totalInvestedPaise ?? row.totalInvested),
    totalPnlPct: Number(row.totalPnlPct ?? 0),
    winRate: Number(row.winRate ?? 0),
    isDegraded: false,
    pendingOrders: rawPending,
  };
}

/** Shared queryFn — also used by `fetchPortfolioWithAccountSummary` to avoid duplicate HTTP + drift. */
export async function fetchPortfolioSummaryForQuery(): Promise<PortfolioSummary> {
  try {
    const res = await api.get("/portfolio/summary", { timeout: 15_000 });
    const mapped = mapPortfolioSummaryPayload(res?.data?.data);
    if (!mapped) return { ...EMPTY_PORTFOLIO_SUMMARY, isDegraded: true };
    writePortfolioSummaryCache(mapped);
    return mapped;
  } catch {
    const cached = readPortfolioSummaryCache();
    if (cached) return cached;
    return { ...EMPTY_PORTFOLIO_SUMMARY, isDegraded: true };
  }
}

export function usePortfolioSummary() {
  const { user, isLoading: authLoading } = useAuth();

  const q = useQuery({
    queryKey: queryKeys.portfolioSummary,
    queryFn: fetchPortfolioSummaryForQuery,
    enabled: !authLoading && Boolean(user),
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    initialData: () => readPortfolioSummaryCache() ?? undefined,
    initialDataUpdatedAt: () =>
      readPortfolioSummaryCache() ? Date.now() - 60_000 : undefined,
  });

  const summary = q.data ?? readPortfolioSummaryCache() ?? null;
  const hasSummary = summary != null;
  const isInitialLoad = q.isPending && !hasSummary;

  return {
    summary: hasSummary ? summary : null,
    isLoading: isInitialLoad,
    isFetching: q.isFetching,
    isError: q.isError && !hasSummary,
  };
}
