import type { DecisionCardProps } from "../../components/decision/DecisionCard";
import type { PendingOrderSummary } from "../../hooks/usePortfolioSummary";
import { formatSignedINR, fromPaise } from "../../../utils/currency.utils";
import { formatEntryInr } from "../home/mapHomeViewModel";

export type PlanTier = "breach" | "at-risk" | "within-plan";

export function planTierFromAction(action: string | undefined): PlanTier {
  if (action === "BLOCK") return "breach";
  if (action === "GUIDE") return "at-risk";
  return "within-plan";
}

function systemContextLine(tier: PlanTier): string {
  if (tier === "breach") return "Stop violated — risk beyond plan";
  if (tier === "at-risk") return "Approaching stop — monitor closely";
  return "Trend intact — no action required";
}

function statusLabel(tier: PlanTier): string {
  if (tier === "breach") return "Needs attention";
  if (tier === "at-risk") return "Needs review";
  return "On plan";
}

type Props = {
  item: DecisionCardProps;
  onReview: () => void;
};

export type ClosedStripTrade = {
  tradeId: string;
  symbol: string;
  pricePaise: number;
  quantity: number;
  pnlPct: number | null;
  pnlPaise: number | null;
  side: string;
  closedAt?: string | null;
  preTradeEmotionAtEntry?: string | null;
};

type ClosedProps = {
  trade: ClosedStripTrade;
  formatExitInr: (paise: number) => string;
  formatPnlInr: (paise: number) => string;
};

/** Queued order (after-hours): same strip layout as active rows. */
type PendingProps = {
  order: PendingOrderSummary;
  formatPriceInr: (paise: number) => string;
  formatNotionalInr: (paise: number) => string;
};

