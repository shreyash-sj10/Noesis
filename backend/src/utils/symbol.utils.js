/**
 * NSE/BSE-style symbol normalisation for holdings, trades, and Yahoo batch quotes.
 * Indian symbols without an exchange suffix default to `.NS`.
 */
function normalizeSymbol(symbol) {
  if (symbol == null) return symbol;
  const collapsed = String(symbol).replace(/[\s,]+/g, "").trim();
  if (collapsed === "") return null;
  const u = collapsed.toUpperCase();
  if (u.endsWith(".NS") || u.endsWith(".BO")) return u;
  return `${u}.NS`;
}

/**
 * Yahoo Finance symbol rules: indices (^), futures (=F), FX (=X), and dotted symbols pass through unchanged.
 */
function toYahooSymbol(symbol) {
  if (symbol == null || symbol === "") return "";
  const collapsed = String(symbol).replace(/[\s,]+/g, "").trim();
  const s = collapsed.toUpperCase();
  if (s.startsWith("^") || s.includes(".") || s.endsWith("=F") || s.endsWith("=X")) return s;
  return `${s}.NS`;
}

module.exports = { normalizeSymbol, toYahooSymbol };
