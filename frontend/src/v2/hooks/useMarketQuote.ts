import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import api, { buildLiveQuoteWebSocketUrl } from "../api/api.js";
import { getAccessToken } from "../api/accessTokenStore.js";

export interface LiveQuote {
  pricePaise: number;
  source: string;
  isFallback: boolean;
  isStale: boolean;
}

function quoteQueryKey(symbol: string | null) {
  return ["market", "quote", symbol] as const;
}

async function fetchQuote(symbol: string): Promise<LiveQuote | null> {
  if (!symbol) return null;
  const res = await api.get(`/market/quote?symbol=${encodeURIComponent(symbol)}`);
  return res.data?.data ?? null;
}

/**
 * Live price for a single symbol (trade panel).
 * Phase A: optional WebSocket push on the same payload shape as GET /market/quote;
 * falls back to 30s HTTP polling when WS is unavailable or unauthenticated.
 */
export function useMarketQuote(symbol: string | null) {
  const [streamActive, setStreamActive] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!symbol || typeof window === "undefined") {
      setStreamActive(false);
      return;
    }

    const token = getAccessToken();
    const url = buildLiveQuoteWebSocketUrl(token || "");
    if (!url || !token) {
      setStreamActive(false);
      return;
    }

    let cancelled = false;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    const bumpHttp = () => {
      void qc.invalidateQueries({ queryKey: quoteQueryKey(symbol) });
    };

    ws.onopen = () => {
      if (cancelled) return;
      try {
        ws.send(JSON.stringify({ type: "subscribe", symbol }));
      } catch {
        setStreamActive(false);
      }
    };

    ws.onmessage = (ev) => {
      if (cancelled) return;
      try {
        const msg = JSON.parse(String(ev.data || "{}"));
        if (msg.type === "quote" && typeof msg.pricePaise === "number") {
          const next: LiveQuote = {
            pricePaise: msg.pricePaise,
            source: String(msg.source || "CACHE"),
            isFallback: Boolean(msg.isFallback),
            isStale: Boolean(msg.isStale),
          };
          qc.setQueryData(quoteQueryKey(symbol), next);
          setStreamActive(true);
        }
        if (msg.type === "subscribed") {
          setStreamActive(true);
        }
        if (msg.type === "quote_error" || msg.type === "error") {
          setStreamActive(false);
          void bumpHttp();
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    ws.onerror = () => {
      setStreamActive(false);
      void bumpHttp();
    };

    ws.onclose = () => {
      setStreamActive(false);
      if (wsRef.current === ws) wsRef.current = null;
    };

    return () => {
      cancelled = true;
      setStreamActive(false);
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "unsubscribe" }));
        }
      } catch {
        /* ignore */
      }
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [symbol, qc]);

  const { data, isLoading } = useQuery<LiveQuote | null>({
    queryKey: quoteQueryKey(symbol),
    queryFn: () => fetchQuote(symbol!),
    enabled: Boolean(symbol),
    staleTime: 15_000,
    refetchInterval: streamActive ? false : 30_000,
    retry: 1,
  });

  return { quote: data ?? null, isLoading, isStreaming: streamActive };
}
