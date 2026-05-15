const { adaptPortfolio } = require("../../src/adapters/portfolio.adapter");

describe("adaptPortfolio — paise contract", () => {
  it("rounds monetary fields to integer paise and computes totalPnlPct without throwing", () => {
    const out = adaptPortfolio({
      netEquity: 10000050.7,
      balance: 5000000.2,
      totalInvested: 4_000_000,
      unrealizedPnL: 100.2,
      realizedPnL: 50.8,
      winRate: 55,
      pendingOrders: [],
    });

    expect(out.totalValuePaise).toBe(10000051);
    expect(out.balancePaise).toBe(5000000);
    expect(out.unrealizedPnLPaise).toBe(100);
    expect(out.realizedPnLPaise).toBe(51);
    expect(out.totalInvestedPaise).toBe(4_000_000);
    expect(Number.isFinite(out.totalPnlPct)).toBe(true);
  });

  it("keeps explicit totalPnlPct when provided", () => {
    const out = adaptPortfolio({
      netEquity: 1,
      balance: 1,
      totalInvested: 1,
      unrealizedPnL: 0,
      realizedPnL: 0,
      totalPnlPct: 12.34,
      winRate: 0,
      pendingOrders: [],
    });
    expect(out.totalPnlPct).toBe(12.34);
  });
});
