import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle } from "lucide-react";
import AppLayout from "../../layout/AppLayout/AppLayout.jsx";
import { usePortfolioDecisions } from "./usePortfolioDecisions";
import {
  EMPTY_PORTFOLIO_SUMMARY,
  type PortfolioSummary,
  usePortfolioSummary,
} from "../../hooks/usePortfolioSummary";
import { useClosedPositions } from "../../hooks/useClosedPositions";
import { TRADE_SUCCESS_SESSION_KEY } from "../../trade-flow";
import { formatINR, formatSignedINR, fromPaise } from "../../../utils/currency.utils";
import type { DecisionCardProps } from "../../components/decision/DecisionCard";
import DecisionPanel from "../../features/trade/DecisionPanel";
import type { TradePanelContext } from "../../trade-flow";
import PortfolioDecisionStrip, { PortfolioClosedStrip, PortfolioPendingStrip } from "./PortfolioDecisionStrip";
import { ROUTES } from "../../routing/routes";
import { buildCapitalPlan } from "../../lib/capitalPlan";
import PortfolioCapitalGrid from "../../components/portfolio/PortfolioCapitalGrid";

type PortfolioTab = "DEPLOYED" | "QUEUED" | "COMPLETED";

function exposurePct(netEquityPaise: number, investedPaise: number): number | null {
  if (!Number.isFinite(netEquityPaise) || netEquityPaise <= 0) return null;
  if (!Number.isFinite(investedPaise) || investedPaise <= 0) return 0;
  return Math.min(100, (investedPaise / netEquityPaise) * 100);
}

function activeRiskPct(items: DecisionCardProps[]): number | null {
  if (items.length === 0) return null;
  const weight = (a: string) => (a === "BLOCK" ? 92 : a === "GUIDE" ? 48 : 12);
  const sum = items.reduce((s, i) => s + weight(i.decision.action), 0);
  return Math.round((sum / items.length) * 10) / 10;
}

type SystemInsightBlock = {
  id: string;
  title: string;
  state: string;
  interpretation: string;
  action: string;
  tone: "neutral" | "good" | "warn" | "bad";
};

function exposureBand(exposure: number | null): { label: string; tone: SystemInsightBlock["tone"] } {
  if (exposure == null) return { label: "No Exposure", tone: "neutral" };
  if (exposure >= 75) return { label: "High Exposure", tone: "warn" };
  if (exposure >= 40) return { label: "Medium Exposure", tone: "neutral" };
  return { label: "Low Exposure", tone: "good" };
}

function riskStateLabel(breachCount: number, atRiskCount: number, deployedCount: number): string {
  if (breachCount > 0) return "Attention required";
  if (atRiskCount > 0) return "Elevated review";
  if (deployedCount > 0) return "Controlled";
  return "Ready to deploy";
}

