const PQueue = require("p-queue").default;
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
const AppError = require('../utils/AppError');
const { SYSTEM_CONFIG } = require("../config/system.config");
const { getQuoteCache, setQuoteCache } = require("../utils/marketQuoteCache");
const { normalizeSymbol } = require("../utils/symbol.utils");
const { resolveSectorBenchmark } = require("../constants/sectorBenchmark.map");
const logger = require("../utils/logger");

const { toPaise, enforcePaise} = require('../utils/paise');

/**
 * Throttle single-symbol Yahoo fetches (trade validation, resolvePrice, etc.).
 * Market explorer uses batched `yahooFinance.quote` in `getBulkSnapshots` without this queue
 * so the scanner is not serialized to one HTTP call every 12s.
 */
const externalQuoteQueue = new PQueue({
  concurrency: 1,
  intervalCap: 1,
  interval: 12000,
});

const symbolHash = (symbol = "") => {
  let h = 0;
  for (let i = 0; i < symbol.length; i += 1) {
    h = ((h << 5) - h) + symbol.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
};

const buildSyntheticQuote = (symbol, index = 0) => {
  const baseSymbol = (symbol || "").replace(".NS", "").replace(".BO", "");
  const h = symbolHash(baseSymbol);
  const rupeePrice = 150 + (h % 4200);
  const changePercent = Number((((h % 1200) - 600) / 100).toFixed(2));

  return {
    symbol: baseSymbol,
    fullSymbol: symbol,
    pricePaise: toPaise(rupeePrice),
    changePercent,
    volume: 500000 + ((h + index * 97) % 25000000),
    marketCap: 30000000000 + ((h % 200000) * 1000000),
    peRatio: Number((8 + (h % 3200) / 100).toFixed(1)),
    trend: changePercent > 1 ? "BULLISH" : changePercent < -1 ? "BEARISH" : "SIDEWAYS",
    lastUpdate: new Date(),
    source: "FALLBACK",
    isSynthetic: true,
    isFallback: true,
  };
};

/**
 * 1. UNIFIED SCHEMA MAPPING
 */
const normalizeQuote = (raw) => {
  if (!raw) return null;

  // 1. CURRENCY VALIDATION (Hard Layer)
  // Only allow INR assets to prevent valuation distortion (USD vs INR)
  if (raw.currency && raw.currency !== 'INR') {
    logger.warn({
      event: "MARKET_DATA_CURRENCY_REJECT",
      symbol: raw.symbol,
      currency: raw.currency,
    });
    return null;
  }

  if (!raw.regularMarketPrice) {
    throw new Error(`MISSING_REQUIRED_FIELD:regularMarketPrice:${raw.symbol || "UNKNOWN_SYMBOL"}`);
  }

  // Support both Yahoo and generic formats
  return {
    symbol: (raw.symbol || "").split('.')[0],
    fullSymbol: raw.symbol,
    pricePaise: enforcePaise(toPaise(raw.regularMarketPrice), "pricePaise"),
    changePercent: raw.regularMarketChangePercent || raw.changePercent || 0,
    volume: raw.regularMarketVolume || raw.volume || 0,
    marketCap: raw.marketCap || null,
    peRatio: raw.trailingPE || raw.peRatio || null,
    lastUpdate: raw.regularMarketTime || new Date(),
    source: "REAL",
    isSynthetic: false,
    isFallback: false,
  };
};

/**
 * 2. DATA INTEGRITY VALIDATION
 */
const validateQuote = (quote) => {
  if (!quote || !quote.symbol) return false;
  // Reject non-integers (Floating point leakage detected)
  if (!Number.isInteger(quote.pricePaise)) return false;
  // Reject absurdly low prices
  if (quote.pricePaise <= 100) return false;
  if (!quote.lastUpdate) return false;
  return true;
};

const getStockSnapshot = async (symbol) => {
  const apiSymbol = normalizeSymbol(symbol);

  const cached = await getQuoteCache(apiSymbol);
  if (cached?.tier === "HOT") {
    return cached.data;
  }

  try {
    const raw = await externalQuoteQueue.add(() => yahooFinance.quote(apiSymbol));
    const quote = normalizeQuote(raw);

    if (!validateQuote(quote)) {
      throw new Error(`CRITICAL_DATA_INTEGRITY_VIOLATION: ${apiSymbol}`);
    }

    // Deterministic Trend Logic
    quote.trend = quote.changePercent > 1 ? "BULLISH" : quote.changePercent < -1 ? "BEARISH" : "SIDEWAYS";

    await setQuoteCache(apiSymbol, quote);

    return quote;
  } catch (error) {
    logger.error({
      event: "MARKET_DATA_SNAPSHOT_FETCH_ERROR",
      symbol: apiSymbol,
      message: error.message,
    });
    throw new AppError("MARKET_DATA_UNAVAILABLE", 503);
  }
};

const resolvePrice = async (symbol) => {
  const apiSymbol = normalizeSymbol(symbol);
  const cached = await getQuoteCache(apiSymbol);
  const hasCachedQuote = Boolean(
    cached?.data &&
    Number.isInteger(cached.data.pricePaise) &&
    cached.data.pricePaise > 100
  );
  if (cached?.tier === "HOT" && hasCachedQuote) {
    return {
      pricePaise: cached.data.pricePaise,
      changePercent: Number(cached.data.changePercent) || 0,
      source: "CACHE",
      isFallback: Boolean(cached.data.isFallback),
      isStale: false,
    };
  }

  try {
    const quote = await getStockSnapshot(symbol);
    return {
      pricePaise: quote.pricePaise,
      changePercent: Number(quote.changePercent) || 0,
      source: quote.isFallback ? "FALLBACK" : "REAL",
      isFallback: Boolean(quote.isFallback),
      isStale: false,
    };
  } catch (error) {
    if (hasCachedQuote && (cached?.tier === "STALE" || cached?.tier === "HOT")) {
      return {
        pricePaise: cached.data.pricePaise,
        changePercent: Number(cached.data.changePercent) || 0,
        source: "STALE",
        isFallback: true,
        isStale: true,
      };
    }

    if (error instanceof AppError) throw error;
    throw new AppError("MARKET_DATA_UNAVAILABLE", 503);
  }
};

const quoteFromCacheEntry = (cached) => {
  const hasCachedQuote = Boolean(
    cached?.data &&
    Number.isInteger(cached.data.pricePaise) &&
    cached.data.pricePaise > 100,
  );
  if (!hasCachedQuote) return null;
  const isStale = cached.tier === "STALE";
  return {
    pricePaise: cached.data.pricePaise,
    changePercent: Number(cached.data.changePercent) || 0,
    source: isStale ? "STALE" : "CACHE",
    isFallback: Boolean(cached.data.isFallback) || isStale,
    isStale,
  };
};

const PORTFOLIO_QUOTE_BUDGET_MS = 2500;

const resolvePriceForPortfolio = async (symbol) => {
  const apiSymbol = normalizeSymbol(symbol);
  const cached = await getQuoteCache(apiSymbol);
  const fromCache = quoteFromCacheEntry(cached);
  if (fromCache && cached?.tier === "HOT") return fromCache;

  try {
    const resolved = await Promise.race([
      resolvePrice(symbol),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("PORTFOLIO_QUOTE_TIMEOUT")), PORTFOLIO_QUOTE_BUDGET_MS);
      }),
    ]);
    return resolved;
  } catch {
    return fromCache || null;
  }
};

