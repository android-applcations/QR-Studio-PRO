import { flushSync } from "react-dom";

type VT = Document & { startViewTransition?: (cb: () => void) => unknown };

/** Runs a state update inside a View Transition (hero animation) when supported & allowed. */
export function withTransition(update: () => void): void {
  const d = document as VT;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!d.startViewTransition || reduced) {
    update();
    return;
  }
  try {
    d.startViewTransition(() => {
      flushSync(update);
    });
  } catch {
    update();
  }
}

export const HERO = "qr-hero";
