import { describe, expect, it } from "vitest";
import { formatNseSessionBadge, type MarketSessionDTO } from "./marketSessionLabels";

const base = (): MarketSessionDTO => ({
  istDateKey: "2026-05-14",
  clockState: "OPEN",
  isMarketOpen: true,
  exchangeMic: "XNSE",
  squareoffTimeIst: "15:20",
  calendarRowPresent: true,
  dataIntegrityHint: null,
  nseCashSession: { openTimeIst: "09:15", closeTimeIst: "15:30" },
});

describe("formatNseSessionBadge", () => {
  it("formats open session", () => {
    expect(formatNseSessionBadge(base())).toContain("XNSE");
    expect(formatNseSessionBadge(base())).toContain("Open");
    expect(formatNseSessionBadge(base())).toContain("09:15–15:30 IST");
    expect(formatNseSessionBadge(base())).toContain("sq-off 15:20");
  });

  it("warns when calendar row missing", () => {
    const s = {
      ...base(),
      calendarRowPresent: false,
      isMarketOpen: false,
      clockState: "POST_CLOSE",
    };
    expect(formatNseSessionBadge(s)).toContain("no calendar row");
  });
});
