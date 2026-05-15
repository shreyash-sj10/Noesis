import { LogOut } from "lucide-react";
import { useAuth } from "../../../features/auth/useAuth.jsx";
import { useTickerData } from "../../hooks/useTickerData";
import { usePortfolioSummary } from "../../hooks/usePortfolioSummary";
import { useMarketSession, topbarSessionLabel } from "../../hooks/useMarketSession";
import { formatINR } from "../../../utils/currency.utils";

function TickerBand({ items }) {
  if (!items || items.length === 0) return null;

  // Duplicate the list so the CSS marquee loop is seamless
  const doubled = [...items, ...items];

  return (
    <div className="ticker-band" aria-hidden="true">
      <div className="ticker-band__track">
        {doubled.map((item, i) => {
          const up   = item.changePercent > 0;
          const down = item.changePercent < 0;
          const sign = up ? "+" : "";
          const cls  = up ? "ticker-item__change--up" : down ? "ticker-item__change--down" : "ticker-item__change--flat";
          return (
            <span key={`${item.symbol}-${i}`} className="ticker-item">
              <span className="ticker-item__label">{item.label}</span>
              <span className={`ticker-item__change ${cls}`}>
                {sign}{item.changePercent.toFixed(2)}%
              </span>
              <span className="ticker-item__sep" aria-hidden="true">·</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function Topbar() {
  const { logout } = useAuth();
  const { ticker } = useTickerData();
  const { summary, isLoading: summaryLoading, isError: summaryError } = usePortfolioSummary();
  const { data: session, isLoading: sessionLoading, isError: sessionError } = useMarketSession();
  const sessionOpen = session?.isMarketOpen === true;
  const sessionLabel = topbarSessionLabel(session, sessionLoading);
  const sessionTitle = sessionLoading
    ? "Loading NSE session (IST)…"
    : sessionError || !session
      ? "Session unknown — paper sim only; quotes may be cached or delayed."
      : sessionOpen
        ? "NSE cash session is open (IST). Quotes may stream when connected."
        : "NSE cash session is closed (IST). Header does not mean live trading; quotes may still refresh from cache.";

  const balancePaise = Number(summary?.balancePaise ?? 0);
  const cashDisplay =
    !summary && summaryLoading
      ? "…"
      : summaryError && !summary
        ? "—"
        : formatINR(Number.isFinite(balancePaise) ? balancePaise : 0);

  return (
    <header className="topbar">
      {/* ── LEFT: brand ─────────────────────────────────── */}
      <div className="topbar__left">
        <span className="topbar__brand">NOESIS</span>
      </div>

      {/* ── CENTER: 50% animated market ticker ──────────── */}
      <div className="topbar__center">
        <TickerBand items={ticker} />
      </div>

      {/* ── RIGHT: balance + actions ─────────────────────── */}
      <div className="topbar__right">
        <span
          className={`topbar-status${sessionOpen ? " topbar-status--open" : " topbar-status--closed"}`}
          title={sessionTitle}
        >
          <span className="topbar-status__dot" aria-hidden="true" />
          <span className="topbar-status__label">{sessionLabel}</span>
        </span>
        <span
          className="topbar-balance"
          title="Cash only (withdrawable). Net equity on Home includes open positions."
        >
          Cash <span className="topbar-balance__amount">{cashDisplay}</span>
        </span>
        <button
          type="button"
          className="topbar-btn-icon"
          onClick={logout}
          aria-label="Log out"
          title="Log out"
        >
          <LogOut size={14} />
        </button>
      </div>
    </header>
  );
}
