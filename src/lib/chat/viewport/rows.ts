import type { MessageDto } from "@/lib/chat/cache/types";
import { opensDay } from "@/lib/chat/day-separator";

/**
 * C1.7 — the rows of the virtual list: the messages, with a day row where a new day starts and the «رسائل غير مقروءة» row above the
 * first unread message. Pure; the caller memoizes it on the messages.
 *
 * Keys are stable: a message row's key is the message id, a day row's key is `day:<the message that opens the day>`, the unread row
 * is `unread`. When an older page is put in front, no row that was there changes its key (the one day row that no longer opens a day
 * goes away) — so the list keeps every measured height and the scroll anchor finds its row.
 */
export type Row =
  | { type: "day"; key: string; at: string }
  | { type: "unread"; key: "unread" }
  | { type: "message"; key: string; message: MessageDto; /** its index among the MESSAGES (what `runFlags` of group.ts is asked) */ index: number };

export function buildRows(messages: readonly MessageDto[], opts: { unreadBeforeId?: string | null } = {}): Row[] {
  const rows: Row[] = [];
  let previous: MessageDto | null = null;
  messages.forEach((message, index) => {
    if (opensDay(message.createdAt, previous?.createdAt ?? null)) rows.push({ type: "day", key: `day:${message.id}`, at: message.createdAt });
    if (opts.unreadBeforeId && message.id === opts.unreadBeforeId) rows.push({ type: "unread", key: "unread" });
    rows.push({ type: "message", key: message.id, message, index });
    previous = message;
  });
  return rows;
}

/** The row of a message, or -1. */
export function rowIndexOfMessage(rows: readonly Row[], messageId: string): number {
  return rows.findIndex((r) => r.type === "message" && r.key === messageId);
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
