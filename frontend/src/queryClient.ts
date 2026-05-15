import { QueryClient } from "@tanstack/react-query";
import { normalizeApiError } from "./v2/lib/normalizeApiError.js";

function emitGlobalApiError(error: unknown) {
  if (typeof window === "undefined") return;
  const norm = normalizeApiError(error);
  window.dispatchEvent(
    new CustomEvent("app:api-error", {
      detail: {
        message: norm.message,
        traceId: norm.traceId,
        retryable: norm.retryable,
        status: norm.status,
      },
    })
  );
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
    mutations: {
      onError: (err) => emitGlobalApiError(err),
    },
  },
});
