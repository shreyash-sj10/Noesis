import { useState, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppLayout from "../../layout/AppLayout/AppLayout.jsx";
import { useHomeViewModel } from "./useHomeViewModel";
import { openDecisionPanel } from "../../trade-flow";
import { ROUTES } from "../../routing/routes";
import HomeKpiStrip from "./components/HomeKpiStrip";
import NextActionPanel from "./components/NextActionPanel";
import PositionRow from "./components/PositionRow";
import BehaviorInsight from "./components/BehaviorInsight";
import SystemStatusBar from "./components/SystemStatusBar";
import { positionStatusFromDecision, formatEntryInr } from "./mapHomeViewModel";
import type { DecisionCardProps } from "../../components/decision/DecisionCard";
import { pnlToneClass } from "../../lib/capitalPlan";

function openPanelFromItem(item: DecisionCardProps): void {
  openDecisionPanel(item.title, {
    decision: item.decision,
    meta: item.meta,
    warnings: [],
  });
}

export default function HomePage() {
  const vm = useHomeViewModel();
  const navigate = useNavigate();
  const [behaviorAck, setBehaviorAck] = useState(false);
  const rankedPositions = useMemo(() => {
    const rank: Record<string, number> = { BLOCK: 3, GUIDE: 2, ACT: 1 };
    return [...vm.positions].sort((a, b) => (rank[b.decision.action] ?? 0) - (rank[a.decision.action] ?? 0));
  }, [vm.positions]);

  const onReviewNext = useCallback(() => {
    if (vm.nextAction.variant === "review") {
      openPanelFromItem(vm.nextAction.topItem);
    }
  }, [vm.nextAction]);

  const onHeroPrimaryAction = useCallback(() => {
    navigate(ROUTES.portfolio);
  }, [navigate]);

  const pnlInterpretation = vm.loading.metrics
    ? "Preparing your workspace"
    : vm.systemState.unrealizedPnlDisplay.startsWith("-")
      ? "Slight drawdown vs entries"
      : vm.systemState.unrealizedPnlDisplay.startsWith("+")
        ? "Favorable move vs entries"
        : vm.systemState.unrealizedPnlDisplay.includes("Not enough data")
          ? "Not enough data yet to assess live P&L"
          : "Flat vs entries across open positions";

  const capitalKpis = useMemo(() => {
    const cp = vm.capitalPlan;
    return [
      {
        label: "Equity",
        value: vm.systemState.netEquityDisplay,
        sub: cp ? `${cp.investedDisplay} deployed` : undefined,
      },
      {
        label: "Open P&L",
        value: cp?.unrealizedDisplay ?? vm.systemState.unrealizedPnlDisplay,
        sub: pnlInterpretation,
        valueClassName: cp ? pnlToneClass(cp.unrealizedPnLPaise) : undefined,
      },
      {
        label: "Left to invest",
        value: cp?.leftToInvestDisplay ?? "—",
        sub: "Cash available to deploy",
        valueClassName: "home-kpi-strip__value--accent",
      },
      {
        label: "Cash",
        value: cp?.cashDisplay ?? "—",
        sub: "Wallet balance",
      },
      {
        label: "Deployed",
        value: cp?.investedDisplay ?? "—",
        sub: "At entry cost",
      },
      {
        label: "Risk",
        value: vm.systemState.riskStatusHeadline,
        sub: vm.systemState.riskStatusSub,
        valueClassName: "home-kpi-strip__value--status",
      },
    ];
  }, [vm.capitalPlan, vm.systemState, pnlInterpretation]);

  return (
    <AppLayout>
      <div className="home-terminal">
        <SystemStatusBar model={vm.systemStatus} />

        <NextActionPanel model={vm.nextAction} onReview={onReviewNext} onPrimaryAction={onHeroPrimaryAction} />

        <section aria-label="Capital at a glance">
          <HomeKpiStrip items={capitalKpis} isLoading={vm.loading.metrics} />
          {vm.capitalPlan && !vm.loading.metrics ? (
            <p className="home-dashboard__plan-line mt-2">
              <span className="home-dashboard__plan-title">{vm.capitalPlan.planTitle}</span>
              {" · "}
              {vm.capitalPlan.planBody}{" "}
              <Link to={ROUTES.portfolio} className="home-dashboard__plan-link">
                Full ₹ breakdown on Portfolio →
              </Link>
            </p>
          ) : null}
        </section>

        <div className="home-terminal__grid">
          <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-6" aria-label="Open positions">
            <header className="space-y-2">
              <h2 className="text-base font-semibold tracking-tight text-slate-100">Active positions</h2>
              <p className="text-sm leading-relaxed text-slate-400">
                Highest risk first. Focus on the position that needs action before scanning for new trades.
              </p>
            </header>
            {vm.loading.portfolio && rankedPositions.length === 0 ? (
              <p className="text-sm text-slate-400">Loading open positions…</p>
            ) : rankedPositions.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <p className="text-sm font-medium text-slate-100">No active positions right now</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  Without an open position, live execution and risk feedback cannot be generated.
                </p>
                <p className="mt-2 text-sm leading-relaxed text-cyan-300">
                  Recommended action: open a planned starter position from the market scanner.
                </p>
                <button
                  type="button"
                  className="mt-4 min-h-10 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
                  onClick={() => navigate(ROUTES.markets)}
                >
                  Open market scanner
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {rankedPositions.map((row) => {
                  const pnl = row.meta?.pnlPct ?? 0;
                  const pnlStr = `${pnl > 0 ? "+" : ""}${pnl.toFixed(2)}%`;
                  const status = positionStatusFromDecision(row.decision.action);
                  const riskNote =
                    status === "At risk"
                      ? "Risk threshold breached. Review and adjust exposure."
                      : status === "Guided"
                        ? "Guidance available. Verify thesis before adding size."
                        : "Within current policy guardrails.";
                  return (
                    <PositionRow
                      key={row.title}
                      symbol={row.title}
                      entryDisplay={formatEntryInr(row.meta?.avgPricePaise)}
                      statusLabel={status}
                      pnlPctDisplay={pnlStr}
                      riskNote={riskNote}
                      actionLabel={status === "At risk" ? "Review risk now" : "Open decision brief"}
                      onReview={() => openPanelFromItem(row)}
                    />
                  );
                })}
              </div>
            )}
          </section>

          <aside className="space-y-4" aria-label="Behavior insight">
            <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-6">
              <header className="space-y-2">
                <h2 className="text-base font-semibold tracking-tight text-slate-100">Behavior insight</h2>
                <p className="text-sm leading-relaxed text-slate-400">
                  This panel explains behavior patterns, impact, and the correction to apply on the next trade.
                </p>
              </header>
              <BehaviorInsight
                model={vm.behaviorInsight}
                acknowledged={behaviorAck}
                onAcknowledge={() => setBehaviorAck(true)}
              />
            </section>
          </aside>
        </div>
      </div>
    </AppLayout>
  );
}
