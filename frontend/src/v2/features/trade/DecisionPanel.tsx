import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { X, Loader, CheckCircle, AlertTriangle } from "lucide-react";
import type { TradePanelContext } from "../../trade-flow";
import { useMarketQuote } from "../../hooks/useMarketQuote";
import { useJournalPage } from "../../hooks/useJournalDecisions";
import { usePortfolioSummary } from "../../hooks/usePortfolioSummary";
import { usePortfolioDecisions } from "../../pages/portfolio/usePortfolioDecisions";
import { buildTradingSystemPolicy } from "../../behavior/behavioralSystemPolicy";
import { runPreTrade, executeTrade, getTradeExecutionStatus } from "../../api/trade.api";
import type { PreTradeResult } from "../../api/trade.api";
import { fromPaise } from "../../../utils/currency.utils";
import { queryClient } from "../../../queryClient";
import { queryKeys } from "../../queryKeys";
import { TRADE_SUCCESS_SESSION_KEY } from "../../trade-flow";
import TradePanelOverlay from "./terminal/TradePanelOverlay";
import TradeInputs from "./terminal/TradeInputs";
import TradeSystemStateHeader from "./terminal/TradeSystemStateHeader";
import type { SetupGateState } from "./terminal/TradeSystemStateHeader";
import TradeExecutionBar from "./terminal/TradeExecutionBar";
import ExecutionReadinessPanel from "./terminal/ExecutionReadinessPanel";
import type { ReadinessRow } from "./terminal/ExecutionReadinessPanel";
import { useSymbolIntelligence } from "../../hooks/useSymbolIntelligence";
import TradeTerminalSharedIntel from "./terminal/TradeTerminalSharedIntel";
import ExecutionConsequenceBlock from "./terminal/ExecutionConsequenceBlock";
import { hasBlockingLocalIssues } from "./terminal/riskLocalGate";
import ThesisInput from "./terminal/ThesisInput";
import PreTradeEmotionSelect from "./terminal/PreTradeEmotionSelect";
import type { PreTradeEmotionId } from "./terminal/preTradeEmotions";
import type { TradeOutcomeVisual } from "./terminal/DecisionResult";
import { buildTradeEvaluation, type TradeEvaluation } from "./terminal/tradeEvaluation";
import TradeSystemContext from "./terminal/TradeSystemContext";
import { reviewGateVerdict, setupGateVerdict, type GateVerdict } from "./terminal/executionGateUi";
import { normalizeApiError } from "../../lib/normalizeApiError.js";

type Phase = "SETUP" | "ANALYZING" | "REVIEW" | "EXECUTING" | "SUCCESS" | "ERROR";

type ExecuteFailMeta = { retryable: boolean; status: number | null };

type Props = {
  open: boolean;
  symbol: string | null;
  context: TradePanelContext | null;
  onClose: () => void;
  /** Backdrop treatment when opened from Markets. */
  backdrop?: "default" | "markets";
};

