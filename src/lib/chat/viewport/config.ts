/** C1.7 — how many rows are drawn beyond the screen on each side (the spec's value). */
export const OVERSCAN = 10;

/**
 * A scroll signal whose message is not in the rows (it was cut by the cap, or the conversation changed) is given up after this long:
 * while it waits, paging is held back (nothing is asked for while a landing is on its way), so it must never wait for ever.
 */
export const PENDING_SCROLL_MS = 2000;

export function pendingExpired(since: number, now: number, limit: number = PENDING_SCROLL_MS): boolean {
  return now - since >= limit;
}
