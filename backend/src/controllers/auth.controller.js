const User = require("../models/user.model");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const AppError = require("../utils/AppError");
const logger = require("../utils/logger");
const { invalidateUserCache } = require("../middlewares/auth.middleware");
const { sendSuccess } = require("../utils/response.helper");

const REFRESH_COOKIE_NAME = "refreshToken";
const CSRF_COOKIE_NAME = "csrfToken";
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || "15m";
const REFRESH_TOKEN_TTL = process.env.REFRESH_TOKEN_TTL || "7d";
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const isProd = process.env.NODE_ENV === "production";

const normalizeSameSite = (rawValue) => {
  const normalized = String(rawValue || "").trim().toLowerCase();
  if (normalized === "strict" || normalized === "lax" || normalized === "none") {
    return normalized;
  }
  return isProd ? "none" : "lax";
};

const configuredSameSite = normalizeSameSite(process.env.AUTH_COOKIE_SAMESITE);
const cookieSameSite = configuredSameSite === "none" && !isProd ? "lax" : configuredSameSite;
const cookieDomain = String(process.env.AUTH_COOKIE_DOMAIN || "").trim();
const baseCookieOptions = {
  secure: isProd,
  sameSite: cookieSameSite,
  maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  path: "/api/auth",
  ...(cookieDomain ? { domain: cookieDomain } : {}),
};

// H-07 FIX: Hash the refresh token before storing it in the DB.
// Previously the raw JWT was stored, meaning a DB read gave a full session token
// to any attacker. The raw token is returned to the client (cookie); only the
// SHA-256 hash is persisted. Validation hashes the incoming cookie and compares.
const hashToken = (rawToken) =>
  crypto.createHash("sha256").update(rawToken).digest("hex");

const generateTokens = (userId) => {
  const token = jwt.sign({ userId, tokenType: "access" }, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });
  const refreshToken = jwt.sign({ userId, tokenType: "refresh", nonce: crypto.randomUUID() }, process.env.JWT_SECRET, {
    expiresIn: REFRESH_TOKEN_TTL,
  });
  return { token, refreshToken };
};

const setRefreshCookie = (res, refreshToken) => {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...baseCookieOptions,
    httpOnly: true,
  });
};

const setCsrfCookie = (res, csrfToken) => {
  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    ...baseCookieOptions,
    httpOnly: false,
  });
};

const clearAuthCookies = (res) => {
  const cookieOptions = {
    secure: isProd,
    sameSite: cookieSameSite,
    path: "/api/auth",
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  };
  res.clearCookie(REFRESH_COOKIE_NAME, { ...cookieOptions, httpOnly: true });
  res.clearCookie(CSRF_COOKIE_NAME, { ...cookieOptions, httpOnly: false });
};

const generateCsrfToken = () => crypto.randomBytes(32).toString("hex");

const getCookieValue = (cookieHeader, name) => {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";").map((item) => item.trim());
  const target = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!target) {
    return null;
  }

  return decodeURIComponent(target.slice(name.length + 1));
};

// ================= REGISTER =================
const register = async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!email || !password) {
      return next(new AppError("Email and password are required", 400));
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return next(new AppError("User already exists", 400));
    }

    const user = await User.create({ name, email, password });
    const { token, refreshToken } = generateTokens(user._id);
    const csrfToken = generateCsrfToken();

    user.refreshToken = hashToken(refreshToken);
    await user.save();
    setRefreshCookie(res, refreshToken);
    setCsrfCookie(res, csrfToken);

    sendSuccess(res, req, {
      success: true,
      token,
      csrfToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    }, 201);
  } catch (error) {
    next(error);
  }
};

// ================= LOGIN =================
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(new AppError("Email and password are required", 400));
    }

    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return next(new AppError("Account not found. Please register to initialize your terminal.", 401));
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return next(new AppError("Invalid credentials", 401));
    }

    // Bust any stale cached user entry so the fresh session starts clean.
    invalidateUserCache(user._id).catch(() => {});

    const { token, refreshToken } = generateTokens(user._id);
    const csrfToken = generateCsrfToken();
    user.refreshToken = hashToken(refreshToken);
    await user.save();
    setRefreshCookie(res, refreshToken);
    setCsrfCookie(res, csrfToken);

    sendSuccess(res, req, {
      success: true,
      token,
      csrfToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ================= REFRESH =================
const refresh = async (req, res, next) => {
  try {
    const refreshToken = getCookieValue(req.headers.cookie, REFRESH_COOKIE_NAME);
    const csrfTokenCookie = getCookieValue(req.headers.cookie, CSRF_COOKIE_NAME);
    const csrfHeader = req.headers["x-csrf-token"];

    if (!refreshToken) {
      return next(new AppError("Refresh token is required", 401));
    }

    // M-01 FIX: Enforce CSRF in every environment unless explicitly opted out for
    // local automation (SKIP_CSRF_DEV=true). Never gate security on NODE_ENV alone.
    const skipCsrf = process.env.SKIP_CSRF_DEV === "true";
    if (!skipCsrf && (!csrfHeader || !csrfTokenCookie || csrfHeader !== csrfTokenCookie)) {
      return next(new AppError("CSRF_TOKEN_INVALID", 403));
    }
    if (skipCsrf && (!csrfHeader || !csrfTokenCookie || csrfHeader !== csrfTokenCookie)) {
      logger.warn({
        service: "auth.controller",
        step: "CSRF_SKIPPED_DEV_FLAG",
        status: "WARN",
        data: { reason: "SKIP_CSRF_DEV=true" },
        timestamp: new Date().toISOString(),
      });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    if (decoded.tokenType !== "refresh") {
      return next(new AppError("Invalid token type for refresh", 401));
    }

    // H-07 FIX: Compare the hash of the incoming token against the stored hash.
    const user = await User.findOne({
      _id: decoded.userId,
      refreshToken: hashToken(refreshToken),
    }).select("+refreshToken");

    if (!user) {
      return next(new AppError("Invalid refresh token", 401));
    }

    const tokens = generateTokens(user._id);
    const csrfToken = generateCsrfToken();
    user.refreshToken = hashToken(tokens.refreshToken);
    await user.save();
    setRefreshCookie(res, tokens.refreshToken);
    setCsrfCookie(res, csrfToken);

    sendSuccess(res, req, {
      success: true,
      token: tokens.token,
      csrfToken,
    });
  } catch (error) {
    return next(new AppError("Invalid or expired refresh token", 401));
  }
};

const logout = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select("+refreshToken");
    if (!user) {
      return next(new AppError("Not authorized, user not found", 401));
    }

    user.refreshToken = undefined;
    await user.save();

    // Invalidate auth cache so the next login fetches a fresh user document.
    invalidateUserCache(user._id).catch(() => {});

    clearAuthCookies(res);

    return sendSuccess(res, req, {
      success: true,
      message: "LOGOUT_SUCCESS",
    });
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  register,
  login,
  refresh,
  logout,
};
