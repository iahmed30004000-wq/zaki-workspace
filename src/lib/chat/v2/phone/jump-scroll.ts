/**
 * «تيليجرام على التلفون» — a tap on a quote SLIDES to the original when its row is already drawn (its height has been measured, so the slide ends where it
 * should). A row far away has only an estimated height: the jump to it stays instant, as it was.
 */
export function smoothJumpAllowed(i: { wanted: boolean; targetIndex: number; drawn: readonly number[] }): boolean {
  return i.wanted && i.drawn.includes(i.targetIndex);
}
