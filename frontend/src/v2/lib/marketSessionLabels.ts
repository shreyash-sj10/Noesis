/** Shape returned by GET /api/market/session (data field). */
export type MarketSessionDTO = {
  istDateKey: string;
  clockState: string;
  isMarketOpen: boolean;
  exchangeMic: string;
  squareoffTimeIst: string;
  calendarRowPresent: boolean;
  calendarCacheAlignedToToday?: boolean;
  dataIntegrityHint: string | null;
  nseCashSession: {
    openTimeIst: string;
    closeTimeIst: string;
    note?: string;
  };
};

/** One-line badge for top-of-app strip (IST, NSE-oriented). */
export function formatNseSessionBadge(s: MarketSessionDTO): string {
  const sess = `${s.nseCashSession.openTimeIst}–${s.nseCashSession.closeTimeIst} IST`;
  let gate: string;
  if (s.isMarketOpen) gate = "Open";
  else if (s.clockState === "WEEKEND") gate = "Weekend";
  else if (s.clockState === "HOLIDAY") gate = "Holiday";
  else if (s.clockState === "PRE_OPEN") gate = "Pre-open";
  else if (s.clockState === "POST_CLOSE") gate = "After close";
  else gate = "Closed";
  const calWarn = !s.calendarRowPresent ? " · no calendar row" : "";
  return `${s.exchangeMic} ${gate} · ${sess} · sq-off ${s.squareoffTimeIst}${calWarn}`;
}
