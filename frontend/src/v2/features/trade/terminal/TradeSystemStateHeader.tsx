import type { Decision } from "../../../domain/decision/buildDecision";
import type { GateVerdict } from "./executionGateUi";
import { marketPostureLabel } from "./tradeTerminalCopy";

export type SystemBarMode = "setup" | "review" | "busy" | "success" | "error";

export type SetupGateState = "locked_market" | "incomplete" | "ready_analyze";

export type TradeSystemStateHeaderProps = {
  symbol: string;
  priceDisplay: string;
  changePct: number | null;
  /** Market / scanner posture (always from opening context). */
  decision: Decision;
  orderSide: "BUY" | "SELL";
  mode: SystemBarMode;
  /** One-line system explanation (block reason, guidance, or status). */
  statusLine: string;
  /** When set (e.g. REVIEW phase), drives the system pill instead of `decision.action`. */
  executionVerdict?: GateVerdict | null;
  /** SETUP phase: local + market posture for the system pill. */
  setupGateState?: SetupGateState;
  /** REVIEW phase: server gate passed but submit prerequisites (e.g. emotion) not yet satisfied. */
  executionHeld?: boolean;
  /** WebSocket quote stream active for this symbol. */
  quoteStreamActive?: boolean;
  /** Quote freshness for the header (badges under the price row). */
  quoteQuality?: "stale" | "cached" | null;
  /** When false, quote stream / quality badges are hidden (e.g. after fill). */
  showQuoteMeta?: boolean;
};

function pct(chg: number | null): string {
  if (chg == null || !Number.isFinite(chg)) return "—";
  return `${chg > 0 ? "+" : ""}${chg.toFixed(2)}%`;
}

function systemPill(
  mode: SystemBarMode,
  decision: Decision,
  executionVerdict: GateVerdict | null | undefined,
  setupGateState: SetupGateState | undefined,
  executionHeld: boolean | undefined,
): { text: string; cls: string } {
  if (mode === "busy") return { text: "Working", cls: "border-slate-600 bg-slate-800 text-slate-200" };
  if (mode === "success") return { text: "Submitted", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" };
  if (mode === "error") return { text: "Attention", cls: "border-amber-500/40 bg-amber-500/10 text-amber-100" };
  if (mode === "review" && executionHeld) {
    return { text: "INCOMPLETE", cls: "border-amber-500/40 bg-amber-500/10 text-amber-100" };
  }
  if (mode === "setup" && setupGateState) {
    if (setupGateState === "locked_market") {
      return { text: "BLOCKED", cls: "border-rose-500/45 bg-rose-500/10 text-rose-100" };
    }
    if (setupGateState === "incomplete") {
      return { text: "INCOMPLETE", cls: "border-amber-500/40 bg-amber-500/10 text-amber-100" };
    }
    return { text: "READY", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100" };
  }
  if (executionVerdict != null) {
    const v = executionVerdict;
    if (v === "BLOCK") return { text: "BLOCKED", cls: "border-rose-500/45 bg-rose-500/10 text-rose-100" };
    if (v === "GUIDE") return { text: "REVIEW", cls: "border-amber-500/40 bg-amber-500/10 text-amber-100" };
    return { text: "READY", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100" };
  }
  const v = decision.action as GateVerdict;
  if (v === "BLOCK") return { text: "BLOCKED", cls: "border-rose-500/45 bg-rose-500/10 text-rose-100" };
  if (v === "GUIDE") return { text: "REVIEW", cls: "border-amber-500/40 bg-amber-500/10 text-amber-100" };
  return { text: "READY", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100" };
}

export default function TradeSystemStateHeader({
  symbol,
  priceDisplay,
  changePct,
  decision,
  orderSide,
  mode,
  statusLine,
  executionVerdict,
  setupGateState,
  executionHeld,
  quoteStreamActive = false,
  quoteQuality = null,
  showQuoteMeta = true,
}: TradeSystemStateHeaderProps) {
  const pill = systemPill(mode, decision, executionVerdict, setupGateState, executionHeld);
  const posture = marketPostureLabel(decision.action);
  const conf =
    decision.confidence != null && Number.isFinite(decision.confidence)
      ? `${Math.round(decision.confidence)}%`
      : "—";

  return (
    <header className="sticky top-0 z-20 shrink-0 border-b border-slate-800/90 bg-slate-950/95 px-4 py-3 backdrop-blur-sm md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Execution workspace</p>
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 id="trade-terminal-title" className="text-xl font-bold tabular-nums tracking-tight text-slate-50">
              {symbol}
            </h2>
            <span className="text-sm tabular-nums text-slate-300">{priceDisplay}</span>
            <span
              className={`text-xs font-semibold tabular-nums ${
                changePct != null && changePct >= 0 ? "text-emerald-300" : "text-rose-300"
              }`}
            >
              {pct(changePct)}
            </span>
          </div>
          {showQuoteMeta && (quoteStreamActive || quoteQuality) ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {quoteStreamActive ? (
                <span className="inline-flex items-center gap-1 rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400 motion-safe:animate-pulse" aria-hidden />
                  Live stream
                </span>
              ) : null}
              {quoteQuality === "stale" ? (
                <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200">
                  Stale quote
                </span>
              ) : null}
              {quoteQuality === "cached" ? (
                <span className="rounded border border-slate-600 bg-slate-900/90 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Cached
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <span className={`shrink-0 rounded-md border px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${pill.cls}`}>
          {pill.text}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-snug text-slate-400">{statusLine}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded border border-slate-700/80 bg-slate-900/80 px-2 py-0.5 font-semibold uppercase tracking-wide text-slate-200">
          Signal · {orderSide}
        </span>
        <span className="rounded border border-slate-700/80 bg-slate-900/80 px-2 py-0.5 font-semibold uppercase tracking-wide text-slate-200">
          System · {posture}
        </span>
        <span className="rounded border border-slate-700/80 bg-slate-900/80 px-2 py-0.5 font-bold uppercase tracking-wide text-cyan-200">
          Order · {orderSide === "SELL" ? "EXIT" : orderSide}
        </span>
        <span className="text-slate-500">
          Confidence <span className="font-semibold tabular-nums text-cyan-300">{conf}</span>
        </span>
      </div>
    </header>
  );
}
