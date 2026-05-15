#!/usr/bin/env node
/**
 * Deploy gate: required env vars present (no secret values printed).
 * Usage: node scripts/verify-env.js
 * Exit 0 = OK, 1 = missing required.
 */
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const required = ["MONGO_URI", "JWT_SECRET"];
const useRedis = String(process.env.USE_REDIS || "").toLowerCase() === "true";

if (useRedis) {
  required.push("UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN");
}

const missing = required.filter((k) => !process.env[k] || String(process.env[k]).trim() === "");

if (missing.length) {
  console.error(`[verify-env] Missing required: ${missing.join(", ")}`);
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  if (!process.env.FRONTEND_URL || String(process.env.FRONTEND_URL).includes("localhost")) {
    console.warn(
      "[verify-env] WARN: FRONTEND_URL should be your real HTTPS origin in production (CORS / cookies)."
    );
  }
  if (String(process.env.FRONTEND_URL || "").startsWith("http://")) {
    console.warn("[verify-env] WARN: FRONTEND_URL should use HTTPS in production.");
  }
  if (String(process.env.FRONTEND_URLS || "").includes("http://")) {
    console.warn("[verify-env] WARN: FRONTEND_URLS should contain HTTPS origins in production.");
  }
  if (String(process.env.ALLOW_CLOSED_MARKET_EXECUTION || "").toLowerCase() === "true") {
    console.error(
      "[verify-env] BLOCK: ALLOW_CLOSED_MARKET_EXECUTION=true is not allowed in production."
    );
    process.exit(1);
  }
  if (String(process.env.SKIP_CSRF_DEV || "").toLowerCase() === "true") {
    console.error("[verify-env] BLOCK: SKIP_CSRF_DEV=true is not allowed in production.");
    process.exit(1);
  }
  if (!useRedis) {
    console.warn(
      "[verify-env] WARN: USE_REDIS=false enables degraded mode. Set USE_REDIS=true for production resilience."
    );
  }

  const sameSite = String(process.env.AUTH_COOKIE_SAMESITE || "").toLowerCase();
  if (sameSite && !["strict", "lax", "none"].includes(sameSite)) {
    console.error(
      "[verify-env] BLOCK: AUTH_COOKIE_SAMESITE must be one of strict|lax|none."
    );
    process.exit(1);
  }
  if (sameSite === "strict") {
    console.warn(
      "[verify-env] WARN: AUTH_COOKIE_SAMESITE=strict can break refresh on cross-origin frontend/API deployments."
    );
  }
  if (sameSite === "none") {
    console.warn(
      "[verify-env] INFO: AUTH_COOKIE_SAMESITE=none requires HTTPS and Secure cookies in production."
    );
  }
}

console.log("[verify-env] Required variables present.");
process.exit(0);
