import axios from "axios";
import { normalizeApiError } from "../lib/normalizeApiError.js";
import { getAccessToken, setAccessToken, clearAccessToken } from "./accessTokenStore.js";

/** CSRF for refresh header: sessionStorage backup when API cookies are not readable (cross-origin SPA). */
const CSRF_SESSION_KEY = "auth.csrfToken";

/**
 * Backend mounts all routes under /api. Env may be origin only (http://host:port) or full base including /api.
 */
export function resolveApiBaseUrl() {
  const isLocalhostRuntime =
    typeof window !== "undefined" &&
    ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const raw =
    (isLocalhostRuntime && import.meta.env.VITE_API_BASE_URL_LOCAL) ||
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_API_URL ||
    import.meta.env.VITE_BACKEND_URL ||
    "http://localhost:5001";
  const trimmed = String(raw).replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

/** WebSocket URL for Phase A live quote stream (same host as REST /api). */
export function buildLiveQuoteWebSocketUrl(accessToken) {
  if (typeof window === "undefined" || !accessToken) return null;
  try {
    const base = resolveApiBaseUrl();
    const u = new URL(base);
    const wsProto = u.protocol === "https:" ? "wss:" : "ws:";
    const pathBase = u.pathname.replace(/\/$/, "") || "";
    const path = `${pathBase}/ws/live-quote`;
    return `${wsProto}//${u.host}${path}?token=${encodeURIComponent(accessToken)}`;
  } catch {
    return null;
  }
}

const BASE_URL = resolveApiBaseUrl();
const isDev = import.meta.env.DEV;
const TRACE_STORAGE_KEY = "api.trace.id";

const createRequestId = () =>
  (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** L-01: Stable trace id per browser tab session; request id stays unique per HTTP call. */
const getOrCreateTraceId = () => {
  if (typeof sessionStorage === "undefined") return createRequestId();
  try {
    let tid = sessionStorage.getItem(TRACE_STORAGE_KEY);
    if (!tid) {
      tid = createRequestId();
      sessionStorage.setItem(TRACE_STORAGE_KEY, tid);
    }
    return tid;
  } catch {
    return createRequestId();
  }
};

/**
 * M-05: Single in-flight refresh — all concurrent 401 handlers await the same promise
 * so refresh is not re-issued until the first completes (avoids token rotation races).
 */
let refreshInFlight = null;

const getCookieValue = (name) => {
  if (typeof document === "undefined") return null;
  const cookie = document.cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`));
  if (!cookie) return null;
  return decodeURIComponent(cookie.slice(name.length + 1));
};

export function getCsrfForRefresh() {
  if (typeof sessionStorage === "undefined") {
    return getCookieValue("csrfToken");
  }
  try {
    return sessionStorage.getItem(CSRF_SESSION_KEY) || getCookieValue("csrfToken");
  } catch {
    return getCookieValue("csrfToken");
  }
}

export function setStoredCsrfToken(t) {
  if (typeof sessionStorage === "undefined" || !t) return;
  try {
    sessionStorage.setItem(CSRF_SESSION_KEY, t);
  } catch {
    /* ignore */
  }
}

export function clearStoredCsrfToken() {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(CSRF_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

const refreshAccessToken = (csrfToken) => {
  if (!refreshInFlight) {
    refreshInFlight = axios
      .post(
        `${BASE_URL}/auth/refresh`,
        {},
        {
          withCredentials: true,
          headers: { "x-csrf-token": csrfToken },
        },
      )
      .then(({ data }) => {
        const newToken = data.token;
        setAccessToken(newToken);
        if (data.csrfToken) {
          setStoredCsrfToken(data.csrfToken);
        }
        return newToken;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
};

/** Silent refresh using HttpOnly refresh cookie + CSRF (cookie or sessionStorage). Path A bootstrap. */
export function bootstrapAccessTokenFromCookies() {
  const csrfToken = getCsrfForRefresh();
  if (!csrfToken) {
    return Promise.resolve(null);
  }
  return refreshAccessToken(csrfToken);
}

const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: {
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  },
});

// Request interceptor to add token
api.interceptors.request.use(
  (config) => {
    const requestId = createRequestId();
    const traceId = getOrCreateTraceId();
    const token = getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    config.headers["x-request-id"] = requestId;
    config.headers["x-trace-id"] = traceId;
    config.headers["Cache-Control"] = "no-cache";
    config.headers.Pragma = "no-cache";
    config.metadata = { requestId, startedAt: Date.now() };
    if (isDev) {
      console.log("[API:REQ]", {
        id: requestId,
        method: config.method?.toUpperCase(),
        url: config.url,
      });
    }
    return config;
  },
  (error) => {
    console.error("API Error", error);
    return Promise.reject(error);
  }
);

// Response interceptor to handle 401 and refresh token silently
api.interceptors.response.use(
  (response) => {
    const tid =
      response.headers?.["x-trace-id"] ||
      response.headers?.["X-Trace-Id"] ||
      response.headers?.["x-request-id"] ||
      response.config?.metadata?.requestId;
    if (response.config?.metadata) {
      response.config.metadata.traceId = tid;
    }
    if (isDev) {
      const elapsed = Date.now() - (response.config?.metadata?.startedAt || Date.now());
      console.log("[API:RES]", {
        id: tid,
        method: response.config?.method?.toUpperCase(),
        url: response.config?.url,
        status: response.status,
        latencyMs: elapsed,
        degraded: Boolean(response.data?.degraded),
      });
    }
    return response;
  },
  async (error) => {
    const originalRequest = error.config;
    const norm = normalizeApiError(error);
    error.traceId = norm.traceId;
    error.apiError = norm;
    const st = error.response?.status;
    if (typeof window !== "undefined" && st >= 400 && st !== 401) {
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
    if (isDev) {
      const elapsed = Date.now() - (originalRequest?.metadata?.startedAt || Date.now());
      console.log("[API:ERR]", {
        id: error.response?.headers?.["x-request-id"] || originalRequest?.metadata?.requestId,
        method: originalRequest?.method?.toUpperCase(),
        url: originalRequest?.url,
        status: error.response?.status,
        latencyMs: elapsed,
        message: error.message,
      });
    }

    // If error is 401 and we haven't already retried this request
    // IMPORTANT: Exclude login/register routes from automatic retry to prevent loops on bad credentials
    const url = originalRequest?.url ?? "";
    const isAuthPath = url.includes("/auth/login") || url.includes("/auth/register");

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !isAuthPath) {
      originalRequest._retry = true;

      const csrfToken = getCsrfForRefresh();
      if (!csrfToken) {
        clearAccessToken();
        clearStoredCsrfToken();
        try {
          localStorage.removeItem("user");
        } catch {
          /* ignore */
        }
        window.location.href = "/login";
        return Promise.reject(error);
      }

      try {
        const newToken = await refreshAccessToken(csrfToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (err) {
        console.error("API Error", err);
        clearAccessToken();
        clearStoredCsrfToken();
        try {
          localStorage.removeItem("user");
        } catch {
          /* ignore */
        }
        window.location.href = "/login";
        return Promise.reject(err);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
