const { normalizeSymbol, toYahooSymbol } = require("../../src/utils/symbol.utils");

describe("symbol.utils", () => {
  it("normalizeSymbol strips spaces and commas", () => {
    expect(normalizeSymbol(" reli ance ")).toBe("RELIANCE.NS");
    expect(normalizeSymbol("TCS, .NS")).toBe("TCS.NS");
  });

  it("toYahooSymbol mirrors normalization for plain tickers", () => {
    expect(toYahooSymbol("infy")).toBe("INFY.NS");
    expect(toYahooSymbol("^NSEI")).toBe("^NSEI");
  });
});
