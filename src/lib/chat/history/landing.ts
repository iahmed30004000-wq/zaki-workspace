import type { MessagesPageDto } from "@/lib/chat/cache/types";

/**
 * C1.6 — WHERE a conversation opens. Pure.
 *
 * The server sends `firstUnreadId` with every window: the oldest message after the person's read mark that is not theirs, not deleted
 * and not a system line; null when there is none, or when the person has no read mark here (nothing is «unread» to land on).
 *
 *   no firstUnreadId                          → the newest window, the bottom
 *   firstUnreadId inside the newest window    → that window; land on that message
 *   firstUnreadId outside the newest window   → one more request, `around=firstUnreadId`; land on that message
 *
 * Showing «رسائل غير مقروءة» above the message is the screen's (C2.4); the rule and the data are here.
 */

/** What a conversation opened on. `message`: a link or a search hit (`?m=`), not the unread rule. */
export type Landing =
  | { kind: "newest"; messageId: null }
  | { kind: "unread"; messageId: string }
  | { kind: "message"; messageId: string };

export const NEWEST: Landing = { kind: "newest", messageId: null };

export type LandingRule = { kind: "newest" } | { kind: "unread-inside"; id: string } | { kind: "unread-outside"; id: string };

/** The rule, applied to the NEWEST window of a conversation as the server answered it. */
export function landingRule(newestWindow: Pick<MessagesPageDto, "messages" | "firstUnreadId">): LandingRule {
  const id = newestWindow.firstUnreadId;
  if (!id) return { kind: "newest" };
  return newestWindow.messages.some((m) => m.id === id) ? { kind: "unread-inside", id } : { kind: "unread-outside", id };
}

/** The message the «رسائل غير مقروءة» line goes right above: only when the person landed on the unread message. */
export function separatorBefore(landing: Landing | null): string | null {
  return landing?.kind === "unread" ? landing.messageId : null;
}
