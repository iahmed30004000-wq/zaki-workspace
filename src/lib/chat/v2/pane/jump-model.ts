import type { MessageDto } from "@/server/chat/dto";
import { isMentioned } from "@/lib/chat/conversation/mentions";

/**
 * C2.4 — the two round buttons at the end of the viewport, as pure functions.
 *
 *   «↓»  appears when the person is not at the newest message: with the unread counter when something came, or «آخر الرسائل» when only the windows
 *        do not reach it (a jump to an old message). The counter is the larger of the server's number (the row's `unread`, it wins) and what arrived
 *        while the person was reading older messages (`newBelow`, which is what the old screen counted).
 *   «@»  appears while the row says somebody mentioned me and I did not read it; it goes to the next such message, one tap each.
 */

export interface DownButton {
  show: boolean;
  count: number;
  /** `unread`: it carries the counter; `newest`: it says «آخر الرسائل» */
  kind: "unread" | "newest";
}

export function jumpButtonsOf(s: { atBottom: boolean; atNewest: boolean; unread: number; newBelow: number }): { down: DownButton } {
  const count = Math.max(0, s.unread, s.newBelow);
  const show = !s.atBottom || !s.atNewest;
  return { down: { show, count: show ? count : 0, kind: count > 0 ? "unread" : "newest" } };
}

/**
 * The messages the «@» button goes to: the NEWEST `unreadMentions` messages that mention me (the unread ones are always the newest ones), among the
 * messages that are loaded. Not mine, not deleted.
 */
export function mentionTargetsOf(messages: readonly MessageDto[], meId: string | undefined, unreadMentions: number): string[] {
  if (!meId || unreadMentions <= 0) return [];
  const mine = messages.filter((m) => !m.mine && !m.deleted && isMentioned(m.mentions, meId)).map((m) => m.id);
  return mine.slice(-unreadMentions);
}

export interface MentionsButton {
  show: boolean;
  count: number;
  /** the next message to go to; null when none is loaded (the number still shows) */
  target: string | null;
}

export function mentionsButtonOf(s: { mentionsUnread: number; targets: readonly string[]; visited: readonly string[] }): MentionsButton {
  if (s.mentionsUnread <= 0) return { show: false, count: 0, target: null };
  const remaining = s.targets.filter((id) => !s.visited.includes(id));
  // only a visited message that is STILL among the unread ones is taken off the number: one the server has marked read since is already out of it
  const visitedStillUnread = s.targets.filter((id) => s.visited.includes(id)).length;
  const count = Math.max(remaining.length, s.mentionsUnread - visitedStillUnread);
  return { show: count > 0, count, target: remaining[0] ?? null };
}