/** Queued execution (e.g. order placed outside market hours). */
export function PortfolioPendingStrip({ order, formatPriceInr, formatNotionalInr }: PendingProps) {
  const base = (order.symbol || "").split(".")[0] || order.symbol;
  const when = order.createdAt
    ? new Date(order.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "—";
  const notional = order.totalValuePaise ?? 0;
  const side = (order.side || "").toUpperCase();

  return (
    <article
      className="portfolio-decision-strip portfolio-decision-strip--pending"
      aria-label={`Pending order ${base}`}
    >
      <div className="portfolio-decision-strip__accent" aria-hidden />
      <div className="portfolio-decision-strip__body">
        <div className="portfolio-decision-strip__left">
          <div className="portfolio-decision-strip__symbol">{base}</div>
          <div className="portfolio-decision-strip__entry">
            {side} · {order.quantity}u @ {formatPriceInr(order.pricePaise)}
          </div>
          <p className="portfolio-decision-strip__context portfolio-decision-strip__context--muted">
            Submitted {when} — executes when the cash session is open.
            {order.preTradeEmotion ? (
              <span className="portfolio-strip-mood" title="Self-reported mood when you placed this order">
                {" "}
                · Behavior: {order.preTradeEmotion}
              </span>
            ) : null}
          </p>
        </div>
        <div className="portfolio-decision-strip__center">
          <span className="portfolio-strip-badge portfolio-strip-badge--pending">Queued</span>
          <div className="portfolio-strip__pnl portfolio-strip__pnl--flat" style={{ fontSize: "var(--text-sm)" }}>
            {notional > 0 ? formatNotionalInr(notional) : "—"}
          </div>
        </div>
        <div className="portfolio-decision-strip__right" />
      </div>
    </article>
  );
}

function behaviorLabel(raw: string | null | undefined): string {
  if (!raw) return "Not logged";
  const value = raw.trim().toUpperCase();
  if (["CALM", "DISCIPLINED", "CONFIDENT"].includes(value)) return "Calm / Disciplined";
  if (["UNCERTAIN", "ANXIOUS"].includes(value)) return "Uncertain / Tense";
  if (["FOMO", "EXCITED"].includes(value)) return "Impulse risk";
  if (["REVENGE", "FRUSTRATED"].includes(value)) return "Tilt / Recovery";
  return value;
}

function alignmentLabel(verdict: string | null | undefined): string {
  const v = (verdict || "").toUpperCase();
  if (v === "ACT") return "Controlled";
  if (v === "GUIDE") return "Needs review";
  if (v === "BLOCK") return "Needs attention";
  return "Unknown";
}

function estimateEntryPricePaise(trade: ClosedStripTrade): number | null {
  if (trade.pnlPct == null || !Number.isFinite(trade.pnlPct)) return null;
  const denominator = 1 + trade.pnlPct / 100;
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round(trade.pricePaise / denominator);
}

function closedInsight(trade: ClosedStripTrade): string {
  const pnl = trade.pnlPct ?? null;
  const verdict = (trade.verdict || "").toUpperCase();
  const behavior = (trade.preTradeEmotionAtEntry || "").toUpperCase();
  const disciplinedBehavior = ["CALM", "DISCIPLINED", "CONFIDENT"].includes(behavior);
  const impulsiveBehavior = ["FOMO", "EXCITED", "REVENGE", "FRUSTRATED"].includes(behavior);

  if (pnl != null && pnl > 1 && disciplinedBehavior && verdict === "ACT") return "Disciplined execution";
  if (pnl != null && pnl < 0 && impulsiveBehavior) return "Low edge trade";
  if (pnl != null && pnl < 0 && verdict === "GUIDE") return "Premature exit";
  if (pnl != null && pnl > 0 && verdict === "ACT") return "Controlled follow-through";
  if (verdict === "BLOCK") return "Risk plan breached before close";
  return "Review setup quality and exit timing";
}

export function PortfolioClosedStrip({ trade, formatExitInr, formatPnlInr }: ClosedProps) {
  const pnl = trade.pnlPct;
  const pnlPos = pnl != null && pnl > 0;
  const pnlCls =
    pnl == null
      ? "portfolio-strip__pnl portfolio-strip__pnl--flat"
      : pnlPos
        ? "portfolio-strip__pnl portfolio-strip__pnl--pos"
        : pnl < 0
          ? "portfolio-strip__pnl portfolio-strip__pnl--neg"
          : "portfolio-strip__pnl portfolio-strip__pnl--flat";
  const pnlStr = pnl == null ? "—" : `${pnlPos ? "+" : ""}${pnl.toFixed(2)}%`;
  const date = trade.closedAt ? new Date(trade.closedAt).toLocaleDateString("en-IN") : "—";
  const pnlMoney = trade.pnlPaise != null ? formatPnlInr(trade.pnlPaise) : null;
  const entryPaise = estimateEntryPricePaise(trade);
  const behavior = behaviorLabel(trade.preTradeEmotionAtEntry);
  const alignment = alignmentLabel(trade.verdict);
  const insight = closedInsight(trade);
  const entryDisplay = entryPaise != null ? formatExitInr(entryPaise) : "—";

  return (
    <article
      className="portfolio-decision-strip portfolio-decision-strip--closed"
      aria-label={`Closed ${trade.symbol}`}
    >
      <div className="portfolio-decision-strip__accent" aria-hidden />
      <div className="portfolio-decision-strip__body">
        <div className="portfolio-decision-strip__left">
          <div className="portfolio-decision-strip__symbol">{trade.symbol}</div>
          <div className="portfolio-decision-strip__entry">
            Entry vs Exit · {entryDisplay} → {formatExitInr(trade.pricePaise)}
          </div>
          <div className="portfolio-decision-strip__entry">
            Result · {pnlStr} {pnlMoney ? `(${pnlMoney})` : ""}
          </div>
          <div className="portfolio-decision-strip__entry">
            Behavior · {behavior} · Alignment · {alignment}
          </div>
          <p className="portfolio-decision-strip__context portfolio-decision-strip__context--muted">
            Closed {date} · System insight: {insight}
          </p>
        </div>
        <div className="portfolio-decision-strip__center">
          <span className="portfolio-strip-badge portfolio-strip-badge--closed">Completed</span>
          <div className={pnlCls}>{pnlStr}</div>
        </div>
        <div className="portfolio-decision-strip__right" />
      </div>
    </article>
  );
}

function formatLtp(paise: number | undefined): string {
  if (paise == null || !Number.isFinite(paise) || paise <= 0) return "—";
  return `₹${fromPaise(paise).toFixed(2)}`;
}

function formatDayPct(day: number | null | undefined): { text: string; cls: string } {
  if (day == null || !Number.isFinite(day)) {
    return { text: "—", cls: "portfolio-metric__value--flat" };
  }
  const pos = day > 0;
  const neg = day < 0;
  return {
    text: `${pos ? "+" : ""}${day.toFixed(2)}%`,
    cls: pos
      ? "portfolio-metric__value--pos"
      : neg
        ? "portfolio-metric__value--neg"
        : "portfolio-metric__value--flat",
  };
}

function pnlValueClass(value: number): string {
  if (value > 0) return "portfolio-metric__value--pos";
  if (value < 0) return "portfolio-metric__value--neg";
  return "portfolio-metric__value--flat";
}

export default function PortfolioDecisionStrip({ item, onReview }: Props) {
  const tier = planTierFromAction(item.decision?.action);
  const pnl = item.meta?.pnlPct ?? 0;
  const pnlPos = pnl > 0;
  const pnlCls =
    pnlPos
      ? "portfolio-strip__pnl portfolio-strip__pnl--pos portfolio-strip__pnl--compact"
      : pnl < 0
        ? "portfolio-strip__pnl portfolio-strip__pnl--neg portfolio-strip__pnl--compact"
        : "portfolio-strip__pnl portfolio-strip__pnl--flat portfolio-strip__pnl--compact";
  const pnlStr = `${pnlPos ? "+" : ""}${pnl.toFixed(2)}%`;
  const qty = item.meta?.quantity;
  const entry = formatEntryInr(item.meta?.avgPricePaise);
  const ltp = formatLtp(item.meta?.currentPricePaise);
  const day = formatDayPct(item.meta?.dayChangePct ?? item.meta?.changePct);
  const unreal = item.meta?.unrealizedPnLPaise;
  const unrealStr =
    unreal != null && Number.isFinite(unreal) ? formatSignedINR(unreal) : "—";
  const stale = item.meta?.isFallback;

  return (
    <article
      className={`portfolio-decision-strip portfolio-decision-strip--${tier}`}
      aria-label={`Position ${item.title}`}
    >
      <div className="portfolio-decision-strip__accent" aria-hidden />
      <div className="portfolio-decision-strip__body">
        <div className="portfolio-decision-strip__left">
          <button
            type="button"
            className="portfolio-decision-strip__symbol-btn"
            onClick={onReview}
            title={`Open ${item.title} in trade terminal`}
          >
            {item.title}
          </button>
          <p className="portfolio-decision-strip__context">{systemContextLine(tier)}</p>
          <dl className="portfolio-position-metrics" aria-label={`${item.title} position metrics`}>
            <div>
              <dt>LTP</dt>
              <dd>
                {ltp}
                {stale ? <span className="portfolio-metric__hint"> est.</span> : null}
              </dd>
            </div>
            <div>
              <dt>Today</dt>
              <dd className={day.cls}>{day.text}</dd>
            </div>
            <div>
              <dt>Entry</dt>
              <dd>{entry}</dd>
            </div>
            <div>
              <dt>Qty</dt>
              <dd>{qty != null && qty > 0 ? qty : "—"}</dd>
            </div>
            <div>
              <dt>Unrealized</dt>
              <dd className={pnlValueClass(unreal ?? 0)}>{unrealStr}</dd>
            </div>
            <div>
              <dt>Since entry</dt>
              <dd className={pnlValueClass(pnl)}>{pnlStr}</dd>
            </div>
          </dl>
        </div>
        <div className="portfolio-decision-strip__center">
          <span className={`portfolio-strip-badge portfolio-strip-badge--${tier}`}>
            {statusLabel(tier)}
          </span>
          <div className={pnlCls} aria-label="P and L since entry">
            {pnlStr}
          </div>
        </div>
        <div className="portfolio-decision-strip__right">
          <button type="button" className="portfolio-strip__cta" onClick={onReview}>
            Open terminal
          </button>
        </div>
      </div>
    </article>
  );
}
