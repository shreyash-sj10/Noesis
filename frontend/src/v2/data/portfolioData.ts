import { getPositions } from "../api/portfolio.api.js";
import { queryClient } from "../../queryClient";
import { mapPortfolioSummaryPayload, fetchPortfolioSummaryForQuery } from "../hooks/usePortfolioSummary";
import { queryKeys } from "../queryKeys";
import type { BuildDecisionInput } from "../domain/decision/buildDecision";
import type { PortfolioSummary } from "../hooks/usePortfolioSummary";

export type PortfolioPosition = BuildDecisionInput & {
  symbol: string;
  pnlPct: number;
  quantity: number;
  /** From API `avgPricePaise` — average entry, for display only */
  avgPricePaise: number;
  currentPricePaise: number;
  unrealizedPnLPaise: number;
  dayChangePct: number | null;
  isFallback: boolean;
};

/**
 * Map a real API position (from GET /portfolio/positions) to a PortfolioPosition.
 * All values come from the API response — no hash-based synthesis.
 */
export function mapApiPosition(pos: Record<string, unknown>): PortfolioPosition {
  const symbol   = String(pos.symbol ?? "");
  const qty      = Number(pos.quantity ?? 0);
  const pnlPct   = Number.isFinite(Number(pos.pnlPct)) ? Number(pos.pnlPct) : 0;
  const avgPricePaise = Math.round(Number(pos.avgPricePaise ?? 0));
  const currentPricePaise = Math.round(Number(pos.currentPricePaise ?? avgPricePaise));
  const unrealizedPnLPaise = Math.round(
    Number(pos.unrealizedPnLPaise ?? pos.unrealizedPnL ?? 0),
  );
  const dayRaw = pos.dayChangePct;
  const dayChangePct =
    dayRaw != null && Number.isFinite(Number(dayRaw)) ? Number(dayRaw) : null;
  const isFallback = Boolean(pos.isFallback);

  // Risk score derived from real PnL: healthy position → high score, loss → lower
  const riskScore =
    pnlPct > 3 ? 80 :
    pnlPct > 0 ? 65 :
    pnlPct > -2 ? 50 :
    pnlPct > -5 ? 35 : 20;

  // Allowed = position hasn't breached a severe loss threshold
  const allowed = pnlPct > -5;

  const warnings: string[] | false =
    isFallback
      ? ["Price estimate — live data unavailable"]
    : pnlPct < -3
      ? ["Position in significant loss"]
    : false;

  return {
    symbol,
    allowed,
    riskScore,
    pnlPct,
    quantity: Number.isFinite(qty) ? qty : 0,
    avgPricePaise,
    currentPricePaise,
    unrealizedPnLPaise,
    dayChangePct,
    isFallback,
    warnings,
  };
}

export async function fetchPortfolioData(): Promise<{
  rows: PortfolioPosition[];
  degraded: boolean;
  fetchFailed: boolean;
}> {
  try {
    const res = await getPositions();
    // normalizeResponse returns res.data (the axios payload), which is { success, state, data: [] }
    const payload = (res as Record<string, unknown>);
    const raw = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
    return {
      rows: (raw as Record<string, unknown>[]).slice(0, 20).map((pos) => mapApiPosition(pos)),
      degraded: false,
      fetchFailed: false,
    };
  } catch {
    return { rows: [], degraded: true, fetchFailed: true };
  }
}

/** Parse GET /portfolio/summary — uses the same mapper as `usePortfolioSummary` (no field-order drift). */
export function parsePortfolioSummaryResponse(res: unknown): PortfolioSummary | null {
  const d = (res as { data?: { data?: unknown } })?.data?.data;
  return mapPortfolioSummaryPayload(d);
}

async function fetchAccountSummary(): Promise<{ summary: PortfolioSummary | null; failed: boolean }> {
  try {
    const summary = await queryClient.ensureQueryData({
      queryKey: queryKeys.portfolioSummary,
      queryFn: fetchPortfolioSummaryForQuery,
      staleTime: 30_000,
    });
    return { summary, failed: false };
  } catch {
    return { summary: null, failed: true };
  }
}

/**
 * Positions + account summary in parallel (single logical load for portfolio decisions).
 */
export async function fetchPortfolioWithAccountSummary(): Promise<{
  rows: PortfolioPosition[];
  positionsDegraded: boolean;
  positionsFailed: boolean;
  accountSummary: PortfolioSummary | null;
  summaryFailed: boolean;
}> {
  const [posSettled, sumSettled] = await Promise.allSettled([
    fetchPortfolioData(),
    fetchAccountSummary(),
  ]);

  const pos =
    posSettled.status === "fulfilled"
      ? posSettled.value
      : { rows: [] as PortfolioPosition[], degraded: true, fetchFailed: true };

  const sum =
    sumSettled.status === "fulfilled"
      ? sumSettled.value
      : { summary: null as PortfolioSummary | null, failed: true };

  return {
    rows: pos.rows,
    positionsDegraded: pos.degraded,
    positionsFailed: pos.fetchFailed,
    accountSummary: sum.summary,
    summaryFailed: sum.failed,
  };
}
