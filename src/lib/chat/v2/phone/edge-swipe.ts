/**
 * C2.8 — the swipe from the START edge that goes back, as pure rules (the hook that listens to the finger is `use-edge-swipe.ts`).
 *
 * The finger must begin inside a thin strip along the START edge of the screen (the right edge in this right-to-left layout), so it never steals the
 * horizontal scrolling of a table or a picture in the middle of the page, and it must travel toward the inline END (inward, leftwards here) more than it
 * travels up or down. `rtl` is the page's direction, read by the caller (`document.documentElement.dir`), so the same rules hold in a left-to-right page.
 */

/** The strip along the start edge in which a swipe may begin. */
export const EDGE_PX = 24;
/** A pull this long goes back whatever its speed. */
export const COMMIT_PX = 72;
/** A pull at least this long goes back when it was quick (a flick)… */
export const FLICK_PX = 32;
/** …quicker than this many pixels per millisecond. */
export const FLICK_PX_PER_MS = 0.5;
/** Movement under this decides nothing yet (a tap, a trembling finger). */
export const SLOP_PX = 10;
/** Sideways travel must beat vertical travel by this factor to be a swipe and not a scroll. */
export const SLOPE = 1.5;

export function atStartEdge(x: number, width: number, rtl: boolean): boolean {
  return rtl ? x >= width - EDGE_PX : x <= EDGE_PX;
}

/** How far the finger has gone toward the inline END since it started at `fromX` (negative: it went back toward the edge). */
export function inwardOf(fromX: number, x: number, rtl: boolean): number {
  return rtl ? fromX - x : x - fromX;
}

/** The screen follows the finger inward only: never outward past where it stands. */
export function dragOffset(inward: number): number {
  return inward > 0 ? inward : 0;
}

export type SwipeIntent = "undecided" | "swipe" | "scroll";

/** Once the finger has moved a little: is this the back swipe, or the page's own vertical scroll (or a drag the wrong way)? */
export function swipeIntent(inward: number, dy: number): SwipeIntent {
  const down = Math.abs(dy);
  if (Math.max(Math.abs(inward), down) < SLOP_PX) return "undecided";
  return inward > 0 && inward > down * SLOPE ? "swipe" : "scroll";
}

/** On release: does it go back? A long pull, or a short quick one; never a diagonal one, never one that went the wrong way. */
export function commitsBack({ inward, dy, ms }: { inward: number; dy: number; ms: number }): boolean {
  if (!(inward > 0) || !(inward > Math.abs(dy) * SLOPE)) return false;
  if (inward >= COMMIT_PX) return true;
  return inward >= FLICK_PX && inward / Math.max(ms, 1) >= FLICK_PX_PER_MS;
}
