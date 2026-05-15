type PositionRowProps = {
  symbol: string;
  entryDisplay: string;
  statusLabel: string;
  pnlPctDisplay: string;
  riskNote: string;
  actionLabel: string;
  onReview: () => void;
  compact?: boolean;
};

export default function PositionRow({
  symbol,
  entryDisplay,
  statusLabel,
  pnlPctDisplay,
  riskNote,
  actionLabel,
  onReview,
  compact = false,
}: PositionRowProps) {
  const statusTone =
    statusLabel === "At risk"
      ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
      : statusLabel === "Guided"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
        : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";

  if (compact) {
    return (
      <article className="home-position-row home-position-row--compact">
        <div className="home-position-row__main">
          <p className="home-position-row__symbol">{symbol}</p>
          <p className="home-position-row__meta">
            {entryDisplay} · <span>{pnlPctDisplay}</span>
          </p>
        </div>
        <span className={`home-position-row__badge ${statusTone}`}>{statusLabel}</span>
        <button type="button" className="home-position-row__btn" onClick={onReview}>
          {actionLabel}
        </button>
      </article>
    );
  }

  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-semibold tabular-nums tracking-tight text-slate-100">{symbol}</p>
        <span className={`rounded-md border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${statusTone}`}>
          {statusLabel}
        </span>
      </div>
      <div className="mt-4 grid gap-2 text-sm leading-relaxed text-slate-300 md:grid-cols-2">
        <p>Entry: {entryDisplay}</p>
        <p>P&amp;L: {pnlPctDisplay}</p>
      </div>
      {riskNote ? <p className="mt-2 text-sm leading-relaxed text-slate-400">{riskNote}</p> : null}
      <button
        type="button"
        className="mt-4 min-h-10 rounded-lg border border-cyan-500/50 px-3 py-2 text-sm font-medium text-cyan-300 transition hover:border-cyan-300 hover:text-cyan-200"
        onClick={onReview}
      >
        {actionLabel}
      </button>
    </article>
  );
}