export default function DecisionPanel({ open, symbol, context, onClose, backdrop = "default" }: Props) {
  const journal = useJournalPage();
  const { summary: portfolio } = usePortfolioSummary();
  const portfolioDecisions = usePortfolioDecisions();
  const systemPolicy = useMemo(
    () => buildTradingSystemPolicy(journal.logs, journal.engine, portfolio),
    [journal.logs, journal.engine, portfolio],
  );
  const thesisMin = systemPolicy.behaviorLayer.thesisMinChars;
  const scalingBlocked = systemPolicy.behaviorLayer.scalingBlocked;

  const { quote } = useMarketQuote(open ? symbol : null);
  const livePriceINR = quote ? fromPaise(quote.pricePaise).toFixed(2) : "";
  const sharedIntel = useSymbolIntelligence(open ? symbol : null);
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [productType, setProductType] = useState<"DELIVERY" | "INTRADAY">("DELIVERY");
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [target, setTarget] = useState("");
  const [thinking, setThinking] = useState("");
  const [preTradeEmotion, setPreTradeEmotion] = useState<PreTradeEmotionId | "">("");

  const [phase, setPhase] = useState<Phase>("SETUP");
  /** Server execution price (paise) after successful POST — aligns header with DB truth. */
  const [executedPricePaise, setExecutedPricePaise] = useState<number | null>(null);
  /** One idempotency key per confirm action; reused on network retry until success. */
  const executionIdempotencyKeyRef = useRef<string | null>(null);
  const [preTrade, setPreTrade] = useState<PreTradeResult | null>(null);
  const [evaluation, setEvaluation] = useState<TradeEvaluation | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [submissionOutcome, setSubmissionOutcome] = useState<"executed" | "queued">("executed");
  const [reflectionPending, setReflectionPending] = useState(false);
  const [executeFailMeta, setExecuteFailMeta] = useState<ExecuteFailMeta | null>(null);

  useEffect(() => {
    if (open) {
      setPhase("SETUP");
      setPreTrade(null);
      setEvaluation(null);
      setErrorMsg("");
      setExecuteFailMeta(null);
      setQuantity("1");
      setProductType("DELIVERY");
      setStopLoss("");
      setTarget("");
      setThinking("");
      setPreTradeEmotion("");
      executionIdempotencyKeyRef.current = null;
      setExecutedPricePaise(null);
      setSubmissionOutcome("executed");
      setReflectionPending(false);
    }
  }, [open, symbol]);

  useEffect(() => {
    if (livePriceINR) setPrice(livePriceINR);
  }, [livePriceINR]);

  const portfolioExitQty = useMemo(() => {
    if (!symbol) return 0;
    const row = portfolioDecisions.items.find((i) => i.title === symbol);
    const q = row?.meta?.quantity;
    return typeof q === "number" && Number.isFinite(q) && q > 0 ? Math.floor(q) : 0;
  }, [symbol, portfolioDecisions.items]);

  const showPortfolioExit = portfolioExitQty >= 1;

  useEffect(() => {
    if (!open) return;
    const m = context?.meta as { side?: string; quantity?: number } | undefined;
    if (m?.side === "SELL" && portfolioExitQty >= 1) {
      setSide("SELL");
      if (m.quantity != null) setQuantity(String(Math.min(Math.max(1, m.quantity), portfolioExitQty)));
      return;
    }
    if (m?.side === "BUY") {
      setSide("BUY");
      if (m.quantity != null) setQuantity(String(m.quantity));
    }
  }, [open, symbol, context, portfolioExitQty]);

  useEffect(() => {
    if (!open) return;
    if (side === "SELL" && portfolioExitQty < 1) setSide("BUY");
  }, [open, side, portfolioExitQty]);

  const toInt = useCallback((v: string): number => Math.round(parseFloat(v || "0") * 100), []);

  const headerPrice = useMemo(() => {
    if (quote?.pricePaise) return `₹${fromPaise(quote.pricePaise).toFixed(2)}`;
    const p = parseFloat(price);
    if (p > 0) return `₹${p.toFixed(2)}`;
    return "—";
  }, [quote?.pricePaise, price]);

  const preTradeTokenExpiresAtMs = useMemo(() => {
    const raw = preTrade?.data?.authority?.expiresAt;
    if (raw == null) return 0;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    const t = new Date(String(raw)).getTime();
    return Number.isFinite(t) ? t : 0;
  }, [preTrade]);

  const canRetryExecuteSubmit = useMemo(() => {
    if (phase !== "ERROR") return false;
    if (!preTrade?.data?.authority?.token || evaluation?.status !== "VALID") return false;
    if (!preTradeEmotion) return false;
    if (preTradeTokenExpiresAtMs > 0 && preTradeTokenExpiresAtMs < Date.now() + 3000) return false;
    const st = executeFailMeta?.status ?? null;
    const retryable =
      executeFailMeta?.retryable === true ||
      st == null ||
      st === 429 ||
      st === 502 ||
      st === 503 ||
      st === 504 ||
      st === 408 ||
      (typeof st === "number" && st >= 500);
    return retryable;
  }, [phase, preTrade, evaluation, preTradeEmotion, executeFailMeta, preTradeTokenExpiresAtMs]);

  const headerPriceDisplay = useMemo(() => {
    if (
      phase === "SUCCESS" &&
      submissionOutcome === "executed" &&
      executedPricePaise != null &&
      Number.isFinite(executedPricePaise)
    ) {
      return `₹${fromPaise(executedPricePaise).toFixed(2)} (executed)`;
    }
    let line = headerPrice;
    if (quote?.isStale) line = `${line} · stale quote`;
    else if (quote?.source === "CACHE" || quote?.isFallback) line = `${line} · cached quote`;
    return line;
  }, [phase, submissionOutcome, executedPricePaise, headerPrice, quote?.isStale, quote?.source, quote?.isFallback]);

  const changePct = context?.meta?.changePct ?? null;
  const decision = context?.decision ?? { action: "GUIDE" as const, confidence: 0, reason: "" };

  const { breachPositionCount, stressedPositionCount, openPositionCount } = useMemo(() => {
    const items = portfolioDecisions.items;
    const breach = items.filter((i) => !i.decision.allowed || i.decision.action === "BLOCK").length;
    const stress = items.filter((i) => (i.meta?.pnlPct ?? 0) < -3).length;
    return {
      breachPositionCount: breach,
      stressedPositionCount: stress,
      openPositionCount: items.length,
    };
  }, [portfolioDecisions.items]);

  const reviewJudgment = useMemo(() => reviewGateVerdict(evaluation), [evaluation]);

  const quantitySystemHint = useMemo(() => {
    if (scalingBlocked) return "System cap: 1 share until journal unlock (scaling lock).";
    if (systemPolicy.portfolioLayer.defensive || decision.action === "GUIDE")
      return "Suggested size: 1 share under elevated portfolio / signal risk.";
    return undefined;
  }, [scalingBlocked, systemPolicy.portfolioLayer.defensive, decision.action]);

  const stopSystemNote =
    side === "BUY"
      ? "Stop required by execution policy — must sit below limit entry; target above entry."
      : undefined;

  const snap = preTrade?.data?.snapshot ?? null;
  const authorityVerdict = preTrade?.data?.authority?.verdict ?? null;

  const reviewJudgmentOutcome: TradeOutcomeVisual = useMemo(() => {
    if (phase !== "REVIEW" || !evaluation) return "pending";
    if (evaluation.status === "VALID") return "valid";
    if (evaluation.status === "ADJUST") return "adjust";
    return "blocked";
  }, [phase, evaluation]);

  const reviewJudgmentMessage = evaluation?.messages?.length ? evaluation.messages[0] : "";

  const localGate = useMemo(
    () =>
      hasBlockingLocalIssues({
        side,
        price,
        quantity,
        stopLoss,
        target,
        thesis: thinking,
        thesisMin,
        preTradeEmotion,
        scalingBlocked,
      }),
    [side, price, quantity, stopLoss, target, thinking, thesisMin, preTradeEmotion, scalingBlocked],
  );

  const setupJudgment = useMemo(
    () => setupGateVerdict(decision, systemPolicy, localGate),
    [decision, systemPolicy, localGate],
  );

  const canAnalyze =
    Boolean(symbol) &&
    !localGate &&
    thinking.trim().length >= thesisMin &&
    phase === "SETUP" &&
    decision.action !== "BLOCK";

  const canExecute = useMemo(() => {
    if (phase !== "REVIEW" || evaluation?.status !== "VALID") return false;
    if (!preTrade?.data?.authority?.token || !symbol) return false;
    if (!preTradeEmotion) return false;
    return true;
  }, [phase, evaluation, preTrade, symbol, preTradeEmotion]);

  const epNum = parseFloat(price || "0");
  const slNum = parseFloat(stopLoss || "0");
  const tpNum = parseFloat(target || "0");
  const qtyIntForGate = parseInt(quantity || "1", 10);
  // L-03: SELL no longer auto-passes the "stop" row — require positive limit price
  // and quantity so the setup checklist reflects real exit inputs (thesis is still
  // enforced separately and by hasBlockingLocalIssues).
  const stopOk =
    side === "SELL"
      ? epNum > 0 && qtyIntForGate > 0
      : epNum > 0 && slNum > 0 && tpNum > 0 && slNum < epNum && tpNum > epNum;
  const thesisOk = thinking.trim().length >= thesisMin;
  const riskBandOk = decision.action !== "BLOCK";

  const setupGateState = useMemo<SetupGateState>(() => {
    if (decision.action === "BLOCK") return "locked_market";
    if (canAnalyze) return "ready_analyze";
    return "incomplete";
  }, [decision.action, canAnalyze]);

  const setupReadinessRows = useMemo((): ReadinessRow[] => {
    return [
      {
        id: "stop",
        status: stopOk ? "valid" : "missing",
        label:
          side === "BUY" ? "Stop and target frame your entry" : "Exit price and quantity are set",
      },
      {
        id: "thesis",
        status: thesisOk ? "valid" : "missing",
        label: `Thesis meets minimum length (${thesisMin} chars)`,
      },
      {
        id: "emotion",
        status: Boolean(preTradeEmotion) ? "valid" : "missing",
        label: "Behavior state selected",
      },
      {
        id: "risk",
        status: riskBandOk ? "valid" : "blocked",
        label: "Market posture allows this ticket",
      },
    ];
  }, [stopOk, thesisOk, preTradeEmotion, riskBandOk, side, thesisMin]);

  const reviewReadinessRows = useMemo((): ReadinessRow[] => {
    let riskStatus: ReadinessRow["status"] = "missing";
    if (evaluation?.status === "BLOCKED") riskStatus = "blocked";
    else if (evaluation?.status === "VALID") riskStatus = "valid";
    else if (evaluation?.status === "ADJUST") riskStatus = "missing";
    return [
      {
        id: "stop",
        status: stopOk ? "valid" : "missing",
        label: side === "BUY" ? "Bracket still valid" : "Exit inputs valid",
      },
      { id: "thesis", status: thesisOk ? "valid" : "missing", label: "Thesis still on file" },
      {
        id: "emotion",
        status: Boolean(preTradeEmotion) ? "valid" : "missing",
        label: "Behavior state on file",
      },
      { id: "risk", status: riskStatus, label: "Server risk gate" },
    ];
  }, [evaluation?.status, stopOk, thesisOk, preTradeEmotion, side]);

  const systemHeaderMode = useMemo(() => {
    if (phase === "SETUP") return "setup" as const;
    if (phase === "REVIEW") return "review" as const;
    if (phase === "ANALYZING" || phase === "EXECUTING") return "busy" as const;
    if (phase === "SUCCESS") return "success" as const;
    return "error" as const;
  }, [phase]);

  const headerStatusLine = useMemo(() => {
    if (phase === "SETUP") return setupJudgment.explanation;
    if (phase === "REVIEW")
      return reviewJudgment.explanation || reviewJudgmentMessage || "Review server checks before submit.";
    if (phase === "ANALYZING") return "Running risk evaluation — keep this window open.";
    if (phase === "EXECUTING") return "Submitting your order…";
    if (phase === "SUCCESS")
      return submissionOutcome === "queued"
        ? "Order queued for the next session open."
        : "Order accepted — portfolio and journal refresh automatically.";
    if (phase === "ERROR") return errorMsg || "Something blocked this step.";
    return "";
  }, [
    phase,
    setupJudgment.explanation,
    reviewJudgment.explanation,
    reviewJudgmentMessage,
    submissionOutcome,
    errorMsg,
  ]);

  const headerExecutionVerdict: GateVerdict | undefined =
    phase === "REVIEW" ? reviewJudgment.verdict : undefined;

  const handleAnalyze = async () => {
    if (!symbol) return;
    const pricePaise = toInt(price);
    const qtyInt = parseInt(quantity || "1", 10);
    const slPaise = toInt(stopLoss);
    const tpPaise = toInt(target);
    const thesis = thinking.trim();

    if (pricePaise <= 0 || qtyInt <= 0) {
      setErrorMsg("Enter a valid limit price and quantity before evaluation.");
      setPhase("ERROR");
      return;
    }
    if (side === "BUY" && (slPaise <= 0 || tpPaise <= 0)) {
      setErrorMsg("Buy orders require both stop loss and target before evaluation.");
      setPhase("ERROR");
      return;
    }
    if (thesis.length < thesisMin) {
      setErrorMsg(`Add a trade thesis of at least ${thesisMin} characters before evaluation.`);
      setPhase("ERROR");
      return;
    }

    setPhase("ANALYZING");
    setErrorMsg("");
    setEvaluation(null);
    try {
      const result = await runPreTrade({
        side,
        productType: side === "BUY" ? productType : undefined,
        symbol,
        quantity: qtyInt,
        pricePaise,
        stopLossPaise: side === "BUY" ? slPaise : undefined,
        targetPricePaise: side === "BUY" ? tpPaise : undefined,
        userThinking: thesis,
        preTradeEmotion: preTradeEmotion || undefined,
      });
      const ev = buildTradeEvaluation(result);
      setEvaluation(ev);
      if (!result.success) {
        setPreTrade(null);
        setErrorMsg(ev.messages[0] ?? "Evaluation failed.");
        setPhase("ERROR");
        return;
      }
      if (!result.data?.snapshot) {
        setPreTrade(null);
        setErrorMsg("Evaluation returned no risk snapshot. Run ANALYZE RISK again.");
        setPhase("ERROR");
        return;
      }
      const authTok = result.data?.authority?.token ?? result.data?.token;
      if (!authTok) {
        setPreTrade(null);
        setErrorMsg(
          "Evaluation succeeded but no authority token was returned. Refresh and run ANALYZE RISK again, or check the pre-trade service.",
        );
        setPhase("ERROR");
        return;
      }
      setPreTrade(result);
      setPhase("REVIEW");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (err as Error)?.message ??
        "Evaluation could not complete. Check inputs and try again.";
      setEvaluation(null);
      setErrorMsg(msg);
      setPhase("ERROR");
    }
  };

  const handleExecute = async () => {
    if (evaluation?.status !== "VALID" || !preTrade?.data?.authority?.token || !symbol) return;
    if (!preTradeEmotion) return;
    if (phase === "REVIEW") {
      if (!canExecute) return;
    } else if (phase === "ERROR") {
      if (!canRetryExecuteSubmit) return;
    } else {
      return;
    }

    setExecuteFailMeta(null);
    setPhase("EXECUTING");
    const pricePaise = toInt(price);
    const qtyInt = parseInt(quantity || "1", 10);
    const slPaise = toInt(stopLoss);
    const tpPaise = toInt(target);
    const token = preTrade.data.authority.token;
    const verdict = preTrade.data.authority.verdict;
    if (!executionIdempotencyKeyRef.current) {
      executionIdempotencyKeyRef.current =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
    try {
      const execRes = await executeTrade({
        side,
        productType: side === "BUY" ? productType : undefined,
        symbol,
        quantity: qtyInt,
        pricePaise,
        stopLossPaise: side === "BUY" ? slPaise : undefined,
        targetPricePaise: side === "BUY" ? tpPaise : undefined,
        preTradeToken: token,
        idempotencyKey: executionIdempotencyKeyRef.current,
        decisionContext: {
          source: "NOESIS_PANEL",
          verdict,
          marketSignal: decision.action,
          score: preTrade.data?.snapshot?.risk?.score,
          thesis: thinking.trim(),
          behavioralLoop: {
            dominantBias: systemPolicy.behaviorLayer.activeBiasTag,
            scalingBlocked,
            thesisMandatory: systemPolicy.behaviorLayer.thesisMandatory,
            journalSeverity: systemPolicy.journalSignals.severity,
            journalConfidenceMean: systemPolicy.journalSignals.confidence,
            portfolioDefensive: systemPolicy.portfolioLayer.defensive,
            criticalBreaches: systemPolicy.criticalBreaches,
            systemVerdict: systemPolicy.verdictLayer.headline,
            preTradeEmotion,
          },
        },
        userThinking: thinking.trim(),
        preTradeEmotion,
      });
      // C-04 FIX: Remove executionBalance from the fallback chain.
      // executionBalance is the user's remaining CASH BALANCE (e.g. ₹4,50,000 = 45,000,000 paise),
      // not the trade execution price. Using it as a fallback displayed the user's
      // balance as the executed price in the trade success header.
      const queued = execRes.state === "PENDING" || execRes.data?.status === "PENDING_EXECUTION";
      setSubmissionOutcome(queued ? "queued" : "executed");
      const tradeId = execRes.data?.tradeId;
      if (!queued && tradeId) {
        setReflectionPending(true);
        for (let i = 0; i < 4; i += 1) {
          const statusRes = await getTradeExecutionStatus(tradeId);
          const derived = statusRes.data?.executionDerivedStatus;
          if (derived === "COMPLETED" || derived === "FAILED") {
            setReflectionPending(derived !== "COMPLETED");
            break;
          }
          await new Promise((resolve) => {
            window.setTimeout(resolve, 350);
          });
        }
      } else {
        setReflectionPending(false);
      }
      const ep = execRes.data?.executionPricePaise ?? execRes.data?.pricePaise;
      if (!queued && typeof ep === "number" && Number.isFinite(ep)) {
        setExecutedPricePaise(ep);
      }

      sessionStorage.setItem(TRADE_SUCCESS_SESSION_KEY, "1");
      executionIdempotencyKeyRef.current = null;
      setPhase("SUCCESS");

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.portfolio }),
        queryClient.invalidateQueries({ queryKey: queryKeys.portfolioSummary }),
        queryClient.invalidateQueries({ queryKey: queryKeys.journal }),
        queryClient.invalidateQueries({ queryKey: queryKeys.profile }),
        queryClient.invalidateQueries({ queryKey: queryKeys.trace }),
        queryClient.invalidateQueries({ queryKey: queryKeys.attention }),
        queryClient.invalidateQueries({ queryKey: queryKeys.markets }),
      ]);

      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: unknown) {
      const norm = normalizeApiError(err as never);
      setExecuteFailMeta({ retryable: norm.retryable, status: norm.status });
      const msg =
        norm.message ||
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err as Error)?.message ||
        "Order could not be submitted. No change was made to your portfolio.";
      setErrorMsg(msg);
      setPhase("ERROR");
    }
  };

  if (!open || !symbol) return null;

  const overlayBackdrop = backdrop === "markets" ? "markets" : "default";

  return (
    <TradePanelOverlay open={open} onClose={onClose} backdrop={overlayBackdrop}>
      <div
        className={`trade-terminal flex min-h-0 flex-col${backdrop === "markets" ? " trade-terminal--dock" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-terminal-title"
      >
        <button type="button" className="trade-terminal__close" onClick={onClose} aria-label="Close trade workspace">
          <X size={18} />
        </button>

        <TradeSystemStateHeader
          symbol={symbol}
          priceDisplay={headerPriceDisplay}
          changePct={changePct}
          decision={decision}
          orderSide={side}
          mode={systemHeaderMode}
          statusLine={headerStatusLine}
          executionVerdict={headerExecutionVerdict}
          setupGateState={phase === "SETUP" ? setupGateState : undefined}
          executionHeld={phase === "REVIEW" ? !canExecute : undefined}
        />

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="trade-terminal__body min-h-0 flex-1">
            {phase === "SETUP" && (
              <>
                <TradeSystemContext
                  policy={systemPolicy}
                  decision={decision}
                  breachPositionCount={breachPositionCount}
                  stressedPositionCount={stressedPositionCount}
                  openPositionCount={openPositionCount}
                />
                <TradeTerminalSharedIntel
                  isLoading={sharedIntel.isLoading}
                  isError={sharedIntel.isError}
                  sentiment={sharedIntel.sentiment}
                  bullets={sharedIntel.bullets}
                />
                <ThesisInput
                  value={thinking}
                  onChange={setThinking}
                  minLength={thesisMin}
                  mandatory={systemPolicy.behaviorLayer.thesisMandatory}
                />
                <PreTradeEmotionSelect value={preTradeEmotion} onChange={setPreTradeEmotion} />
                <TradeInputs
                  side={side}
                  onSideChange={setSide}
                  productType={productType}
                  onProductTypeChange={setProductType}
                  price={price}
                  onPriceChange={setPrice}
                  quantity={quantity}
                  onQuantityChange={setQuantity}
                  stopLoss={stopLoss}
                  onStopLossChange={setStopLoss}
                  target={target}
                  onTargetChange={setTarget}
                  livePriceHint={livePriceINR ? ` · Live reference ₹${livePriceINR}` : undefined}
                  quantitySystemHint={quantitySystemHint}
                  stopSystemNote={stopSystemNote}
                  showPortfolioExit={showPortfolioExit}
                  exitMaxQuantity={portfolioExitQty}
                  executionSurface
                />
                <ExecutionReadinessPanel
                  outcome={localGate ? "adjust" : canAnalyze ? "valid" : "pending"}
                  inlineNote={
                    localGate
                      ? "Fix the flagged lines below, then run the risk check."
                      : canAnalyze
                        ? "Local checks satisfied — you may request server evaluation."
                        : undefined
                  }
                  rows={setupReadinessRows}
                  mode="local"
                  side={side}
                  price={price}
                  quantity={quantity}
                  stopLoss={stopLoss}
                  target={target}
                  thesis={thinking}
                  thesisMin={thesisMin}
                  preTradeEmotion={preTradeEmotion}
                  scalingBlocked={scalingBlocked}
                  snapshot={null}
                  authorityVerdict={null}
                  analyzing={false}
                />
              </>
            )}

            {phase === "ANALYZING" && (
              <div className="trade-terminal-center">
                <Loader size={28} className="dp-spinner" aria-hidden />
                <p className="trade-terminal-center__title">Evaluating trade</p>
                <p className="trade-terminal-center__sub">Risk, behavior, and rule alignment</p>
              </div>
            )}

            {phase === "REVIEW" && snap && (
              <>
                <TradeSystemContext
                  policy={systemPolicy}
                  decision={decision}
                  breachPositionCount={breachPositionCount}
                  stressedPositionCount={stressedPositionCount}
                  openPositionCount={openPositionCount}
                />
                <TradeTerminalSharedIntel
                  isLoading={sharedIntel.isLoading}
                  isError={sharedIntel.isError}
                  sentiment={sharedIntel.sentiment}
                  bullets={sharedIntel.bullets}
                />
                <section
                  className="rounded-xl border border-slate-800/80 bg-slate-900/35 px-3 py-3 text-xs leading-snug text-slate-300 md:px-4"
                  aria-label="Execution snapshot"
                >
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Execution snapshot
                  </p>
                  <p>
                    <span className="font-semibold text-slate-200">{symbol}</span> ·{" "}
                    {side === "SELL" ? "EXIT" : side} · {quantity} @ ₹{parseFloat(price || "0").toFixed(2)}
                    {side === "BUY" ? ` · ${productType}` : ""}
                    {side === "BUY"
                      ? ` · SL ₹${parseFloat(stopLoss || "0").toFixed(2)} · TP ₹${parseFloat(target || "0").toFixed(2)}`
                      : ""}
                    {preTradeEmotion ? <span className="text-slate-500"> · {preTradeEmotion}</span> : null}
                  </p>
                </section>
                <ExecutionConsequenceBlock />
                <ExecutionReadinessPanel
                  outcome={reviewJudgmentOutcome}
                  inlineNote={reviewJudgmentMessage || undefined}
                  rows={reviewReadinessRows}
                  mode="server"
                  side={side}
                  price={price}
                  quantity={quantity}
                  stopLoss={stopLoss}
                  target={target}
                  thesis={thinking}
                  thesisMin={thesisMin}
                  preTradeEmotion={preTradeEmotion}
                  scalingBlocked={scalingBlocked}
                  snapshot={snap}
                  authorityVerdict={authorityVerdict}
                  analyzing={false}
                />
              </>
            )}

            {phase === "EXECUTING" && (
              <div className="trade-terminal-center">
                <Loader size={28} className="dp-spinner" aria-hidden />
                <p className="trade-terminal-center__title">Executing trade</p>
                <p className="trade-terminal-center__sub">
                  {side} · {symbol}
                </p>
              </div>
            )}

            {phase === "SUCCESS" && (
              <div className="trade-terminal-center">
                <CheckCircle size={36} className="trade-terminal-center__ok" aria-hidden />
                <p className="trade-terminal-center__title">
                  {submissionOutcome === "queued" ? "Order queued" : "Execution accepted"}
                </p>
                <p className="trade-terminal-center__sub">
                  {submissionOutcome === "queued"
                    ? "Order queued for the next market open (09:15 IST). Cash remains reserved until execution or expiry."
                    : reflectionPending
                      ? "Execution committed. Reflection and journal synchronization are still processing."
                      : "Execution and reflection complete. Portfolio and journal refresh automatically."}
                </p>
              </div>
            )}

            {phase === "ERROR" && (
              <div className="flex items-start gap-2 rounded-lg border border-slate-800/80 bg-slate-900/35 px-3 py-2 text-sm text-slate-200">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-300" aria-hidden />
                <p className="min-w-0 leading-snug">
                  <span className="font-semibold">
                    {canRetryExecuteSubmit ? "Submit did not complete." : "Execution blocked."}
                  </span>{" "}
                  <span className="text-slate-300">{errorMsg || "System could not complete this step."}</span>
                </p>
              </div>
            )}
          </div>

          {phase === "SETUP" && (
            <TradeExecutionBar
              stateHeadline={
                setupGateState === "locked_market"
                  ? "Execution locked"
                  : setupGateState === "ready_analyze"
                    ? "Ready for risk check"
                    : "Complete requirements"
              }
              primaryLabel="Run risk check"
              canPrimary={canAnalyze}
              onPrimary={handleAnalyze}
              onCancel={onClose}
            />
          )}

          {phase === "REVIEW" && snap && (
            <TradeExecutionBar
              stateHeadline={canExecute ? "Ready to execute" : "Complete requirements"}
              primaryLabel={canExecute ? "Execute trade" : "Complete requirements"}
              canPrimary={canExecute}
              onPrimary={handleExecute}
              onCancel={onClose}
            />
          )}

          {(phase === "ANALYZING" || phase === "EXECUTING") && (
            <TradeExecutionBar
              stateHeadline="Working"
              stateDetail={phase === "ANALYZING" ? "Server risk evaluation in progress." : "Sending order to the broker path."}
              primaryLabel=""
              canPrimary={false}
              onCancel={onClose}
              showPrimary={false}
            />
          )}

          {phase === "ERROR" && (
            <TradeExecutionBar
              stateHeadline={canRetryExecuteSubmit ? "Submit failed (you can retry)" : "Execution blocked"}
              stateDetail={errorMsg || undefined}
              primaryLabel={canRetryExecuteSubmit ? "Retry submit" : "Return to setup"}
              canPrimary
              onPrimary={() => {
                if (canRetryExecuteSubmit) {
                  void handleExecute();
                } else {
                  setPreTrade(null);
                  setEvaluation(null);
                  setPhase("SETUP");
                  setErrorMsg("");
                  setExecuteFailMeta(null);
                }
              }}
              secondaryLabel={canRetryExecuteSubmit ? "Return to setup" : undefined}
              canSecondary={canRetryExecuteSubmit}
              onSecondary={() => {
                setPreTrade(null);
                setEvaluation(null);
                setPhase("SETUP");
                setErrorMsg("");
                setExecuteFailMeta(null);
              }}
              onCancel={onClose}
            />
          )}

          {phase === "SUCCESS" && (
            <TradeExecutionBar
              stateHeadline="Order submitted"
              stateDetail={
                submissionOutcome === "queued"
                  ? "Queued for session open."
                  : reflectionPending
                    ? "Execution complete. Reflection pending."
                    : "Execution and reflection complete."
              }
              primaryLabel=""
              canPrimary={false}
              onCancel={onClose}
              showPrimary={false}
            />
          )}
        </div>
      </div>
    </TradePanelOverlay>
  );
}
