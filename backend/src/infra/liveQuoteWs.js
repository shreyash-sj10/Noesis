/**
 * Phase A: authenticated WebSocket for a single subscribed symbol's live quote.
 * Uses the same getPrice() path as GET /api/market/quote (cache-backed, not per-push Yahoo).
 */
const { WebSocketServer } = require("ws");
const jwt = require("jsonwebtoken");
const { URL } = require("url");
const logger = require("../utils/logger");
const { getPrice } = require("../services/price.engine");
const { normalizeSymbol } = require("../utils/symbol.utils");

const WS_PATH = "/api/ws/live-quote";
const TICK_MS = Math.max(2000, Math.min(10_000, Number(process.env.LIVE_QUOTE_WS_TICK_MS || 3000)));

const splitCsv = (value) =>
  String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

function allowedOrigins() {
  const configured = [...splitCsv(process.env.FRONTEND_URL), ...splitCsv(process.env.FRONTEND_URLS)];
  if (configured.length) return [...new Set(configured)];
  return ["http://localhost:5173", "http://localhost:5174", "http://localhost:5180"];
}

function mapQuoteSource(source) {
  if (source === "LIVE") return "REAL";
  if (source === "REDIS" || source === "MEMORY") return "CACHE";
  if (source === "STALE") return "STALE";
  return "UNAVAILABLE";
}

function verifyAccessToken(token) {
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.tokenType !== "access" || !decoded.userId) return null;
    return { userId: String(decoded.userId) };
  } catch {
    return null;
  }
}

function isOriginAllowed(origin) {
  if (!origin) return true;
  return allowedOrigins().includes(origin);
}

/** symbol (normalized API key) -> hub */
const hubs = new Map();

function safeSend(ws, payload) {
  if (ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

async function tickSymbol(apiSymbol) {
  const hub = hubs.get(apiSymbol);
  if (!hub || hub.sockets.size === 0) return;

  let engine;
  try {
    engine = await getPrice(apiSymbol);
  } catch (e) {
    const msg = e?.message || "QUOTE_UNAVAILABLE";
    for (const ws of hub.sockets) {
      safeSend(ws, { type: "quote_error", symbol: apiSymbol, message: msg });
    }
    return;
  }

  const payload = {
    type: "quote",
    symbol: apiSymbol,
    pricePaise: engine.pricePaise,
    source: mapQuoteSource(engine.source),
    isStale: engine.source === "STALE",
    isFallback: engine.source === "STALE",
  };

  if (hub.lastPaise === engine.pricePaise && hub.lastSource === engine.source) {
    return;
  }
  hub.lastPaise = engine.pricePaise;
  hub.lastSource = engine.source;

  for (const ws of hub.sockets) {
    safeSend(ws, payload);
  }
}

function joinHub(ws, apiSymbol) {
  let hub = hubs.get(apiSymbol);
  if (!hub) {
    hub = {
      sockets: new Set(),
      timer: null,
      lastPaise: null,
      lastSource: null,
    };
    hubs.set(apiSymbol, hub);
  }
  hub.sockets.add(ws);
  if (!hub.timer) {
    hub.timer = setInterval(() => {
      void tickSymbol(apiSymbol);
    }, TICK_MS);
  }
  void tickSymbol(apiSymbol);
}

function leaveHub(ws, apiSymbol) {
  const hub = hubs.get(apiSymbol);
  if (!hub) return;
  hub.sockets.delete(ws);
  if (hub.sockets.size === 0) {
    if (hub.timer) {
      clearInterval(hub.timer);
      hub.timer = null;
    }
    hubs.delete(apiSymbol);
  }
}

function attachLiveQuoteWebSocket(httpServer) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  httpServer.on("upgrade", (req, socket, head) => {
    try {
      const host = req.headers.host || "localhost";
      const u = new URL(req.url || "", `http://${host}`);
      if (u.pathname !== WS_PATH) {
        return;
      }

      const origin = req.headers.origin;
      if (!isOriginAllowed(origin)) {
        logger.warn({ event: "LIVE_QUOTE_WS_ORIGIN_REJECT", origin });
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }

      const token = u.searchParams.get("token");
      const auth = verifyAccessToken(token);
      if (!auth) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.userId = auth.userId;
        ws.subscribedSymbol = null;
        wss.emit("connection", ws, req);
      });
    } catch (e) {
      logger.warn({ event: "LIVE_QUOTE_WS_UPGRADE_FAIL", message: e?.message });
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    }
  });

  wss.on("connection", (ws) => {
    safeSend(ws, { type: "ready", tickMs: TICK_MS });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(String(raw || ""));
      } catch {
        safeSend(ws, { type: "error", message: "INVALID_JSON" });
        return;
      }

      if (msg.type === "subscribe") {
        const sym = typeof msg.symbol === "string" ? msg.symbol.trim() : "";
        if (!sym) {
          safeSend(ws, { type: "error", message: "SYMBOL_REQUIRED" });
          return;
        }
        const apiSymbol = normalizeSymbol(sym);
        if (ws.subscribedSymbol && ws.subscribedSymbol !== apiSymbol) {
          leaveHub(ws, ws.subscribedSymbol);
        }
        ws.subscribedSymbol = apiSymbol;
        joinHub(ws, apiSymbol);
        safeSend(ws, { type: "subscribed", symbol: apiSymbol });
        return;
      }

      if (msg.type === "unsubscribe") {
        if (ws.subscribedSymbol) {
          leaveHub(ws, ws.subscribedSymbol);
          ws.subscribedSymbol = null;
        }
        safeSend(ws, { type: "unsubscribed" });
        return;
      }

      safeSend(ws, { type: "error", message: "UNKNOWN_MESSAGE" });
    });

    ws.on("close", () => {
      if (ws.subscribedSymbol) {
        leaveHub(ws, ws.subscribedSymbol);
        ws.subscribedSymbol = null;
      }
    });
  });

  logger.info({
    service: "liveQuoteWs",
    step: "ATTACHED",
    status: "SUCCESS",
    data: { path: WS_PATH, tickMs: TICK_MS },
    timestamp: new Date().toISOString(),
  });
}

module.exports = { attachLiveQuoteWebSocket, WS_PATH };
