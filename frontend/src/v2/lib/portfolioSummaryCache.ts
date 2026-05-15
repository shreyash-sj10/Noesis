import type { PortfolioSummary } from "../hooks/usePortfolioSummary";

const KEY = "noesis.portfolio.summary.v1";

export function readPortfolioSummaryCache(): PortfolioSummary | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as PortfolioSummary;
    if (parsed == null || typeof parsed !== "object") return undefined;
    return { ...parsed, isDegraded: true };
  } catch {
    return undefined;
  }
}

export function writePortfolioSummaryCache(summary: PortfolioSummary): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(summary));
  } catch {
    /* quota / private mode */
  }
}
