import { describe, expect, it } from "vitest";
import { buildSystemStatus } from "./mapHomeViewModel";

describe("buildSystemStatus", () => {
  it("uses server session when closed after hours", () => {
    const vm = buildSystemStatus(false, false, false, [], {
      isMarketOpen: false,
      clockState: "POST_CLOSE",
    });
    expect(vm.marketStatus).toBe("CLOSED");
    expect(vm.dataStatus).toBe("SYNCED");
    expect(vm.marketReason).toContain("After close");
    expect(vm.executionReason).toContain("Session closed");
  });

  it("never labels data feeds as LIVE", () => {
    const vm = buildSystemStatus(false, false, false, [], {
      isMarketOpen: true,
      clockState: "OPEN",
    });
    expect(vm.dataStatus).toBe("SYNCED");
    expect(vm.dataStatus).not.toBe("LIVE");
  });
});
