import { useNavigate } from "react-router-dom";
import type { NextActionVM } from "../mapHomeViewModel";
import { ROUTES } from "../../../routing/routes";

type NextActionPanelProps = {
  model: NextActionVM;
  onReview: () => void;
  onPrimaryAction: () => void;
};

const shell =
  "rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 md:flex md:items-center md:justify-between md:gap-4";

function Label({ tone }: { tone: "muted" | "warn" | "accent" }) {
  const cls =
    tone === "warn"
      ? "text-amber-200/90"
      : tone === "accent"
        ? "text-cyan-300/90"
        : "text-slate-500";
  return (
    <p className={`text-[10px] font-semibold uppercase tracking-wider ${cls}`}>Next action</p>
  );
}

function PrimaryButton({
  children,
  onClick,
  variant,
}: {
  children: string;
  onClick: () => void;
  variant: "warn" | "accent" | "muted";
}) {
  const cls =
    variant === "warn"
      ? "border-amber-500/35 text-amber-100/90 hover:border-amber-500/55 hover:bg-amber-500/10"
      : variant === "accent"
        ? "border-cyan-500/35 text-cyan-100/90 hover:border-cyan-500/55 hover:bg-cyan-500/10"
        : "border-slate-600 text-slate-300 hover:bg-slate-800/80";
  return (
    <button
      type="button"
      className={`mt-3 shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium transition md:mt-0 ${cls}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function NextActionPanel({ model, onReview, onPrimaryAction }: NextActionPanelProps) {
  const navigate = useNavigate();

  if (model.variant === "loading") {
    return (
      <section className={shell} aria-busy="true" aria-label="Next action">
        <div className="min-w-0 space-y-1">
          <Label tone="muted" />
          <p className="text-sm font-medium text-slate-200">{model.headline}</p>
          <p className="text-sm leading-snug text-slate-400">{model.sub}</p>
          {model.reasoning ? (
            <p className="text-xs leading-relaxed text-slate-500">{model.reasoning}</p>
          ) : null}
        </div>
      </section>
    );
  }

  if (model.variant === "review") {
    return (
      <section
        className={`${shell} border-l-2 border-l-amber-500/45`}
        aria-label="Next action"
      >
        <div className="min-w-0 space-y-1">
          <Label tone="warn" />
          <p className="text-sm font-medium text-slate-100">{model.headline}</p>
          <p className="text-sm leading-snug text-slate-300">{model.sub}</p>
          {model.reasoning ? (
            <p className="text-xs leading-relaxed text-slate-500">{model.reasoning}</p>
          ) : null}
        </div>
        <PrimaryButton variant="warn" onClick={onReview}>
          {model.ctaLabel}
        </PrimaryButton>
      </section>
    );
  }

  return (
    <section className={shell} aria-label="Next action">
      <div className="min-w-0 space-y-1">
        <Label tone="accent" />
        <p className="text-sm font-medium text-slate-100">{model.headline}</p>
        <p className="text-sm leading-snug text-slate-300">{model.sub}</p>
        {model.reasoning ? (
          <p className="text-xs leading-relaxed text-slate-500">{model.reasoning}</p>
        ) : null}
      </div>
      <PrimaryButton
        variant="accent"
        onClick={() => {
          if (model.variant === "active") {
            onPrimaryAction();
            return;
          }
          navigate(ROUTES.markets);
        }}
      >
        {model.ctaLabel}
      </PrimaryButton>
    </section>
  );
}