const resolvePrices = async (symbols = []) => {
  if (!symbols.length) return {};
  const pairs = await Promise.all(symbols.map(async (symbol) => {
    const resolved = await resolvePrice(symbol);
    const normalized = normalizeSymbol(symbol);
    return [normalized, resolved];
  }));

  const map = {};
  pairs.forEach(([normalized, resolved]) => {
    const base = (normalized || "").split(".")[0];
    if (base) map[base] = resolved;
    if (normalized) map[normalized] = resolved;
  });
  return map;
};

/** Portfolio HTTP path: cache-first, bounded wait — never block UI on Yahoo. */
const resolvePricesForPortfolio = async (symbols = []) => {
  if (!symbols.length) return {};
  const pairs = await Promise.all(
    symbols.map(async (symbol) => {
      const resolved = await resolvePriceForPortfolio(symbol);
      const normalized = normalizeSymbol(symbol);
      return [normalized, resolved];
    }),
  );

  const map = {};
  pairs.forEach(([normalized, resolved]) => {
    if (!resolved) return;
    const base = (normalized || "").split(".")[0];
    if (base) map[base] = resolved;
    if (normalized) map[normalized] = resolved;
  });
  return map;
};

/**
 * 4. BATCH FETCHING (O(1) per batch)
 */
const getBulkSnapshots = async (symbols = []) => {
  if (!symbols.length) return [];

  // Chunking to prevent URI too long or rate limits (25 per batch)
  const CHUNK_SIZE = SYSTEM_CONFIG.marketData.batchChunkSize;
  const chunks = [];
  for (let i = 0; i < symbols.length; i += CHUNK_SIZE) {
    chunks.push(symbols.slice(i, i + CHUNK_SIZE));
  }

  // Fetch all chunks in parallel for maximum speed
  const chunkPromises = chunks.map(async (chunk) => {
    const apiSymbols = chunk.map(s => normalizeSymbol(s));
    try {
      const rawQuotes = await yahooFinance.quote(apiSymbols);
      const quotesArray = Array.isArray(rawQuotes) ? rawQuotes : [rawQuotes];
      
      return quotesArray
        .filter(q => q)
        .map(q => {
          const normalized = normalizeQuote(q);
          if (validateQuote(normalized)) {
            normalized.trend = normalized.changePercent > 1 ? "BULLISH" : normalized.changePercent < -1 ? "BEARISH" : "SIDEWAYS";
            void setQuoteCache(normalizeSymbol(normalized.symbol), normalized);
            return normalized;
          }
          return null;
        })
        .filter(q => q);
    } catch (error) {
      if (String(error?.message || "").includes("MISSING_REQUIRED_FIELD:regularMarketPrice")) {
        throw error;
      }
      logger.error({
        event: "MARKET_DATA_CHUNK_FETCH_FAILED",
        symbols: apiSymbols.join(","),
        message: error.message,
      });
      // Fallback for individual symbols in this chunk
      const individualResults = await Promise.all(chunk.map(async (s) => {
        try {
          const single = await getStockSnapshot(s);
          return single;
        } catch (e) {
          if (String(e?.message || "").includes("MISSING_REQUIRED_FIELD:regularMarketPrice")) {
            throw e;
          }
          return null;
        }
      }));
      return individualResults.filter(r => r);
    }
  });

  const allResults = await Promise.all(chunkPromises);
  return allResults.flat();
};

