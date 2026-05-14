export type TradeExecutionBarProps = {
  /** Short headline above the button */
  stateHeadline: string;
  /** Supporting line when locked or incomplete */
  stateDetail?: string;
  primaryLabel: string;
  canPrimary: boolean;
  onPrimary?: () => void;
  onCancel: () => void;
  /** When false, primary is styled as blocked but may still be focusable for SR */
  showPrimary?: boolean;
  /** Optional second action (e.g. “Return to setup” while primary is “Retry submit”). */
  secondaryLabel?: string;
  canSecondary?: boolean;
  onSecondary?: () => void;
};

export default function TradeExecutionBar({
  stateHeadline,
  stateDetail,
  primaryLabel,
  canPrimary,
  onPrimary,
  onCancel,
  showPrimary = true,
  secondaryLabel,
  canSecondary = false,
  onSecondary,
}: TradeExecutionBarProps) {
  return (
    <footer className="sticky bottom-0 z-20 shrink-0 border-t border-slate-800/90 bg-slate-950/95 px-4 py-3 backdrop-blur-sm md:px-5">
      <div className="mb-2 space-y-0.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Execution</p>
        <p className="text-sm font-semibold text-slate-100">{stateHeadline}</p>
        {stateDetail ? <p className="line-clamp-2 text-xs leading-snug text-slate-500">{stateDetail}</p> : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {showPrimary ? (
          <button
            type="button"
            onClick={() => onPrimary?.()}
            disabled={!canPrimary}
            className={`min-h-11 flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
              canPrimary
                ? "bg-cyan-500 text-slate-950 hover:bg-cyan-400"
                : "cursor-not-allowed bg-slate-800 text-slate-500"
            }`}
          >
            {primaryLabel}
          </button>
        ) : null}
        {secondaryLabel ? (
          <button
            type="button"
            onClick={() => onSecondary?.()}
            disabled={!canSecondary}
            className={`min-h-11 flex-1 rounded-lg border px-4 py-2.5 text-sm font-semibold transition sm:max-w-[12rem] ${
              canSecondary
                ? "border-slate-600 text-slate-200 hover:border-slate-500 hover:bg-slate-900/80"
                : "cursor-not-allowed border-slate-800 text-slate-600"
            }`}
          >
            {secondaryLabel}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-slate-100 sm:min-w-[7rem]"
        >
          Close
        </button>
      </div>
    </footer>
  );
}
