import type { BehaviorInsightVM } from "../mapHomeViewModel";

type BehaviorInsightProps = {
  model: BehaviorInsightVM;
  acknowledged: boolean;
  onAcknowledge: () => void;
  compact?: boolean;
};

export default function BehaviorInsight({
  model,
  acknowledged,
  onAcknowledge,
  compact = false,
}: BehaviorInsightProps) {
  if (acknowledged) {
    return <p className="page-note text-xs">Dismissed this session.</p>;
  }

  if (compact) {
    if (model.kind === "insufficient") {
      return (
        <p className="text-xs leading-relaxed text-slate-400">
          {model.missing}{" "}
          <button type="button" className="home-panel__link-btn" onClick={onAcknowledge}>
            Dismiss
          </button>
        </p>
      );
    }
    return (
      <div className="home-behavior-compact">
        <p className="text-sm font-medium text-slate-200">{model.pattern}</p>
        <p className="mt-1 text-xs text-slate-400">{model.correction}</p>
        <button type="button" className="home-panel__link-btn mt-2" onClick={onAcknowledge}>
          Acknowledge
        </button>
      </div>
    );
  }

  if (model.kind === "insufficient") {
    return (
      <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Missing</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-200">{model.missing}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Next step</p>
          <p className="mt-2 text-sm leading-relaxed text-cyan-300">{model.nextStep}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pattern</p>
        <p className="mt-2 text-sm font-medium leading-relaxed text-slate-100">{model.pattern}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Impact</p>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">{model.impact}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Correction</p>
        <p className="mt-2 text-sm leading-relaxed text-cyan-300">{model.correction}</p>
      </div>
      <button
        type="button"
        className="min-h-10 rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-cyan-400 hover:text-cyan-300"
        onClick={onAcknowledge}
      >
        Acknowledge
      </button>
    </div>
  );
}