/**
 * Market-cap segment (INR marketCap from quotes). Thresholds are order-of-magnitude for NSE large/mid/small.
 */
const matchesExploreSegment = (stock, segment) => {
  const s = String(segment || "all").toLowerCase();
  if (!s || s === "all") return true;
  const mc = stock?.marketCap;
  if (mc == null || !Number.isFinite(mc)) return s === "small";
  const largeMin = 2e11;
  const midMin = 5e10;
  if (s === "large") return mc >= largeMin;
  if (s === "mid") return mc >= midMin && mc < largeMin;
  if (s === "small") return mc < midMin;
  return true;
};

/**
 * FETCH EXPLORE DATA (NIFTY 500 SCALING)
 * Oversamples the symbol pool until `limit` valid quotes match segment (fixes short pages / ~49 rows).
 */
const getExploreData = async (limit = 64, offset = 0, search = "", segment = "all") => {
  const { NIFTY_500 } = require('../constants/nifty500');
  const MASTER_POOL = NIFTY_500;

  let symbols = MASTER_POOL;
  if (search) {
    const q = search.toUpperCase();
    symbols = MASTER_POOL.filter((s) => s.includes(q));
  }

  const BATCH = 28;
  const MAX_SCAN = 900;
  const collected = [];
  let scanIdx = offset;
  let scanned = 0;

  while (collected.length < limit && scanIdx < symbols.length && scanned < MAX_SCAN) {
    const slice = symbols.slice(scanIdx, scanIdx + BATCH);
    scanIdx += slice.length;
    scanned += slice.length;
    if (!slice.length) break;

    const batch = await getBulkSnapshots(slice);
    for (const st of batch) {
      if (matchesExploreSegment(st, segment)) {
        collected.push(st);
        if (collected.length >= limit) break;
      }
    }
  }

  const poolEnd = scanIdx;
  const hasMore = poolEnd < symbols.length;

  if (collected.length === 0) {
    const seed = symbols.slice(offset, offset + Math.min(limit, BATCH));
    if (!search && offset === 0) {
      logger.warn({
        event: "MARKET_EXPLORER_SYNTHETIC_FALLBACK",
        message: "Live provider unavailable, serving deterministic synthetic universe.",
      });
    }
    const stocks = seed.map((s, idx) => buildSyntheticQuote(normalizeSymbol(s), idx))
      .filter((st) => matchesExploreSegment(st, segment))
      .slice(0, limit);
    return {
      stocks: stocks.length ? stocks : seed.map((s, idx) => buildSyntheticQuote(normalizeSymbol(s), idx)).slice(0, limit),
      meta: {
        isSynthetic: true,
        isFallback: true,
        poolEnd: Math.min(poolEnd, symbols.length),
        hasMore: false,
      },
    };
  }

  return {
    stocks: collected,
    meta: {
      isSynthetic: collected.some((item) => item.isSynthetic === true),
      isFallback: collected.some((item) => item.isFallback === true),
      poolEnd,
      hasMore,
    },
  };
};

