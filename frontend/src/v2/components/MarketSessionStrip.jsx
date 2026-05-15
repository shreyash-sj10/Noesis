import { formatNseSessionBadge } from "../lib/marketSessionLabels";
import { useMarketSession } from "../hooks/useMarketSession";

/**
 * Thin IST / NSE session strip for authenticated shell (refreshes every 60s).
 */
export default function MarketSessionStrip() {
  const { data, isError, isLoading } = useMarketSession();

  const stripTitle = (hint) =>
    hint || "NSE cash timings in Asia/Kolkata (IST). Paper simulation only.";

  if (isError || (!isLoading && !data)) {
    return (
      <div
        className="shrink-0 border-b border-amber-900/40 bg-slate-950/90 px-3 py-1.5 text-center font-mono text-[10px] font-semibold uppercase leading-snug tracking-wide text-amber-200/90 md:px-4"
        role="alert"
        title="Session API failed — market open/close rules may be conservative until this loads."
      >
        NSE session · unavailable
      </div>
    );
  }

  const line = data ? formatNseSessionBadge(data) : "Loading NSE session (IST)…";
  const hint = data?.dataIntegrityHint;

  return (
    <div
      className="shrink-0 border-b border-slate-800/80 bg-slate-950/85 px-3 py-1.5 text-center font-mono text-[10px] font-semibold uppercase leading-snug tracking-wide text-slate-400 md:px-4"
      role="status"
      aria-busy={isLoading}
      aria-live="polite"
      title={stripTitle(hint)}
    >
      <span className="text-slate-300">{line}</span>
      {hint ? (
        <span className="block normal-case text-amber-400/90 md:inline md:before:content-['\00a0·\00a0']">
          {hint}
        </span>
      ) : null}
    </div>
  );
}
