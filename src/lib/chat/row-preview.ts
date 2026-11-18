import { ct, ctCount } from "@/lib/chat/text";
import { dayDiff, weekdayName } from "@/lib/format";
import type { ChatRowDto } from "@/lib/chat/cache/types";

/**
 * C2.2 — what ONE row of the chat list says, as pure functions of the row the cache holds (and, for the two things the cache does not
 * hold, of what the screen hands in: who is typing, and the local draft). The row component draws the result and nothing else, so
 * `tests/chat-v2-list-preview.test.ts` can pin every sentence without a browser.
 *
 * Privacy: every word here comes from the row, and the row came from a server that already left out what this person may not read
 * (P0.1, P0.4). A restricted topic is drawn with a lock and the word «خاص», never with who is in it. A message that was deleted says
 * «رسالة محذوفة» and carries no text; the owner's silent reading shows nowhere (the row has no field for it).
 */

/** A day, said the way the row says it: today `HH:MM`, within the last six days the day's name, older `d/M` (Western digits). */
export function rowTimeLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diff = dayDiff(date, now);
  if (diff === 0 || diff === null || diff > 0) return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (diff >= -6) return weekdayName(date.getDay());
  return `${date.getDate()}/${date.getMonth() + 1}`;
}

export type PreviewTone = "typing" | "draft" | "text" | "empty" | "deleted";

export interface RowPreview {
  tone: PreviewTone;
  /** «فلان» / «أنت» in front of the words (topics, groups and spaces; never a private chat or a system line); null when there is none */
  author: string | null;
  text: string;
}

const squash = (text: string, max = 140): string => text.replace(/\s+/g, " ").trim().slice(0, max);

/** «عم يكتب…» for a private chat; «فلان عم يكتب…» in a topic, a group or a space (two people: both names). */
export function typingText(names: readonly string[], row: Pick<ChatRowDto, "kind">): string {
  if (row.kind === "DM" || names.length === 0) return ct("chatui.row.typing");
  if (names.length === 1) return ct("chatui.row.typing_one", { name: names[0]! });
  return ct("chatui.row.typing_many", { names: names.slice(0, 2).join("، ") });
}

/**
 * The second line of a row. Order of strength, as in the spec: somebody typing, then my own unsent draft («مسودة: …»), then the newest
 * message. `typingNames` and `draft` come from the screen (the live line and the composer's draft store); both are optional.
 */
export function rowPreview(row: ChatRowDto, extra: { typingNames?: readonly string[]; draft?: string | null } = {}): RowPreview {
  if (extra.typingNames && extra.typingNames.length > 0) return { tone: "typing", author: null, text: typingText(extra.typingNames, row) };
  const draft = squash(extra.draft ?? "", 80);
  if (draft) return { tone: "draft", author: null, text: draft };
  const last = row.lastMessage;
  if (!last) return { tone: "empty", author: null, text: ct(row.kind === "DM" ? "chath.start" : "chath.no_messages") };
  // a system line is a sentence of its own («فلان ثبّت رسالة»): no author in front of it
  if (last.kind === "SYSTEM") return { tone: "text", author: null, text: squash(last.preview ?? "") };
  const author = row.kind === "DM" ? null : last.mine ? ct("chatui.row.you") : last.authorName || null;
  if (last.kind === "VOICE") return { tone: "text", author, text: ct("chatui.row.voice") };
  // the server sends `null` for a deleted message (and never its text)
  if (last.preview === null) return { tone: "deleted", author, text: ct("chatui.row.deleted") };
  const words = squash(last.preview);
  if (last.kind === "POLL") return { tone: "text", author, text: ct("chatui.row.poll", { text: words }) };
  if (last.kind === "CARD") return { tone: "text", author, text: words ? ct("chatui.row.card", { text: words }) : ct("chatui.row.card_plain") };
  // a message with a file and no words has an empty preview
  if (words === "") return { tone: "text", author, text: ct("chatui.row.attachment") };
  return { tone: "text", author, text: words };
}

export type RowMarkKey = "muted" | "restricted" | "team" | "announcements" | "closed";

export interface RowMark {
  key: RowMarkKey;
  /** the key of the icon's spoken name in `ar.chat-ui.json` */
  labelKey: string;
}

/** The small icons after the title: muted, private (lock), for a «مقطع» (people), an announcements topic (megaphone), closed. */
export function rowMarks(row: ChatRowDto): RowMark[] {
  const out: RowMark[] = [];
  if (row.kind === "TOPIC") {
    if (row.restricted) out.push({ key: "restricted", labelKey: "chatui.row.private" });
    else if (row.teamId) out.push({ key: "team", labelKey: "chatui.row.team" });
    if (row.topicType === "ANNOUNCEMENTS") out.push({ key: "announcements", labelKey: "chatui.row.announcements" });
    if (row.closed) out.push({ key: "closed", labelKey: "chatui.row.closed" });
  }
  if (row.muted) out.push({ key: "muted", labelKey: "chatui.row.muted" });
  return out;
}

export type RowTicks = "sent" | "delivered" | "read";

/** The ticks of MY last message: the server's status in a private chat; a single tick where it knows no status (a topic, a group). */
export function rowTicks(row: ChatRowDto): RowTicks | null {
  const last = row.lastMessage;
  if (!last || !last.mine || last.kind === "SYSTEM") return null;
  return last.status ?? "sent";
}

export function rowTicksLabel(ticks: RowTicks): string {
  return ct(`chatui.row.ticks_${ticks}`);
}

/** The pin icon: shown only when nothing is unread (the pill takes its place otherwise). Personal pin (C3a, false today) or the managers' pin of a topic. */
export function rowPinned(row: ChatRowDto): boolean {
  return row.pinnedByMe || (row.kind === "TOPIC" && row.pinned === true);
}

/** What the unread pill says (`99+` past 99; the count is the row's own). */
export function unreadText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** What the screen reader says for a row, in one sentence: the title, what is unread, and the time. */
export function rowSpokenLabel(row: ChatRowDto, now: Date = new Date()): string {
  const parts = [row.title];
  if (row.unread > 0) parts.push(ctCount("chatui.row.unread", row.unread));
  if (row.mentionsUnread > 0) parts.push(ct("chatui.row.mention"));
  const when = rowTimeLabel(row.lastMessage?.at, now);
  if (when) parts.push(when);
  return parts.join("، ");
}