/**
 * GET LIVE QUOTE (Detailed)
 */
const getLivePrice = async (symbol) => {
  return await resolvePrice(symbol);
};

/**
 * GET HISTORICAL DATA
 */
const getHistorical = async (symbol, period = "1mo") => {
  const apiSymbol = normalizeSymbol(symbol);
  try {
    const periodMap = {
      '1d': 1,
      '5d': 5,
      '1mo': 30,
      '3mo': 90,
      '6mo': 180,
      '1y': 365
    };

    const days = periodMap[period] || 30;
    const period1 = new Date();
    period1.setDate(period1.getDate() - days);

    // Using .chart() as .historical() is deprecated and restricted
    const result = await yahooFinance.chart(apiSymbol, {
      period1: period1,
      period2: new Date(),
      interval: '1d'
    });

    if (!result || !result.quotes) {
      return { success: true, data: { prices: [], source: "Yahoo (Empty)" } };
    }

    // Filter, Normalize, and Sort OHLC
    const prices = result.quotes
      .filter(q => q.open && q.high && q.low && q.close && q.date)
      .map(q => ({
        date: q.date instanceof Date ? q.date.toISOString().split('T')[0] : q.date,
        timestamp: q.date instanceof Date ? q.date.getTime() : new Date(q.date).getTime(),
        openPaise: toPaise(q.open),
        highPaise: toPaise(q.high),
        lowPaise: toPaise(q.low),
        closePaise: toPaise(q.close),
        volume: q.volume || 0
      }))
      .sort((a, b) => a.timestamp - b.timestamp);

    return {
      prices,
      source: "Yahoo Chart API",
      isSynthetic: false,
      isFallback: false,
    };
  } catch (error) {
    logger.error({
      event: "MARKET_DATA_HISTORY_FAILED",
      symbol: apiSymbol,
      message: error.message,
    });
    // Graceful Degradation: Return empty state instead of crashing
    return {
      prices: [],
      source: "Fallback Cache",
      isSynthetic: false,
      isFallback: true,
    };
  }
};

/**
 * GET FUNDAMENTALS (+ sector + sector benchmark session % for relative performance)
 */
const getFundamentals = async (symbol) => {
  const apiSymbol = normalizeSymbol(symbol);
  try {
    const result = await yahooFinance.quoteSummary(apiSymbol, {
      modules: ["summaryDetail", "defaultKeyStatistics", "financialData", "summaryProfile"],
    });
    if (!result || typeof result !== "object") return null;

    const sectorRaw = result.summaryProfile?.sector;
    const sector = typeof sectorRaw === "string" && sectorRaw.trim() ? sectorRaw.trim() : null;
    const bench = sector ? resolveSectorBenchmark(sector) : null;

    let sectorChangePercent = null;
    let benchmarkSymbol = null;
    let benchmarkLabel = null;
    if (bench?.symbol) {
      benchmarkSymbol = bench.symbol;
      benchmarkLabel = bench.label;
      try {
        const q = await yahooFinance.quote(bench.symbol);
        const p = q?.regularMarketChangePercent;
        sectorChangePercent = typeof p === "number" && Number.isFinite(p) ? p : null;
      } catch (e) {
        logger.warn({
          event: "SECTOR_BENCHMARK_QUOTE_FAILED",
          symbol: bench.symbol,
          message: e?.message || String(e),
        });
        sectorChangePercent = null;
      }
    }

    return {
      ...result,
      sectorContext: {
        sector,
        sectorChangePercent,
        benchmarkSymbol,
        benchmarkLabel,
      },
    };
  } catch (error) {
    return null;
  }
};

