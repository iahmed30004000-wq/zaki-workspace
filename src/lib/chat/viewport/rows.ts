import type { MessageDto } from "@/lib/chat/cache/types";
import { opensDay } from "@/lib/chat/day-separator";
import { callRuns } from "@/lib/chat/viewport/calls";

/**
 * C1.7 — the rows of the virtual list: the messages, with a day row where a new day starts and the «رسائل غير مقروءة» row above the
 * first unread message. Pure; the caller memoizes it on the messages.
 *
 * Keys are stable: a message row's key is the message id, a day row's key is `day:<the message that opens the day>`, the unread row
 * is `unread`. When an older page is put in front, no row that was there changes its key (the one day row that no longer opens a day
 * goes away) — so the list keeps every measured height and the scroll anchor finds its row.
 *
 * C2.4: with `foldCalls` a run of call lines is ONE `calls` row (key `calls:<its first line>`), see `calls.ts`. Off by default: C1.7's rows are
 * exactly what they were.
 */
export type Row =
  | { type: "day"; key: string; at: string }
  | { type: "unread"; key: "unread" }
  | { type: "message"; key: string; message: MessageDto; /** its index among the MESSAGES (what `runFlags` of group.ts is asked) */ index: number }
  /** a folded run of call lines; `index` is the index of its first line among the MESSAGES */
  | { type: "calls"; key: string; messages: MessageDto[]; index: number };

export function buildRows(messages: readonly MessageDto[], opts: { unreadBeforeId?: string | null; foldCalls?: boolean } = {}): Row[] {
  const rows: Row[] = [];
  const runs = new Map<number, number>();
  if (opts.foldCalls) {
    const unread = opts.unreadBeforeId ?? null;
    for (const run of callRuns(messages, { breakBefore: (i) => unread !== null && messages[i]!.id === unread })) runs.set(run.from, run.to);
  }
  let previous: MessageDto | null = null;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (opensDay(message.createdAt, previous?.createdAt ?? null)) rows.push({ type: "day", key: `day:${message.id}`, at: message.createdAt });
    if (opts.unreadBeforeId && message.id === opts.unreadBeforeId) rows.push({ type: "unread", key: "unread" });
    const to = runs.get(index);
    if (to !== undefined) {
      rows.push({ type: "calls", key: `calls:${message.id}`, messages: messages.slice(index, to), index });
      previous = messages[to - 1]!;
      index = to - 1;
      continue;
    }
    rows.push({ type: "message", key: message.id, message, index });
    previous = message;
  }
  return rows;
}

/** The messages a row holds: one, or the lines of a folded run. */
export function messagesOfRow(row: Row): readonly MessageDto[] {
  return row.type === "message" ? [row.message] : row.type === "calls" ? row.messages : [];
}

/** The row of a message, or -1 (a line inside a folded run is at the chip's row). */
export function rowIndexOfMessage(rows: readonly Row[], messageId: string): number {
  return rows.findIndex((r) => (r.type === "message" ? r.key === messageId : r.type === "calls" && r.messages.some((m) => m.id === messageId)));
}

/**
 * The row a «scroll to this message» signal goes to. Aligned to the top (the unread landing) with the «رسائل غير مقروءة» line right
 * above the message, it is the LINE: the line is what the landing exists to show, and it would be scrolled out of sight above the top
 * edge if the message itself were put there.
 */
export function scrollRowIndex(rows: readonly Row[], messageId: string, align: "start" | "center"): number {
  const at = rowIndexOfMessage(rows, messageId);
  if (at > 0 && align === "start" && rows[at - 1]!.type === "unread") return at - 1;
  return at;
}
