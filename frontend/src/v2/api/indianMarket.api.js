import api from "./api";
import { normalizeResponse } from "../contracts/contract.js";

// ─── Symbol Normalisation ─────────────────────────────────────────────────────
// Our backend handles the .NS/.BO suffixes natively.
const toApiSymbol = (symbol) => {
  if (!symbol) return symbol;
  const s = symbol.toUpperCase();
  if (s.endsWith(".NS") || s.endsWith(".BO")) return s;
  return s; // The backend service will add .NS if it's missing
};

// ─── Single Stock Full Detail ─────────────────────────────────────────────────
/** Backend canonical quote: integer `pricePaise` (100 paise = ₹1). */
export const getIndianStockDetail = async (symbol) => {
  try {
    const sym = toApiSymbol(symbol);
    const res = await api.get("/market/validate", { params: { symbol: sym } });
    return normalizeResponse(res);
  } catch (error) {
    console.error(`[Frontend API] Detail fetch failed for ${symbol}:`, error.message);
    return null;
  }
};

// ─── Single Stock Price Only ──────────────────────────────────────────────────
/** Integer paise only — never fall back to ambiguous `last_price` fields (often rupees). */
export const getIndianStockPrice = async (symbol) => {
  const detail = await getIndianStockDetail(symbol);
  const quote = detail?.data;
  const p = quote && typeof quote.pricePaise === "number" ? quote.pricePaise : null;
  if (p == null || !Number.isFinite(p)) return null;
  return Math.round(p);
};

// ─── Batch Fetch ─────────────────────────────────────────────────────────────
/** Same paise contract as `/market/validate`; chunked to avoid rate-limit bursts. */
const BATCH_CONCURRENCY = 6;

export const getIndianStockBatch = async (symbols) => {
  if (!symbols || symbols.length === 0) return {};

  try {
    const unique = [...new Set(symbols.map(toApiSymbol))];
    const out = {};
    for (let i = 0; i < unique.length; i += BATCH_CONCURRENCY) {
      const slice = unique.slice(i, i + BATCH_CONCURRENCY);
      const pairs = await Promise.all(
        slice.map(async (sym) => {
          const paise = await getIndianStockPrice(sym);
          return [sym, paise != null ? { pricePaise: paise } : null];
        }),
      );
      for (const [sym, row] of pairs) {
        if (row) out[sym] = row;
      }
    }
    return out;
  } catch (error) {
    console.error("[Frontend API] Batch fetch failed:", error.message);
    return {};
  }
};

// ─── Search Stocks ────────────────────────────────────────────────────────────
/** Uses `/market/explore` (Nifty-500 filter) — there is no `/market/search` route on this API. */
export const searchIndianStocks = async (query) => {
  const q = String(query || "").trim();
  if (!q) return [];
  try {
    const res = await api.get("/market/explore", {
      params: { limit: 24, offset: 0, query: q },
    });
    const body = normalizeResponse(res);
    const stocks = body?.stocks;
    return Array.isArray(stocks) ? stocks : [];
  } catch (error) {
    console.error("[Frontend API] Search failed:", error.message);
    return [];
  }
};