/**
 * VALIDATE SYMBOL
 */
const validateSymbol = async (symbol) => {
  if (!symbol) return { isValid: false };
  try {
    const quote = await resolvePrice(symbol);
    const isValid = typeof quote?.pricePaise === "number" && quote.pricePaise > 100;
    return {
      isValid,
      symbol: normalizeSymbol(symbol)?.split(".")[0],
      data: isValid ? quote : null,
      source: quote?.source || "FALLBACK",
      isSynthetic: false,
      isFallback: Boolean(quote?.isFallback),
    };
  } catch {
    return { isValid: false };
  }
};

/**
 * GET MARKET INDICES
 */
const getMarketIndices = async () => {
  const indices = ['^NSEI', '^BSESN', '^NSEBANK'];
  try {
    const quotes = await yahooFinance.quote(indices);
    return quotes.map(q => ({
      symbol: q.symbol === '^NSEI' ? 'NIFTY 50' : q.symbol === '^BSESN' ? 'SENSEX' : 'BANK NIFTY',
      pricePaise: toPaise(q.regularMarketPrice),
      changePaise: toPaise(q.regularMarketChange),
      changePercent: q.regularMarketChangePercent,
      currency: 'INR',
      source: "REAL",
      isSynthetic: false,
      isFallback: false,
    }));
  } catch (error) {
    logger.error({
      event: "MARKET_INDICES_FETCH_FAILED",
      message: error.message,
    });
    return [];
  }
};

/**
 * GET FULL TICKER DATA (Indian indices + global commodities/indices)
 * Bypasses the INR currency filter — raw Yahoo batch call, same pattern as getMarketIndices.
 */
const TICKER_SYMBOLS = ['^NSEI', '^BSESN', '^NSEBANK', 'GC=F', 'SI=F', 'CL=F', '^IXIC'];
const TICKER_LABELS  = {
  '^NSEI':   'NIFTY 50',
  '^BSESN':  'SENSEX',
  '^NSEBANK':'BANK NIFTY',
  'GC=F':    'GOLD',
  'SI=F':    'SILVER',
  'CL=F':    'OIL (WTI)',
  '^IXIC':   'NASDAQ',
};

const getTickerData = async () => {
  try {
    const raw = await yahooFinance.quote(TICKER_SYMBOLS);
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr
      .filter(q => q && q.regularMarketPrice != null)
      .map(q => ({
        symbol:        q.symbol,
        label:         TICKER_LABELS[q.symbol] || q.symbol,
        price:         q.regularMarketPrice,
        changePercent: q.regularMarketChangePercent || 0,
        currency:      q.currency || 'USD',
        source:        'REAL',
        isFallback:    false,
      }));
  } catch (error) {
    logger.error({
      event: "MARKET_TICKER_FETCH_FAILED",
      message: error.message,
    });
    // Deterministic synthetic fallback so the UI never shows empty
    return TICKER_SYMBOLS.map((sym) => ({
      symbol:        sym,
      label:         TICKER_LABELS[sym] || sym,
      price:         0,
      changePercent: 0,
      currency:      sym.startsWith('^NSE') || sym === '^BSESN' ? 'INR' : 'USD',
      source:        'FALLBACK',
      isFallback:    true,
    }));
  }
};

/**
 * GET LIVE PRICES (Bulk)
 */
const getLivePrices = async (symbols = []) => {
  return await resolvePrices(symbols);
};

const getLivePricesForPortfolio = async (symbols = []) => {
  return await resolvePricesForPortfolio(symbols);
};

module.exports = {
  resolvePrice,
  resolvePrices,
  resolvePricesForPortfolio,
  getStockSnapshot,
  getExploreData,
  getLivePrice,
  getLivePrices,
  getLivePricesForPortfolio,
  getHistorical,
  getFundamentals,
  validateSymbol,
  getMarketIndices,
  getTickerData,
};
