import { useQuery } from "@tanstack/react-query";
import api from "../api/api.js";
import type { MarketSessionDTO } from "../lib/marketSessionLabels";

async function fetchMarketSession(): Promise<MarketSessionDTO | null> {
  const res = await api.get("/market/session");
  return res.data?.data ?? null;
}

/** Shared NSE session snapshot (IST). Used by strip, topbar, and home status. */
export function useMarketSession() {
  return useQuery({
    queryKey: ["market", "session"],
    queryFn: fetchMarketSession,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}

export function topbarSessionLabel(session: MarketSessionDTO | null | undefined, loading: boolean): string {
  if (loading) return "SESSION …";
  if (!session) return "SESSION —";
  return session.isMarketOpen ? "SESSION OPEN" : "AFTER HOURS";
}
