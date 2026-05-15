import type { CapitalPlanVM } from "../../lib/capitalPlan";
import { pnlToneClass } from "../../lib/capitalPlan";

type Props = {
  capital: CapitalPlanVM;
  equityDisplay: string;
  pnlPctDisplay: string;
  exposureDisplay: string;
  exposureLabel: string;
  riskState: string;
  riskToneClass: string;
  activeRiskDisplay: string;
  positionCount: number;
  queuedCount: number;
};

function Cell({
  label,
  value,
  sub,
  valueClassName,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-800/80 bg-slate-950/35 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-base font-semibold tabular-nums ${valueClassName ?? "text-slate-100"}`}>
        {value}
      </p>
      {sub ? <p className="text-xs text-slate-400">{sub}</p> : null}
    </div>
  );
}

export default function PortfolioCapitalGrid({
  capital,
  equityDisplay,
  pnlPctDisplay,
  exposureDisplay,
  exposureLabel,
  riskState,
  riskToneClass,
  activeRiskDisplay,
  positionCount,
  queuedCount,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        <Cell label="Equity" value={equityDisplay} />
        <Cell
          label="Open P&L"
          value={capital.unrealizedDisplay}
          sub={pnlPctDisplay}
          valueClassName={pnlToneClass(capital.unrealizedPnLPaise)}
        />
        <Cell
          label="Realized P&L"
          value={capital.realizedDisplay}
          sub="Closed trades"
          valueClassName={pnlToneClass(capital.realizedPnLPaise)}
        />
        <Cell label="Deployed" value={capital.investedDisplay} sub="Cost at entry" />
        <Cell label="Cash" value={capital.cashDisplay} sub="In wallet" />
        <Cell
          label="Left to invest"
          value={capital.leftToInvestDisplay}
          sub="Available to deploy"
          valueClassName="text-cyan-200"
        />
        <Cell label="Exposure" value={exposureDisplay} sub={exposureLabel} />
        <Cell
          label="Risk state"
          value={riskState}
          sub={`Active risk ${activeRiskDisplay}`}
          valueClassName={riskToneClass}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Cell label="Positions" value={String(positionCount)} sub={`${queuedCount} queued`} />
        <div className="col-span-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-400/90">
            {capital.planTitle}
          </p>
          <p className="mt-1 text-sm leading-snug text-slate-300">{capital.planBody}</p>
        </div>
      </div>
    </div>
  );
}