function buildPortfolioIntel(
  items: DecisionCardProps[],
  summary: PortfolioSummary,
  exposure: number | null,
): SystemInsightBlock[] {
  const blocks: SystemInsightBlock[] = [];
  const exp = exposureBand(exposure);

  blocks.push({
    id: "capital-deployment",
    title: "Capital deployment",
    state: exp.label,
    interpretation:
      exp.label === "High Exposure"
        ? "Most deployable capital is already committed across open lines."
        : exp.label === "Medium Exposure"
          ? "Capital is partially deployed with room for selective adds."
          : exp.label === "Low Exposure"
            ? "Capital utilization is light and risk capacity remains available."
            : "No deployed capital yet in the live book.",
    action:
      exp.label === "High Exposure"
        ? "Prioritize de-risking or tighten risk bands before adding new size."
        : exp.label === "Medium Exposure"
          ? "Add only if setups are high-confidence and non-correlated."
          : "Use scanner-qualified setups to deploy with controlled sizing.",
    tone: exp.tone,
  });

  if (items.length === 0) {
    blocks.push({
      id: "position-quality",
      title: "Position quality",
      state: "Ready to Deploy",
      interpretation: "No active positions. System checks are clear for fresh deployment.",
      action: "Go to Market Scanner and open only controlled, thesis-backed setups.",
      tone: "good",
    });
    blocks.push({
      id: "system-posture",
      title: "System posture",
      state: "Controlled",
      interpretation: "No open-line stress signals because no capital is currently at risk.",
      action: "Maintain discipline by enforcing thesis, behavior state, and risk brackets on entry.",
      tone: "neutral",
    });
    return blocks;
  }

  const notionals = items.map((i) => {
    const avg = Number(i.meta?.avgPricePaise ?? 0);
    const q = Number(i.meta?.quantity ?? 0);
    return { sym: i.title, n: Math.max(0, avg) * Math.max(0, q) };
  });
  const totalN = notionals.reduce((s, x) => s + x.n, 0);
  const top = [...notionals].sort((a, b) => b.n - a.n)[0];
  const topPct = totalN > 0 && top ? (top.n / totalN) * 100 : 0;

  let concentrationState: string;
  let concentrationInterpretation: string;
  let concentrationAction: string;
  let concentrationTone: SystemInsightBlock["tone"];
  if (totalN <= 0) {
    concentrationState = "Sizing Sync Pending";
    concentrationInterpretation = "Sizing data is still syncing; concentration profile is not yet stable.";
    concentrationAction = "Wait for fills to sync before changing risk based on concentration.";
    concentrationTone = "neutral";
  } else if (topPct > 48) {
    concentrationState = "Concentrated";
    concentrationInterpretation = `${top.sym} is ~${topPct.toFixed(0)}% of deployed notional, creating single-name concentration risk.`;
    concentrationAction = "Trim size or add diversification before deploying new correlated positions.";
    concentrationTone = "warn";
  } else if (topPct > 28) {
    concentrationState = "Moderate concentration";
    concentrationInterpretation = `${top.sym} is the largest sleeve at ~${topPct.toFixed(0)}% of the deployed book.`;
    concentrationAction = "Check sector/correlation overlap before adding more beta exposure.";
    concentrationTone = "neutral";
  } else {
    concentrationState = "Balanced";
    concentrationInterpretation = `Exposure is spread; top line is ~${topPct.toFixed(0)}% across ${items.length} deployed positions.`;
    concentrationAction = "Keep adds selective and preserve spread quality.";
    concentrationTone = "good";
  }

  const sortedByPnl = [...items].sort((a, b) => (a.meta?.pnlPct ?? 0) - (b.meta?.pnlPct ?? 0));
  const weakest = sortedByPnl[0];
  const wp = weakest?.meta?.pnlPct ?? 0;
  let weakState: string;
  let weakInterpretation: string;
  let weakAction: string;
  let weakTone: SystemInsightBlock["tone"];
  if (wp < -2.5) {
    weakState = "Execution pressure";
    weakInterpretation = `${weakest.title} is the weakest line at ${wp.toFixed(2)}% vs entry, signaling active drag.`;
    weakAction = "Review this line first in the terminal and reduce risk if setup quality degraded.";
    weakTone = "bad";
  } else if (wp < 0.5) {
    weakState = "Watchlist";
    weakInterpretation = `${weakest.title} is lagging at ${wp.toFixed(2)}% but remains inside tolerable band.`;
    weakAction = "Maintain current sizing and monitor for volatility expansion.";
    weakTone = "warn";
  } else {
    weakState = "Healthy";
    weakInterpretation = `No meaningful drag; weakest line (${weakest.title}) is ${wp.toFixed(2)}% vs entry.`;
    weakAction = "Continue controlled execution and avoid over-trading strong positions.";
    weakTone = "good";
  }

  const blockedCount = items.filter((i) => i.decision.action === "BLOCK").length;
  const guides = items.filter((i) => i.decision.action === "GUIDE").length;
  const unreal = summary.unrealizedPnLPaise ?? 0;
  const bias = unreal > 0 ? "mark-to-market is net positive" : unreal < 0 ? "mark-to-market is net negative" : "unrealized P&L is flat";

  let postureState: string;
  let postureInterpretation: string;
  let postureAction: string;
  let postureTone: SystemInsightBlock["tone"];
  if (blockedCount > 0) {
    postureState = "Attention required";
    postureInterpretation = `${blockedCount} deployed position(s) are in breach while ${bias}.`;
    postureAction = "Prioritize de-risking breached lines before new deployment.";
    postureTone = "bad";
  } else if (guides > 0) {
    postureState = "Controlled (Elevated)";
    postureInterpretation = `${guides} line(s) require guided review while ${bias}.`;
    postureAction = "Hold sizing discipline and review guided lines before adding capital.";
    postureTone = "warn";
  } else {
    postureState = "Controlled";
    postureInterpretation = `Decisions read ACT across deployed lines and ${bias}.`;
    postureAction = "System is aligned; deploy incrementally only on high-edge setups.";
    postureTone = "good";
  }

  blocks.push({
    id: "concentration",
    title: "Concentration",
    state: concentrationState,
    interpretation: concentrationInterpretation,
    action: concentrationAction,
    tone: concentrationTone,
  });
  blocks.push({
    id: "weakest-line",
    title: "Weakest line",
    state: weakState,
    interpretation: weakInterpretation,
    action: weakAction,
    tone: weakTone,
  });
  blocks.push({
    id: "system-posture",
    title: "System posture",
    state: postureState,
    interpretation: postureInterpretation,
    action: postureAction,
    tone: postureTone,
  });

  return blocks;
}

