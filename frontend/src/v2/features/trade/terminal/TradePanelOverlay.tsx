import { useEffect, type ReactNode } from "react";

export type TradePanelOverlayProps = {
  open: boolean;
  onClose: () => void;
  /** Stronger dim + blur (Markets execution mode). */
  backdrop?: "default" | "markets";
  children: ReactNode;
};

export default function TradePanelOverlay({ open, onClose, backdrop = "default", children }: TradePanelOverlayProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const backdropCls =
    backdrop === "markets"
      ? "trade-terminal-backdrop trade-terminal-backdrop--markets"
      : "trade-terminal-backdrop";

  return (
    <div className={backdropCls}>
      {/* Backdrop does not dismiss the terminal — avoids accidental closes. Use Close / Cancel / Escape. */}
      <div className="trade-terminal-shell">{children}</div>
    </div>
  );
}
