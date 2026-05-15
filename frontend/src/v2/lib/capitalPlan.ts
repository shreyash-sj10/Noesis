import type { PortfolioSummary } from "../hooks/usePortfolioSummary";
import { formatINR, formatSignedINR } from "../../utils/currency.utils";

export type CapitalPlanVM = {
  cashPaise: number;
  investedPaise: number;
  netEquityPaise: number;
  unrealizedPnLPaise: number;
  realizedPnLPaise: number;
  leftToInvestPaise: number;
  exposurePct: number | null;
  cashDisplay: string;
  investedDisplay: string;
  leftToInvestDisplay: string;
  unrealizedDisplay: string;
  realizedDisplay: string;
  planTitle: string;
  planBody: string;
};

function exposurePct(netEquityPaise: number, investedPaise: number): number | null {
  if (!Number.isFinite(netEquityPaise) || netEquityPaise <= 0) return null;
  if (!Number.isFinite(investedPaise) || investedPaise <= 0) return 0;
  return Math.min(100, (investedPaise / netEquityPaise) * 100);
}

export function buildCapitalPlan(summary: PortfolioSummary): CapitalPlanVM {
  const netEquityPaise = summary.netEquityPaise ?? summary.balancePaise ?? 0;
  const cashPaise = summary.balancePaise ?? 0;
  const investedPaise = summary.totalInvestedPaise ?? 0;
  const unrealizedPnLPaise = summary.unrealizedPnLPaise ?? 0;
  const realizedPnLPaise = summary.realizedPnLPaise ?? 0;
  const leftToInvestPaise = Math.max(0, cashPaise);
  const exp = exposurePct(netEquityPaise, investedPaise);

  let planTitle: string;
  let planBody: string;
  if (netEquityPaise <= 0) {
    planTitle = "Capital plan";
    planBody = "Fund the account to begin a controlled deployment plan.";
  } else if (exp != null && exp >= 75) {
    planTitle = "Plan: de-risk first";
    planBody = `High exposure (~${exp.toFixed(0)}%). Keep ${formatINR(leftToInvestPaise)} cash until risk bands improve.`;
  } else if (exp != null && exp >= 40) {
    planTitle = "Plan: selective adds";
    planBody = `${formatINR(leftToInvestPaise)} available to invest. Add only high-confidence, non-correlated setups.`;
  } else if (investedPaise > 0) {
    planTitle = "Plan: room to deploy";
    planBody = `${formatINR(leftToInvestPaise)} left to invest · ${formatINR(investedPaise)} already deployed at cost.`;
  } else {
    planTitle = "Plan: ready to deploy";
    planBody = `Full ${formatINR(leftToInvestPaise)} cash is available for your first controlled position.`;
  }

  return {
    cashPaise,
    investedPaise,
    netEquityPaise,
    unrealizedPnLPaise,
    realizedPnLPaise,
    leftToInvestPaise,
    exposurePct: exp,
    cashDisplay: netEquityPaise > 0 ? formatINR(cashPaise) : "—",
    investedDisplay: netEquityPaise > 0 ? formatINR(investedPaise) : "—",
    leftToInvestDisplay: netEquityPaise > 0 ? formatINR(leftToInvestPaise) : "—",
    unrealizedDisplay: netEquityPaise > 0 ? formatSignedINR(unrealizedPnLPaise) : "—",
    realizedDisplay: netEquityPaise > 0 ? formatSignedINR(realizedPnLPaise) : "—",
    planTitle,
    planBody,
  };
}

export function pnlToneClass(paise: number): string {
  if (paise > 0) return "text-emerald-300";
  if (paise < 0) return "text-amber-200";
  return "text-slate-200";
}
