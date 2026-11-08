import { motionAllowed, particleBudget, raggedCircle, revealRadius, type FxGate } from "@/lib/themes/switch-fx";

/**
 * The theme change as a torn-edge reveal that grows from where the person pressed.
 *
 * It uses the View Transitions API: the browser snapshots the old page, `apply()` repaints the real one underneath, and the NEW
 * snapshot is revealed through a `clip-path` polygon that grows from radius 0 to past the farthest corner (`raggedCircle`: the
 * same number of points at every size, so the browser can interpolate it). Nothing is drawn by this code per frame — the browser
 * runs one compositor animation — and the sparks are a small canvas for 700 ms (`sparks.ts`, at most 60 particles).
 *
 * No View Transitions (Firefox until recently, older Safari), prefers-reduced-motion, «وضع التوفير» or the feature switched
 * off: `apply()` runs at once and nothing else happens. This file is only fetched when somebody uses the switch.
 */

export interface RevealOptions {
  /** Viewport coordinates the reveal grows from (the pressed knob). */
  origin: { x: number; y: number };
  gate: FxGate;
  /** Varies the torn edge between presses. */
  seed?: number;
}

const DURATION_MS = 700;
const SPARKS_WANTED = 36;

export async function changeThemeWithReveal(apply: () => void, options: RevealOptions): Promise<void> {
  const { origin, gate } = options;
  const seed = options.seed ?? 1;
  if (!motionAllowed(gate) || typeof document === "undefined" || typeof document.startViewTransition !== "function") {
    apply();
    return;
  }
  const root = document.documentElement;
  let applied = false;
  const applyOnce = () => {
    if (applied) return;
    applied = true;
    apply();
  };
  root.classList.add("zk-reveal");
  try {
    const transition = document.startViewTransition(applyOnce);
    try {
      await transition.ready;
      const radius = revealRadius(origin.x, origin.y, window.innerWidth, window.innerHeight);
      root.animate(
        { clipPath: [raggedCircle(origin.x, origin.y, 0, 36, seed), raggedCircle(origin.x, origin.y, radius, 36, seed)] },
        { duration: DURATION_MS, easing: "cubic-bezier(0.22, 0.7, 0.2, 1)", pseudoElement: "::view-transition-new(root)" },
      );
      const count = particleBudget(gate, SPARKS_WANTED);
      if (count > 0) void import("./sparks").then((m) => m.burstSparks({ x: origin.x, y: origin.y, count, seed }));
    } catch {
      // a transition the browser skipped (the tab was hidden): the change itself still happens below
    }
    await transition.finished.catch(() => undefined);
  } catch {
    // startViewTransition refused: fall through to a plain change
  } finally {
    root.classList.remove("zk-reveal");
    applyOnce();
  }
}
