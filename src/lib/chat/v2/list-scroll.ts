/** Under this much travel nothing is decided (a trembling finger must not make the round button blink). */
export const SCROLL_SLOP_PX = 8;
/** This close to the top the list counts as at the top, whatever way it was going. */
export const SCROLL_TOP_PX = 12;

/** Going from `from` to `to`: true is «down, put the buttons away», false «back», null «not enough to say». */
export function scrollDirection(from: number, to: number): boolean | null {
  if (to <= SCROLL_TOP_PX) return false;
  if (Math.abs(to - from) < SCROLL_SLOP_PX) return null;
  return to > from;
}
