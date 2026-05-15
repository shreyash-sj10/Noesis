import type { SystemStatusVM } from "../mapHomeViewModel";

type SystemStatusBarProps = {
  model: SystemStatusVM;
};

function toneFor(value: string): string {
  if (value === "OPEN" || value === "SYNCED" || value === "READY") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  }
  if (value === "CLOSED") {
    return "border-slate-600 bg-slate-800/80 text-slate-300";
  }
  if (value === "ACTION REQUIRED" || value === "DELAYED") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  }
  return "border-slate-700 bg-slate-800 text-slate-200";
}

export default function SystemStatusBar({ model }: SystemStatusBarProps) {
  return (
    <section
      aria-label="System status"
      className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/70 p-4"
    >
      <div className="grid gap-2 md:grid-cols-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-slate-400">Market</p>
          <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${toneFor(model.marketStatus)}`}>
            {model.marketStatus}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-slate-400">Data</p>
          <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${toneFor(model.dataStatus)}`}>
            {model.dataStatus}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-slate-400">Execution</p>
          <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${toneFor(model.executionStatus)}`}>
            {model.executionStatus}
          </span>
        </div>
      </div>
      <div className="grid gap-2 text-xs leading-relaxed text-slate-500 md:grid-cols-3">
        <p>{model.marketReason}</p>
        <p>{model.dataReason}</p>
        <p>{model.executionReason}</p>
      </div>
    </section>
  );
}
