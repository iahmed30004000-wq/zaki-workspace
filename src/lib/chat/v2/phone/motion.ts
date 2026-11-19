/**
 * C2.8 — motion («الحركة»), the pure part. The spec (C2-chat-ui.md §9): a row that moves on a new message slides 150 ms (FLIP), a bubble that arrives fades
 * up 120 ms, a reaction pops 150 ms, a screen of the phone slides in 200 ms. ALL of it is off under `prefers-reduced-motion`: the classes carry
 * `motion-reduce:animate-none`, and the two script-driven ones (the FLIP and the swipe's snap-back) ask `prefersReducedMotion()` first.
 * The numbers here and the keyframes in `tailwind.config.ts` are pinned together by `tests/chat-v2-motion-model.test.ts`.
 */

export const FLIP_MS = 150;
export const FADE_UP_MS = 120;
export const POP_MS = 150;
export const SLIDE_MS = 200;

/** A message created within this long of the moment its bubble is drawn has just ARRIVED (opening a chat or scrolling up draws old ones: no motion). */
export const FRESH_WINDOW_MS = 4000;
/** The server's clock and the phone's differ a little: a message a second or two «in the future» is still just now. */
const FUTURE_SLACK_MS = 5000;

export function isFreshArrival(createdAt: string, now: number): boolean {
  const at = Date.parse(createdAt);
  if (!Number.isFinite(at)) return false;
  const age = now - at;
  return age >= -FUTURE_SLACK_MS && age <= FRESH_WINDOW_MS;
}

/** One string for what the chips under a message show; it changes exactly when a chip would look different. */
export function reactionSignature(reactions: readonly { emoji: string; count: number; mine: boolean }[]): string {
  return reactions.map((r) => `${r.emoji}:${r.count}:${r.mine ? 1 : 0}`).join("|");
}

export interface FlipMove {
  key: string | number;
  from: number;
  to: number;
}

/** More rows than this moving at once is a new list, not a row finding its place (a safety net: the virtual list never draws many more than this). */
export const MAX_FLIP_ROWS = 40;
/**
 * How many rows may ENTER or LEAVE the drawn window between two renders for the change to still be one row finding its place. A new message sends one row
 * to the top: at most one row comes in at the top (or none, when it was already drawn) and one falls out at the bottom of the window. A folder switch or a
 * search keystroke changes most of the window: that is a new list, and nothing slides (the cap above alone could never say so: the window holds fewer rows).
 */
export const MAX_FLIP_CHURN = 2;

/**
 * The rows that were drawn before AND are drawn now at a different offset: each slides from where it was to where it is. A row that is new, or one that
 * stands still, does not move. When the window of drawn rows changed too much (`maxChurn`) or too many rows moved (`max`), the whole list changed: nothing slides.
 */
export function flipMoves(
  prev: ReadonlyMap<string | number, number>,
  next: ReadonlyMap<string | number, number>,
  max: number = MAX_FLIP_ROWS,
  maxChurn: number = MAX_FLIP_CHURN,
): FlipMove[] {
  let churn = 0;
  for (const key of prev.keys()) if (!next.has(key)) churn += 1;
  for (const key of next.keys()) if (!prev.has(key)) churn += 1;
  if (churn > maxChurn) return [];
  const moves: FlipMove[] = [];
  for (const [key, to] of next) {
    const from = prev.get(key);
    if (from !== undefined && from !== to) moves.push({ key, from, to });
  }
  return moves.length > max ? [] : moves;
}

/** Does this person ask their device for less motion? (the script-driven animations check it; the classes use `motion-reduce:`) */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
