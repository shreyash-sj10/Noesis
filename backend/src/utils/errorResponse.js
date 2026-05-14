/**
 * Maps HTTP status / message to retryable hint (additive contract).
 */
const inferRetryable = (statusCode, message = "") => {
  if ([503, 429, 408, 502, 504].includes(statusCode)) return true;
  if (statusCode === 409) return true;
  const m = String(message);
  if (m.includes("MARKET_DATA_UNAVAILABLE")) return true;
  if (m.includes("EXECUTION_IN_PROGRESS")) return true;
  return false;
};

const deriveErrorCode = (err, statusCode) => {
  if (err?.code && typeof err.code === "string") return err.code;
  const msg = String(err?.message || "");
  if (/^[A-Z][A-Z0-9_]+$/.test(msg) && msg.length < 80) return msg;
  if (statusCode >= 500) return "INTERNAL_ERROR";
  return "REQUEST_ERROR";
};

module.exports = { inferRetryable, deriveErrorCode };
