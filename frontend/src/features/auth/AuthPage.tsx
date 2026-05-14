import { useState, useEffect, useCallback, type ChangeEvent, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "./useAuth.jsx";
import { loginUser, registerUser } from "../../v2/api/auth.api.js";
import { ROUTES } from "../../v2/routing/routes";

type FormState = {
  name: string;
  email: string;
  password: string;
  experienceLevel: string;
};

function getAuthErrorMessage(err: unknown, isLoginMode: boolean): string {
  const e = err as {
    response?: {
      status?: number;
      data?: { message?: string; errors?: Array<{ message?: string }> };
    };
  };
  if (!e.response) {
    return "Unable to authenticate";
  }
  const errors = e.response?.data?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const joined = errors
      .map((x) => x.message)
      .filter((m): m is string => typeof m === "string" && m.length > 0)
      .join(". ");
    if (joined) return joined;
  }
  const status = e.response?.status;
  if (isLoginMode) {
    if (status === 401 || status === 403 || status === 400) {
      return "Invalid credentials";
    }
    return "Unable to authenticate";
  }
  const msg = e.response?.data?.message;
  if (typeof msg === "string" && msg.trim()) {
    return msg.trim();
  }
  return "Unable to authenticate";
}

const labelClass =
  "mb-1.5 block text-[length:var(--text-2xs)] font-semibold uppercase tracking-[var(--tracking-wider)] text-[var(--v2-text-muted)]";

const inputClass =
  "w-full rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--v2-border-subtle)_75%,transparent)] bg-[color-mix(in_srgb,var(--v2-bg-base)_82%,black_18%)] px-3.5 py-2.5 text-[length:var(--text-sm)] text-[var(--v2-text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] outline-none transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-[var(--v2-text-muted)] focus:border-[color-mix(in_srgb,var(--v2-accent-primary)_45%,transparent)] focus:bg-[color-mix(in_srgb,var(--v2-bg-base)_70%,var(--v2-bg-card)_30%)] focus:shadow-[0_0_0_1px_color-mix(in_srgb,var(--v2-accent-primary)_40%,transparent),0_0_0_3px_color-mix(in_srgb,var(--v2-accent-primary)_12%,transparent),0_0_24px_-6px_color-mix(in_srgb,var(--v2-accent-primary)_55%,transparent)]";

function AuthSystemBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {/* Soft radial depth — restrained, system-grade */}
      <div
        className="absolute -left-[18%] top-0 h-full w-[72%] opacity-[0.22] max-md:opacity-[0.12]"
        style={{
          background:
            "radial-gradient(ellipse 68% 58% at 28% 32%, color-mix(in srgb, var(--v2-accent-primary) 11%, transparent) 0%, transparent 58%)",
        }}
      />
      <div
        className="absolute bottom-0 right-0 h-[78%] w-[52%] opacity-[0.14] max-md:opacity-[0.08]"
        style={{
          background:
            "radial-gradient(ellipse 60% 48% at 78% 72%, color-mix(in srgb, var(--v2-accent-primary) 7%, transparent) 0%, transparent 55%)",
        }}
      />
      {/* Grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.07] max-md:hidden"
        style={{
          backgroundImage: `
            linear-gradient(color-mix(in srgb, var(--v2-text-primary) 14%, transparent) 1px, transparent 1px),
            linear-gradient(90deg, color-mix(in srgb, var(--v2-text-primary) 14%, transparent) 1px, transparent 1px)
          `,
          backgroundSize: "40px 40px",
        }}
      />
      {/* Faint candlesticks (8–12% opacity band) */}
      <svg
        className="absolute bottom-[6%] left-[4%] h-[46%] w-[92%] opacity-[0.105] max-md:hidden"
        viewBox="0 0 400 120"
        preserveAspectRatio="xMidYMax meet"
        aria-hidden
      >
        {[
          { x: 24, o: 72, h: 38, l: 88, c: 48 },
          { x: 52, o: 48, h: 52, l: 96, c: 72 },
          { x: 80, o: 72, h: 44, l: 82, c: 58 },
          { x: 108, o: 58, h: 62, l: 70, c: 44 },
          { x: 136, o: 44, h: 48, l: 76, c: 68 },
          { x: 164, o: 68, h: 36, l: 88, c: 52 },
          { x: 192, o: 52, h: 58, l: 64, c: 40 },
          { x: 220, o: 40, h: 68, l: 52, c: 76 },
          { x: 248, o: 76, h: 42, l: 90, c: 60 },
          { x: 276, o: 60, h: 54, l: 72, c: 46 },
          { x: 304, o: 46, h: 64, l: 58, c: 70 },
          { x: 332, o: 70, h: 40, l: 84, c: 54 },
          { x: 360, o: 54, h: 56, l: 66, c: 62 },
        ].map((c, i) => {
          const top = Math.min(c.o, c.c);
          const bot = Math.max(c.o, c.c);
          const bodyH = Math.max(bot - top, 2);
          return (
            <g key={i}>
              <line x1={c.x} y1={c.h} x2={c.x} y2={c.l} stroke="var(--v2-accent-primary)" strokeWidth="1" opacity="0.85" />
              <rect
                x={c.x - 5}
                y={top}
                width="10"
                height={bodyH}
                fill={c.c >= c.o ? "color-mix(in srgb, var(--v2-state-success) 55%, transparent)" : "color-mix(in srgb, var(--v2-state-error) 45%, transparent)"}
                stroke="color-mix(in srgb, var(--v2-text-primary) 15%, transparent)"
                strokeWidth="0.5"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function scoreMeter(score: number, segments = 10): string {
  const filled = Math.min(segments, Math.max(0, Math.round((score / 100) * segments)));
  return `${"█".repeat(filled)}${"░".repeat(segments - filled)}`;
}

const SUBMIT_STAGE_MESSAGES = [
  "Checking system state…",
  "Validating session…",
  "Syncing portfolio context…",
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function SimulationHeaderRibbon() {
  return (
    <div
      className="relative z-[3] shrink-0 border-b border-[color-mix(in_srgb,var(--v2-border-subtle)_50%,transparent)] bg-[color-mix(in_srgb,var(--v2-bg-section)_94%,black)] px-4 py-2 text-center max-md:py-2"
      role="status"
    >
      <p className="m-0 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[color-mix(in_srgb,var(--v2-text-secondary)_88%,var(--v2-state-warning)_12%)]">
        Paper simulation — NSE cash-style rules (IST 09:15–15:30; intraday sq-off typically 15:20). No broker, no
        live orders.
      </p>
    </div>
  );
}

function LiveMarketStrip() {
  return (
    <div
      className="relative z-[2] flex shrink-0 items-center gap-x-4 gap-y-1 border-b border-[color-mix(in_srgb,var(--v2-border-subtle)_55%,transparent)] bg-[color-mix(in_srgb,black_35%,var(--v2-bg-base))] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[color-mix(in_srgb,var(--v2-text-secondary)_92%,var(--v2-accent-primary)_8%)] shadow-[0_1px_0_color-mix(in_srgb,var(--v2-accent-primary)_12%,transparent)] max-md:hidden"
      aria-hidden
    >
      <span className="whitespace-nowrap text-[var(--v2-text-accent)] [text-shadow:0_0_12px_color-mix(in_srgb,var(--v2-accent-primary)_35%,transparent)]">
        Noesis
      </span>
      <span className="hidden text-[color-mix(in_srgb,var(--v2-border-subtle)_90%,transparent)] sm:inline" aria-hidden>
        |
      </span>
      <span className="whitespace-nowrap text-[var(--v2-state-success)] [text-shadow:0_0_10px_color-mix(in_srgb,var(--v2-state-success)_25%,transparent)]">
        Sensex +0.65%
      </span>
      <span className="whitespace-nowrap text-[color-mix(in_srgb,var(--v2-text-secondary)_95%,var(--v2-state-success)_5%)]">
        Bank Nifty +0.85%
      </span>
      <span className="whitespace-nowrap text-[color-mix(in_srgb,var(--v2-text-secondary)_95%,var(--v2-state-success)_5%)]">
        Gold +1.48%
      </span>
      <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-[length:var(--text-2xs)] normal-case tracking-normal text-[var(--v2-text-muted)]">
        <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--v2-state-success)] [box-shadow:0_0_10px_color-mix(in_srgb,var(--v2-state-success)_55%,transparent)]" />
        Live
      </span>
    </div>
  );
}

function DecisionSnapshotPanel() {
  const row = (label: string, score: number, tone: "ok" | "warn" | "risk") => {
    const meterTint =
      tone === "ok"
        ? "color-mix(in_srgb,var(--v2-state-success)_42%,var(--v2-accent-primary)_58%)"
        : tone === "warn"
          ? "color-mix(in_srgb,var(--v2-state-warning)_55%,var(--v2-text-muted)_45%)"
          : "color-mix(in_srgb,var(--v2-state-error)_48%,var(--v2-text-muted)_52%)";
    return (
      <div className="grid grid-cols-[5.5rem_1.5rem_1fr] items-center gap-x-2 gap-y-0 text-[11px] leading-tight">
        <span className="font-mono uppercase tracking-wide text-[var(--v2-text-muted)]">{label}</span>
        <span
          className={`font-mono tabular-nums ${
            tone === "ok"
              ? "text-[color-mix(in_srgb,var(--v2-state-success)_82%,var(--v2-text-secondary))]"
              : tone === "warn"
                ? "text-[color-mix(in_srgb,var(--v2-state-warning)_88%,var(--v2-text-secondary))]"
                : "text-[color-mix(in_srgb,var(--v2-state-error)_82%,var(--v2-text-secondary))]"
          }`}
        >
          {score}
        </span>
        <span className="min-w-0 truncate font-mono" style={{ color: meterTint }}>
          {scoreMeter(score)}
        </span>
      </div>
    );
  };

  return (
    <div
      className="mt-4 border border-[color-mix(in_srgb,var(--v2-border-subtle)_70%,transparent)] border-l-[3px] border-l-[color-mix(in_srgb,var(--v2-accent-primary)_45%,var(--v2-border-subtle))] bg-[color-mix(in_srgb,var(--v2-bg-base)_55%,transparent)] px-3.5 py-3 max-md:mt-3"
      role="region"
      aria-label="System in action preview"
    >
      <div className="mb-3 border-b border-[color-mix(in_srgb,var(--v2-border-subtle)_45%,transparent)] pb-2.5">
        <p className="m-0 font-mono text-[10px] font-black uppercase tracking-[0.22em] text-[color-mix(in_srgb,var(--v2-text-secondary)_75%,var(--v2-accent-primary)_25%)]">
          System in action
        </p>
        <div className="mt-2 font-mono text-[12px] uppercase tracking-wide text-[var(--v2-text-secondary)]">
          <span className="text-[var(--v2-text-primary)]">Reliance Industries</span>
          <span className="text-[var(--v2-text-muted)]"> · NSE</span>
        </div>
      </div>
      <div className="space-y-1.5">
        {row("Setup", 82, "ok")}
        {row("Market", 71, "warn")}
        {row("Behavior", 54, "risk")}
      </div>
      <div className="mt-3 space-y-2 border-t border-[color-mix(in_srgb,var(--v2-border-subtle)_55%,transparent)] pt-2.5 font-mono text-[11px] leading-snug">
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="text-[var(--v2-text-muted)]">Verdict</span>
          <span className="text-[var(--v2-text-muted)]">→</span>
          <span className="font-semibold tracking-wide text-[var(--v2-state-success)]">BUY</span>
          <span className="text-[length:10px] uppercase text-[var(--v2-text-disabled)]">(signal)</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span className="text-[var(--v2-text-muted)]">Risk flag</span>
          <span className="text-[var(--v2-text-muted)]">→</span>
          <span className="font-semibold text-[var(--v2-state-warning)]">REVENGE_TRADING_RISK</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 border-t border-[color-mix(in_srgb,var(--v2-border-subtle)_40%,transparent)] pt-2">
          <span className="text-[var(--v2-text-muted)]">Outcome</span>
          <span className="text-[var(--v2-text-muted)]">→</span>
          <span className="font-semibold text-[var(--v2-state-error)]">BLOCKED</span>
          <span className="text-[length:10px] font-normal normal-case text-[var(--v2-text-secondary)]">
            — execution gate closed
          </span>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, login } = useAuth();

  const [isLogin, setIsLogin] = useState(location.pathname === ROUTES.login);
  const [formData, setFormData] = useState<FormState>({
    name: "",
    email: "",
    password: "",
    experienceLevel: "",
  });
  const [loading, setLoading] = useState(false);
  const [submitStage, setSubmitStage] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading) {
      setSubmitStage(0);
      return;
    }
    setSubmitStage(0);
    const t1 = window.setTimeout(() => setSubmitStage(1), 360);
    const t2 = window.setTimeout(() => setSubmitStage(2), 720);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [loading]);

  useEffect(() => {
    if (user) {
      navigate(ROUTES.dashboard);
    }
  }, [user, navigate]);

  useEffect(() => {
    const onLoginRoute = location.pathname === ROUTES.login;
    setIsLogin(onLoginRoute);
  }, [location.pathname]);

  const goLogin = useCallback(() => {
    setError("");
    navigate(ROUTES.login);
  }, [navigate]);

  const goRegister = useCallback(() => {
    setError("");
    navigate(ROUTES.register);
  }, [navigate]);

  const resetForm = useCallback(() => {
    setFormData({ name: "", email: "", password: "", experienceLevel: "" });
  }, []);

  const handleTabLogin = () => {
    resetForm();
    goLogin();
  };

  const handleTabRegister = () => {
    resetForm();
    goRegister();
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) setError("");
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading) return;

    const startedAt = performance.now();
    setLoading(true);
    setError("");

    try {
      const payload = isLogin
        ? { email: formData.email, password: formData.password }
        : { name: formData.name, email: formData.email, password: formData.password };

      const data = isLogin ? await loginUser(payload) : await registerUser(payload);

      const elapsed = performance.now() - startedAt;
      const minCheckpointMs = 1180;
      if (elapsed < minCheckpointMs) {
        await sleep(minCheckpointMs - elapsed);
      }

      login({
        token: data.token,
        user: data.user,
        csrfToken: data.csrfToken,
      });
      navigate(ROUTES.dashboard);
    } catch (err) {
      setError(getAuthErrorMessage(err, isLogin));
    } finally {
      setLoading(false);
    }
  };

  const tabBtn = (active: boolean) =>
    `relative -mb-px flex-1 border-b-2 border-transparent pb-2.5 pt-1 text-center text-[length:var(--text-xs)] font-semibold uppercase tracking-[0.14em] transition-[color,border-color,opacity] duration-300 ease-out max-md:min-h-[44px] max-md:flex max-md:items-center max-md:justify-center ${
      active
        ? "border-[var(--v2-accent-primary)] text-[var(--v2-text-primary)] [box-shadow:0_10px_22px_-16px_color-mix(in_srgb,var(--v2-accent-primary)_40%,transparent)]"
        : "text-[var(--v2-text-muted)] hover:text-[var(--v2-text-secondary)]"
    }`;

  const submitStatusLine = loading
    ? SUBMIT_STAGE_MESSAGES[Math.min(submitStage, SUBMIT_STAGE_MESSAGES.length - 1)]
    : null;

  const primaryCtaLabel = isLogin ? "Enter decision terminal →" : "Initialize account →";

  return (
    <div className="flex min-h-screen flex-col bg-[var(--v2-bg-base)] font-sans text-[var(--v2-text-primary)]">
      <SimulationHeaderRibbon />

      <div className="flex min-h-0 flex-1 max-md:flex max-md:flex-col-reverse md:grid md:grid-cols-2 md:min-h-0">
        {/* LEFT — system canvas (50%) */}
        <aside className="relative flex min-h-[200px] flex-col overflow-hidden border-b border-[color-mix(in_srgb,var(--v2-border-subtle)_45%,transparent)] max-md:min-h-0 md:min-h-0 md:border-b-0 md:shadow-[inset_-56px_0_72px_-40px_var(--v2-bg-base)]">
          <AuthSystemBackdrop />

          <LiveMarketStrip />

          <div
            className="relative z-[1] flex min-h-0 flex-1 flex-col px-5 py-6 max-md:py-5 md:px-8 md:py-7"
            style={{
              background:
                "linear-gradient(168deg, color-mix(in srgb, var(--v2-bg-section) 88%, transparent) 0%, color-mix(in srgb, var(--v2-bg-base) 86%, transparent) 48%, var(--v2-bg-base) 100%)",
            }}
          >
            <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center md:mx-0 md:max-w-none md:justify-start md:pt-2">
              <h1
                className="m-0 text-balance font-black tracking-[-0.03em] text-[var(--v2-text-primary)] [text-shadow:0_0_42px_color-mix(in_srgb,var(--v2-accent-primary)_12%,transparent)]"
                style={{ fontSize: "clamp(1.55rem, 2.85vw, 2.15rem)", lineHeight: 1.12 }}
              >
                Controlled gateway into a disciplined trading system.
              </h1>

              <div className="mt-5 max-w-[30rem] space-y-1 border-l-2 border-[color-mix(in_srgb,var(--v2-accent-primary)_35%,var(--v2-border-subtle))] pl-3.5">
                <p className="m-0 text-pretty font-medium leading-snug text-[var(--v2-text-secondary)]" style={{ fontSize: "var(--text-sm)" }}>
                  Every decision is evaluated before execution.
                </p>
                <p className="m-0 text-pretty font-medium leading-snug text-[var(--v2-text-secondary)]" style={{ fontSize: "var(--text-sm)" }}>
                  Every trade is judged after closure.
                </p>
              </div>

              <DecisionSnapshotPanel />
            </div>
          </div>
        </aside>

        {/* RIGHT — auth panel (50%) */}
        <div className="relative flex flex-1 flex-col justify-center bg-[var(--v2-bg-base)] px-4 py-7 shadow-[inset_40px_0_64px_-48px_color-mix(in_srgb,var(--v2-bg-section)_18%,var(--v2-bg-base))] sm:px-7 md:px-10 md:py-10">
          <div className="pointer-events-none absolute inset-0 opacity-[0.035] max-md:hidden" aria-hidden>
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(color-mix(in srgb, var(--v2-text-primary) 12%, transparent) 1px, transparent 1px)",
                backgroundSize: "56px 56px",
              }}
            />
          </div>

          <div
            className="relative z-[1] mx-auto w-full max-w-sm rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--v2-border-subtle)_55%,transparent)] p-5 shadow-[0_20px_56px_-36px_rgba(0,0,0,0.75)] backdrop-blur-xl backdrop-saturate-150 sm:p-6 md:p-7"
            style={{
              background:
                "linear-gradient(165deg, color-mix(in srgb, var(--v2-bg-section) 42%, transparent) 0%, color-mix(in srgb, var(--v2-bg-base) 72%, transparent) 100%)",
            }}
          >
            <div className="flex gap-0 border-b border-[color-mix(in_srgb,var(--v2-border-subtle)_42%,transparent)]">
              <button type="button" className={tabBtn(isLogin)} onClick={handleTabLogin}>
                System access
              </button>
              <button type="button" className={tabBtn(!isLogin)} onClick={handleTabRegister}>
                Initialize account
              </button>
            </div>

            <p className="m-0 mt-3 text-center text-[length:var(--text-2xs)] leading-relaxed text-[var(--v2-text-muted)]">
              Execution access requires valid system state.
            </p>

            <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4" aria-busy={loading}>
              {!isLogin && (
                <div>
                  <label htmlFor="auth-name" className={labelClass}>
                    Name
                  </label>
                  <input
                    id="auth-name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                    className={inputClass}
                  />
                </div>
              )}

              <div>
                <label htmlFor="auth-email" className={labelClass}>
                  Email
                </label>
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  autoComplete={isLogin ? "email" : "email"}
                  value={formData.email}
                  onChange={handleChange}
                  required
                  className={inputClass}
                />
              </div>

              <div>
                <label htmlFor="auth-password" className={labelClass}>
                  Password
                </label>
                <input
                  id="auth-password"
                  name="password"
                  type="password"
                  autoComplete={isLogin ? "current-password" : "new-password"}
                  value={formData.password}
                  onChange={handleChange}
                  required
                  className={inputClass}
                />
              </div>

              {!isLogin && (
                <div>
                  <label htmlFor="auth-experience" className={labelClass}>
                    Experience level <span className="font-normal normal-case text-[var(--v2-text-disabled)]">(optional)</span>
                  </label>
                  <select
                    id="auth-experience"
                    name="experienceLevel"
                    value={formData.experienceLevel}
                    onChange={handleChange}
                    className={`${inputClass} cursor-pointer`}
                  >
                    <option value="">— Not specified —</option>
                    <option value="new">New to markets</option>
                    <option value="learning">Learning / paper</option>
                    <option value="active">Actively trading</option>
                    <option value="experienced">Experienced</option>
                  </select>
                </div>
              )}

              {error ? (
                <p
                  className="m-0 rounded-[var(--radius-md)] border border-[var(--v2-state-error-bg)] bg-[var(--v2-state-error-bg)] px-3 py-2.5 text-[length:var(--text-sm)] text-[var(--v2-state-error)]"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}

              <div className="mt-0.5 flex flex-col gap-2.5">
                <p
                  className="m-0 min-h-[2.5rem] text-center font-mono text-[10px] uppercase leading-relaxed tracking-[0.14em] text-[color-mix(in_srgb,var(--v2-text-secondary)_90%,var(--v2-accent-primary)_10%)]"
                  aria-hidden={loading}
                >
                  {loading ? (
                    <span className="inline-block text-[var(--v2-text-muted)]">Checkpoint in progress</span>
                  ) : (
                    <span className="text-[var(--v2-text-muted)]">Secure checkpoint</span>
                  )}
                </p>
                <span className="sr-only" role="status" aria-live="polite">
                  {submitStatusLine ?? ""}
                </span>
                <button
                  type="submit"
                  disabled={loading}
                  aria-busy={loading}
                  className="group w-full rounded-[var(--radius-md)] border border-[var(--v2-accent-border)] bg-[var(--v2-accent-primary)] py-3 text-[length:var(--text-sm)] font-bold uppercase tracking-[0.1em] text-[var(--v2-text-inverse)] shadow-[0_8px_28px_-10px_color-mix(in_srgb,var(--v2-accent-primary)_55%,transparent)] transition-[opacity,transform,box-shadow,filter] duration-200 ease-out delay-0 hover:shadow-[0_0_36px_-6px_color-mix(in_srgb,var(--v2-accent-primary)_50%,transparent),0_12px_40px_-10px_color-mix(in_srgb,var(--v2-accent-primary)_42%,transparent)] hover:[filter:brightness(1.04)] hover:delay-[120ms] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-[0_8px_28px_-10px_color-mix(in_srgb,var(--v2-accent-primary)_55%,transparent)] disabled:hover:[filter:none] disabled:hover:delay-0"
                >
                  {loading ? submitStatusLine : primaryCtaLabel}
                </button>

                {isLogin ? (
                  <button
                    type="button"
                    onClick={handleTabRegister}
                    className="w-full rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--v2-border-subtle)_90%,transparent)] bg-transparent py-3 text-[length:var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--v2-text-secondary)] transition-colors duration-200 hover:border-[color-mix(in_srgb,var(--v2-accent-primary)_35%,transparent)] hover:text-[var(--v2-text-primary)]"
                  >
                    Initialize account
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleTabLogin}
                    className="w-full rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--v2-border-subtle)_90%,transparent)] bg-transparent py-3 text-[length:var(--text-sm)] font-semibold uppercase tracking-wide text-[var(--v2-text-secondary)] transition-colors duration-200 hover:border-[color-mix(in_srgb,var(--v2-accent-primary)_35%,transparent)] hover:text-[var(--v2-text-primary)]"
                  >
                    System access
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>

      <footer className="shrink-0 border-t border-[var(--v2-border-subtle)] bg-[color-mix(in_srgb,var(--v2-bg-section)_92%,var(--v2-bg-base))] px-4 py-3 md:py-3.5">
        <p className="m-0 text-center text-[length:var(--text-2xs)] leading-relaxed tracking-wide text-[var(--v2-text-muted)]">
          <span className="whitespace-nowrap">
            <span className="text-[color-mix(in_srgb,var(--v2-state-success)_85%,var(--v2-text-muted))]" aria-hidden>
              ●
            </span>{" "}
            System ready
          </span>
          <span className="mx-3 inline-block w-px max-md:hidden h-2.5 translate-y-px bg-[var(--v2-border-subtle)] align-middle opacity-60" aria-hidden />
          <span className="whitespace-nowrap max-md:block max-md:mt-1 md:inline">
            <span className="text-[color-mix(in_srgb,var(--v2-state-success)_85%,var(--v2-text-muted))]" aria-hidden>
              ●
            </span>{" "}
            Behavioral engine active
          </span>
          <span className="mx-3 inline-block w-px max-md:hidden h-2.5 translate-y-px bg-[var(--v2-border-subtle)] align-middle opacity-60" aria-hidden />
          <span className="whitespace-nowrap max-md:block max-md:mt-1 md:inline">
            <span className="text-[color-mix(in_srgb,var(--v2-accent-primary)_75%,var(--v2-text-muted))]" aria-hidden>
              ●
            </span>{" "}
            Decision trace retained
          </span>
        </p>
      </footer>
    </div>
  );
}
