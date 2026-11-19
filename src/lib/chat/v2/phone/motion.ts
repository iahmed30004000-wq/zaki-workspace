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

/** More rows than this moving at once is a new list (a folder, a search), not a row finding its place. */
export const MAX_FLIP_ROWS = 40;

/**
 * The rows that were drawn before AND are drawn now at a different offset: each slides from where it was to where it is. A row that is new, or one that
 * stands still, does not move. Too many at once (`max`) means the whole list changed: nothing slides.
 */
export function flipMoves(prev: ReadonlyMap<string | number, number>, next: ReadonlyMap<string | number, number>, max: number = MAX_FLIP_ROWS): FlipMove[] {
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
