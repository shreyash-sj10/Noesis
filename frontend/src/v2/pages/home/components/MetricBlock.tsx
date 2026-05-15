type MetricBlockProps = {
  label: string;
  value: string;
  interpretation: string;
  isLoading?: boolean;
  valueClassName?: string;
};

export default function MetricBlock({
  label,
  value,
  interpretation,
  isLoading = false,
  valueClassName = "text-slate-100",
}: MetricBlockProps) {
  return (
    <article className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      {isLoading ? (
        <div className="mt-4 space-y-2" aria-hidden>
          <div className="h-8 w-28 animate-pulse rounded bg-slate-800" />
          <div className="h-4 w-40 animate-pulse rounded bg-slate-800" />
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          <p className={`text-2xl font-semibold tabular-nums tracking-tight ${valueClassName}`}>{value}</p>
          <p className="text-sm leading-relaxed text-slate-400">{interpretation}</p>
        </div>
      )}
    </article>
  );
}
