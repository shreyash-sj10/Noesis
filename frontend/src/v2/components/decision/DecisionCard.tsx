import { memo } from "react";
import type { Decision } from "../../domain/decision/buildDecision";

export type DecisionMeta = {
  pnlPct?: number;
  quantity?: number;
  changePct?: number;
  /** Scanner / tape regime when opening the trade workspace */
  trend?: string;
  signalTag?: string;
  journalCorrection?: string;
  journalInsight?: string;
  /** Average entry from /portfolio/positions (paise) */
  avgPricePaise?: number;
  currentPricePaise?: number;
  unrealizedPnLPaise?: number;
  dayChangePct?: number | null;
  isFallback?: boolean;
};

export type DecisionCardProps = {
  title: string;
  decision: Decision;
  meta?: DecisionMeta;
  onPrimaryAction?: () => void;
};

function metaLabel(meta: DecisionMeta | undefined): string | null {
  if (!meta) return null;
  const parts: string[] = [];
  if (meta.pnlPct !== undefined) {
    const sign = meta.pnlPct > 0 ? "+" : "";
    parts.push(`PnL ${sign}${meta.pnlPct}%`);
  }
  if (meta.quantity !== undefined) {
    parts.push(`Qty ${meta.quantity}`);
  }
  if (meta.changePct !== undefined) {
    const sign = meta.changePct > 0 ? "+" : "";
    parts.push(`${sign}${meta.changePct}%`);
  }
  if (meta.signalTag) {
    parts.push(meta.signalTag);
  }
  return parts.length ? parts.join(" · ") : null;
}

function DecisionCard({
  title,
  decision,
  meta,
  onPrimaryAction,
}: DecisionCardProps) {
  const { action, confidence, reason } = decision;
  const variant =
    action === "ACT"
      ? "decision-card--act"
      : action === "GUIDE"
        ? "decision-card--guide"
        : "decision-card--block";

  const badgeClass =
    action === "ACT"
      ? "decision-card__badge decision-card__badge--act"
      : action === "GUIDE"
        ? "decision-card__badge decision-card__badge--guide"
        : "decision-card__badge decision-card__badge--block";

  const ctaLabel =
    action === "ACT" ? "Act Now" : action === "GUIDE" ? "Review" : "View Risk";
  const isBlock = action === "BLOCK";

  const metaText = metaLabel(meta);

  return (
    <article className={`card ${variant}`}>
      <div className="decision-card__header">
        <span className={badgeClass}>{action}</span>
        <span className="decision-card__conf">{confidence}%</span>
      </div>
      <p className="decision-card__reason">{reason}</p>
      <h2 className="decision-card__title">{title}</h2>
      {meta?.journalCorrection ? (
        <p className="decision-card__journal-primary page-note">{meta.journalCorrection}</p>
      ) : null}
      {meta?.journalInsight ? (
        <p className="decision-card__journal-secondary page-note">{meta.journalInsight}</p>
      ) : null}
      {metaText ? <p className="decision-card__meta">{metaText}</p> : null}
      <button
        type="button"
        className={
          isBlock
            ? "decision-card__cta decision-card__cta--block"
            : "decision-card__cta"
        }
        disabled={isBlock}
        onClick={isBlock ? undefined : onPrimaryAction}
        aria-label={
          isBlock ? `${ctaLabel} (disabled) — ${title}` : `${ctaLabel}: ${title}`
        }
      >
        {ctaLabel}
      </button>
    </article>
  );
}

export default memo(DecisionCard);