export default function PortfolioPage() {
  const portfolio = usePortfolioDecisions();
  const { summary: summaryRaw, isError: summaryError, isLoading: summaryLoading } = usePortfolioSummary();
  const summary: PortfolioSummary = summaryRaw ?? EMPTY_PORTFOLIO_SUMMARY;
  const closed = useClosedPositions();
  const navigate = useNavigate();
  const [tab, setTab] = useState<PortfolioTab>("DEPLOYED");
  const [tradeBanner, setTradeBanner] = useState(false);
  const [panel, setPanel] = useState<{ symbol: string; ctx: TradePanelContext } | null>(null);

  useEffect(() => {
    if (sessionStorage.getItem(TRADE_SUCCESS_SESSION_KEY) === "1") {
      setTradeBanner(true);
      sessionStorage.removeItem(TRADE_SUCCESS_SESSION_KEY);
    }
  }, []);

  const netEquity = summary.netEquityPaise ?? summary.balancePaise ?? 0;
  const unrealizedPnL = summary.unrealizedPnLPaise ?? 0;
  const pnlPct = summary.totalPnlPct ?? 0;
  const invested = summary.totalInvestedPaise ?? 0;

  const exp = exposurePct(netEquity, invested);
  const riskPct = activeRiskPct(portfolio.items);
  const intel = useMemo(() => buildPortfolioIntel(portfolio.items, summary, exp), [portfolio.items, summary, exp]);
  const capital = useMemo(() => buildCapitalPlan(summary), [summary]);
  const breachCount = useMemo(
    () => portfolio.items.filter((i) => i.decision?.action === "BLOCK").length,
    [portfolio.items],
  );
  const atRiskCount = useMemo(
    () => portfolio.items.filter((i) => i.decision?.action === "GUIDE").length,
    [portfolio.items],
  );

  function openTradeReview(item: DecisionCardProps) {
    setPanel({
      symbol: item.title,
      ctx: {
        decision: item.decision,
        meta: {
          pnlPct: item.meta?.pnlPct,
          quantity: item.meta?.quantity,
          avgPricePaise: item.meta?.avgPricePaise,
          currentPricePaise: item.meta?.currentPricePaise,
          unrealizedPnLPaise: item.meta?.unrealizedPnLPaise,
          changePct: item.meta?.changePct ?? item.meta?.dayChangePct ?? undefined,
        },
        warnings: [],
      },
    });
  }

  const exposureDisplay =
    exp == null ? "—" : exp === 0 && invested <= 0 ? "0%" : `${exp.toFixed(1)}%`;
  const activeRiskDisplay = riskPct == null ? "—" : `${riskPct.toFixed(1)}%`;
  const exposureState = exposureBand(exp);
  const riskState = riskStateLabel(breachCount, atRiskCount, portfolio.items.length);
  const pnlDisplay = netEquity > 0 ? formatSignedINR(unrealizedPnL) : "—";
  const pnlPctDisplay = netEquity > 0 ? `${pnlPct > 0 ? "+" : ""}${pnlPct.toFixed(2)}%` : "—";
  const statusInterpretation =
    exposureState.label === "High Exposure"
      ? "Exposure high — capital nearly fully deployed."
      : exposureState.label === "Medium Exposure"
        ? "Exposure medium — deployment is controlled with selective room to add."
        : exposureState.label === "Low Exposure"
          ? "Exposure low — system ready to deploy capital."
          : "No active deployment — system ready to deploy capital.";
  const riskToneClass =
    riskState === "Attention required"
      ? "text-amber-200"
      : riskState === "Elevated review"
        ? "text-amber-100"
        : riskState === "Controlled"
          ? "text-emerald-200"
          : "text-slate-200";

  return (
    <AppLayout>
      <div className="home-terminal portfolio-page">
        <div className="portfolio-header portfolio-header--aligned">
          {tradeBanner && (
            <div
              className="degraded-banner"
              style={{
                background: "var(--v2-state-success-bg)",
                borderColor: "var(--v2-state-success)",
                color: "var(--v2-state-success)",
              }}
            >
              <CheckCircle size={12} /> Trade executed and recorded successfully.
            </div>
          )}
          {summaryError && (
            <div className="degraded-banner">
              <AlertTriangle size={12} /> Portfolio summary unavailable — retrying
            </div>
          )}

          <section
            className="rounded-xl border border-slate-800/90 bg-slate-900/60 px-4 py-4 md:px-5"
            aria-label="Portfolio status"
          >
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Portfolio status</p>
                <p className="mt-1 text-sm leading-snug text-slate-300">{statusInterpretation}</p>
              </div>
              <span
                className={`rounded-md border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${
                  riskState === "Attention required"
                    ? "border-amber-500/35 bg-amber-500/8 text-amber-100"
                    : riskState === "Elevated review"
                      ? "border-amber-500/30 bg-amber-500/8 text-amber-50"
                      : riskState === "Controlled"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                        : "border-cyan-500/40 bg-cyan-500/10 text-cyan-100"
                }`}
              >
                {riskState}
              </span>
            </div>
            <PortfolioCapitalGrid
              capital={capital}
              equityDisplay={netEquity > 0 ? formatINR(netEquity) : "—"}
              pnlPctDisplay={pnlPctDisplay}
              exposureDisplay={exposureDisplay}
              exposureLabel={exposureState.label}
              riskState={riskState}
              riskToneClass={riskToneClass}
              activeRiskDisplay={activeRiskDisplay}
              positionCount={portfolio.items.length}
              queuedCount={summary.pendingOrders.length}
            />
          </section>

          <div className="portfolio-tabs" role="tablist" aria-label="Portfolio sections">
            {(
              [
                ["DEPLOYED", portfolio.items.length] as const,
                ["QUEUED", summary.pendingOrders.length] as const,
                ["COMPLETED", closed.trades.length] as const,
              ] as const
            ).map(([t, count]) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className={`portfolio-tab ${tab === t ? "portfolio-tab--active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t} ({count})
              </button>
            ))}
          </div>
        </div>

        <div className="home-terminal__grid portfolio-body">
          <div className="home-terminal__main portfolio-main-stack">
            {tab === "DEPLOYED" ? (
              portfolio.isLoading ? (
                <p className="page-loading page-note" style={{ padding: "var(--space-6)" }}>
                  Loading positions…
                </p>
              ) : portfolio.isError ? (
                <div className="degraded-banner" style={{ margin: 0 }}>
                  <AlertTriangle size={12} /> Position data unavailable — retrying
                </div>
              ) : portfolio.items.length === 0 ? (
                <div className="portfolio-empty-action">
                  <div className="portfolio-empty-action__card">
                    <h2 className="portfolio-empty-action__title">No active positions</h2>
                    <p className="portfolio-empty-action__body">
                      No active positions — system ready to deploy capital when a qualified setup appears.
                    </p>
                    <button
                      type="button"
                      className="portfolio-empty-action__cta"
                      onClick={() => navigate(ROUTES.markets)}
                    >
                      Go to Market Scanner
                    </button>
                  </div>
                </div>
              ) : (
                <section className="home-panel portfolio-decisions-panel" aria-label="Open positions">
                  <header className="home-panel__head">
                    <h2 className="home-panel__title">Deployed positions</h2>
                    <p className="home-panel__lead">
                      Controlled ledger of deployed capital. Review opens the execution terminal.
                    </p>
                  </header>
                  <div className="portfolio-decision-strips">
                    {portfolio.items.map((item, i) => (
                      <PortfolioDecisionStrip
                        key={`${item.title}-${i}`}
                        item={item}
                        onReview={() => openTradeReview(item)}
                      />
                    ))}
                  </div>
                </section>
              )
            ) : tab === "QUEUED" ? (
              summaryLoading ? (
                <p className="page-loading page-note" style={{ padding: "var(--space-6)" }}>
                  Loading queued orders…
                </p>
              ) : summaryError ? (
                <div className="degraded-banner" style={{ margin: 0 }}>
                  <AlertTriangle size={12} /> Could not load queued orders — retrying
                </div>
              ) : summary.pendingOrders.length === 0 ? (
                <section className="home-panel portfolio-decisions-panel" aria-label="Pending orders">
                  <header className="home-panel__head">
                    <h2 className="home-panel__title">Queued orders</h2>
                    <p className="home-panel__lead">
                      No queued orders — system is clear. Orders placed outside market hours will appear here.
                    </p>
                  </header>
                  <div className="portfolio-empty-action" style={{ minHeight: "min(260px, 38vh)" }}>
                    <div className="portfolio-empty-action__card">
                      <h3 className="portfolio-empty-action__title" style={{ fontSize: "var(--text-2xl)" }}>
                        Queue is empty
                      </h3>
                      <p className="portfolio-empty-action__body">
                        No queued orders — ready to deploy during active market session.
                      </p>
                      <button
                        type="button"
                        className="portfolio-empty-action__cta"
                        onClick={() => navigate(ROUTES.markets)}
                      >
                        Go to Market Scanner
                      </button>
                    </div>
                  </div>
                </section>
              ) : (
                <section className="home-panel portfolio-decisions-panel" aria-label="Pending orders">
                  <header className="home-panel__head">
                    <h2 className="home-panel__title">Queued orders</h2>
                    <p className="home-panel__lead">
                      Submitted while the market was closed or deferred — executes when the session is active.
                    </p>
                  </header>
                  <div className="portfolio-decision-strips">
                    {summary.pendingOrders.map((order) => (
                      <PortfolioPendingStrip
                        key={order.tradeId}
                        order={order}
                        formatPriceInr={(paise) => `₹${fromPaise(paise).toFixed(2)}`}
                        formatNotionalInr={(paise) => formatINR(paise)}
                      />
                    ))}
                  </div>
                </section>
              )
            ) : closed.isLoading ? (
              <p className="page-loading page-note" style={{ padding: "var(--space-6)" }}>
                Loading trade history…
              </p>
            ) : closed.isError ? (
              <div className="degraded-banner" style={{ margin: 0 }}>
                <AlertTriangle size={12} /> Trade history unavailable — retrying
              </div>
            ) : closed.trades.length === 0 ? (
              <section className="home-panel portfolio-decisions-panel" aria-label="Completed history">
                <header className="home-panel__head">
                  <h2 className="home-panel__title">Completed history</h2>
                  <p className="home-panel__lead">
                    No completed trades yet. Execute controlled setups to build your feedback history.
                  </p>
                </header>
                <div className="portfolio-empty-action" style={{ minHeight: "min(260px, 38vh)" }}>
                  <div className="portfolio-empty-action__card">
                    <h3 className="portfolio-empty-action__title" style={{ fontSize: "var(--text-2xl)" }}>
                      History will build here
                    </h3>
                    <p className="portfolio-empty-action__body">
                      No completed trades — system ready to deploy and record disciplined outcomes.
                    </p>
                    <button
                      type="button"
                      className="portfolio-empty-action__cta"
                      onClick={() => navigate(ROUTES.markets)}
                    >
                      Go to Market Scanner
                    </button>
                  </div>
                </div>
              </section>
            ) : (
              <section className="home-panel portfolio-decisions-panel" aria-label="Completed history">
                <header className="home-panel__head">
                  <h2 className="home-panel__title">Completed history</h2>
                  <p className="home-panel__lead">Entry-to-exit outcomes with behavior and system alignment feedback.</p>
                </header>
                <div className="portfolio-decision-strips">
                  {closed.trades.map((trade) => (
                    <PortfolioClosedStrip
                      key={trade.tradeId}
                      trade={trade}
                      formatExitInr={(paise) => `₹${fromPaise(paise).toFixed(2)}`}
                      formatPnlInr={(paise) => formatSignedINR(paise)}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>

          <aside className="home-terminal__aside" aria-label="Portfolio context">
            <section className="home-panel home-panel--compact">
              <header className="home-panel__head">
                <h2 className="home-panel__title">System insight</h2>
                <p className="home-panel__lead">State, interpretation, and suggested action from live capital posture.</p>
              </header>
              <div className="portfolio-intel portfolio-intel--scroll">
                {intel.map((block) => (
                  <article key={block.id} className="portfolio-intel__card">
                    <p className="portfolio-intel__card-title">{block.title}</p>
                    <p className={`portfolio-intel__state portfolio-intel__state--${block.tone}`}>
                      {block.state}
                    </p>
                    <p className="portfolio-intel__interpretation">{block.interpretation}</p>
                    <p className="portfolio-intel__action">Suggested action: {block.action}</p>
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>

      <DecisionPanel
        open={panel !== null}
        symbol={panel?.symbol ?? null}
        context={panel?.ctx ?? null}
        onClose={() => setPanel(null)}
      />
    </AppLayout>
  );
}
