import type { MessageDto } from "@/lib/chat/cache/types";
import { opensDay } from "@/lib/chat/day-separator";

/**
 * C2.4 — call lines that fold. The server writes a system line when a call starts («بلّش فلان مكالمة»), ends («خلصت المكالمة») or is missed; a
 * chat with many calls shows a dozen of them in a row (seen live). A RUN of them is drawn as ONE chip («6 مكالمات») that opens the list, so the
 * conversation reads as a conversation. Pure: the rows builder asks for the runs, the screen draws the chip.
 *
 * What folds: three lines or more in a row (one call is a start and an end: two quiet lines stay two quiet lines), only consecutive messages
 * of one day (the day row between two days keeps its place), and never across a place the caller wants a row to stand above (the unread line).
 */

export const CALL_KEYS = ["call_started", "call_ended", "call_missed"] as const;

/** A run folds from this many lines on. */
export const FOLD_MIN_LINES = 3;

/** Is this message one of the system lines a call writes? */
export function isCallLine(m: Pick<MessageDto, "kind" | "system">): boolean {
  return m.kind === "SYSTEM" && !!m.system && (CALL_KEYS as readonly string[]).includes(m.system.k);
}

/**
 * The runs to fold, as index ranges `[from, to)` of `messages`. `breakBefore(i)` says that a run may not continue into message `i` (the caller's
 * own boundary: the line «رسائل غير مقروءة» goes between two lines); a new day always breaks a run.
 */
export function callRuns(messages: readonly MessageDto[], opts: { breakBefore?: (index: number) => boolean } = {}): { from: number; to: number }[] {
  const runs: { from: number; to: number }[] = [];
  let from = -1;
  const close = (to: number) => {
    if (from >= 0 && to - from >= FOLD_MIN_LINES) runs.push({ from, to });
    from = -1;
  };
  messages.forEach((m, i) => {
    if (!isCallLine(m)) return close(i);
    const broken = from >= 0 && (opts.breakBefore?.(i) === true || opensDay(m.createdAt, messages[i - 1]!.createdAt));
    if (broken) close(i);
    if (from < 0) from = i;
  });
  close(messages.length);
  return runs;
}

/**
 * How many calls a run holds: the starts and the missed ones, or the ends when their starts are above the window — whichever is larger, so six
 * starts and six ends are six calls and an end whose start was not loaded still counts.
 */
export function callCount(lines: readonly Pick<MessageDto, "system">[]): number {
  let started = 0;
  let ended = 0;
  for (const m of lines) {
    const k = m.system?.k;
    if (k === "call_started" || k === "call_missed") started += 1;
    else if (k === "call_ended") ended += 1;
  }
  return Math.max(started, ended);
}
