import { stripFormatting } from "@/lib/chat/format/parse";
import { ct, ctCount } from "@/lib/chat/text";
import { dayDiff, weekdayName } from "@/lib/format";
import type { ChatRowDto } from "@/lib/chat/cache/types";
import type { PostingPolicy } from "@/server/chat/dto";
import { hasUnread } from "@/lib/chat/cache/unread";
import { CHECKLIST_KIND } from "@/lib/chat/checklist";

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

/**
 * One line of words. C3b.1: the formatting markers are removed BEFORE the cut (`**`, `~~`, a link's `[label](address)`; a spoiler becomes «•••»; leftover math
 * markup becomes plain characters; the server cut the preview at 140 characters, so a marker still open at its end is closed there: `partial`). A system sentence is not formatting, so it passes `format = false`.
 */
const squash = (text: string, max = 140, format = true): string => (format ? stripFormatting(text, { math: true, partial: true }) : text).replace(/\s+/g, " ").trim().slice(0, max);

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
  if (last.kind === "SYSTEM") return { tone: "text", author: null, text: squash(last.preview ?? "", 140, false) };
  const author = row.kind === "DM" ? null : last.mine ? ct("chatui.row.you") : last.authorName || null;
  // the server sends `null` for a deleted message of ANY kind (the body column is never null, so a live voice note has an empty preview, not a null one):
  // a deleted voice note, poll or card says «رسالة محذوفة» and nothing of what it was
  if (last.preview === null) return { tone: "deleted", author, text: ct("chatui.row.deleted") };
  if (last.kind === "VOICE") return { tone: "text", author, text: ct("chatui.row.voice") };
  const words = squash(last.preview);
  if (last.kind === "POLL") return { tone: "text", author, text: ct("chatui.row.poll", { text: words }) };
  // «قائمة مهام» (C3c.1): the TITLE and, where the row carries it, the count of the done items — never an item's words
  if (last.kind === CHECKLIST_KIND) return { tone: "text", author, text: last.checklist ? ct("chatcl.row", { text: words, done: last.checklist.done, total: last.checklist.total }) : ct("chatcl.row_plain", { text: words }) };
  if (last.kind === "CARD") return { tone: "text", author, text: words ? ct("chatui.row.card", { text: words }) : ct("chatui.row.card_plain") };
  // a message with a file and no words has an empty preview
  if (words === "") return { tone: "text", author, text: ct("chatui.row.attachment") };
  return { tone: "text", author, text: words };
}

export type RowMarkKey = "muted" | "restricted" | "team" | "announcements" | "closed" | "archived";

export interface RowMark {
  key: RowMarkKey;
  /** the key of the icon's spoken name in `ar.chat-ui.json` */
  labelKey: string;
}

/**
 * C3c.4 — a CHANNEL («قناة»): a topic of type ANNOUNCEMENTS whose posting policy is «للمشرفين» (ADMINS). No schema and no new field: it is a name for two
 * fields the topic already has. It is only a LOOK (the megaphone and the word); WHO may post is never decided here — the composer comes from the
 * server's `me.canPost`.
 */
export function isChannelTopic(c: { kind?: string; topicType?: string | null; postingPolicy?: PostingPolicy | null }): boolean {
  return c.kind === "TOPIC" && c.topicType === "ANNOUNCEMENTS" && c.postingPolicy === "ADMINS";
}

/**
 * The word «قناة» for a LIST row, or null. The list row (C1.2) does not carry `postingPolicy` yet (the list query reads it, the row type has no field), so a row
 * that has none is read with the server's own default for an announcements topic, which is «للمشرفين»; a row that does carry it (`ALL`) is not a channel.
 * The day the row type gets the field, nothing here changes.
 */
export function rowChannelWord(row: ChatRowDto & { postingPolicy?: PostingPolicy | null }): string | null {
  return isChannelTopic({ kind: row.kind, topicType: row.topicType, postingPolicy: row.postingPolicy ?? "ADMINS" }) ? ct("chatch.word") : null;
}

/** The small icons after the title: muted, archived (C3a.1: shown in the «الأرشيف» tab), private (lock), for a «مقطع» (people), an announcements topic (megaphone), closed. */
export function rowMarks(row: ChatRowDto): RowMark[] {
  const out: RowMark[] = [];
  if (row.kind === "TOPIC") {
    if (row.restricted) out.push({ key: "restricted", labelKey: "chatui.row.private" });
    else if (row.teamId) out.push({ key: "team", labelKey: "chatui.row.team" });
    if (row.topicType === "ANNOUNCEMENTS") out.push({ key: "announcements", labelKey: "chatui.row.announcements" });
    if (row.closed) out.push({ key: "closed", labelKey: "chatui.row.closed" });
  }
  if (row.muted) out.push({ key: "muted", labelKey: "chatui.row.muted" });
  if (row.archivedByMe) out.push({ key: "archived", labelKey: "chatps.row.archived" });
  return out;
}

// ───────────────────────────────────────── C3a.1: my own pin, archive, mark unread and mute ─────────────────────────────────────────

/**
 * The mute presets of a row's menu, counted from now: an hour, 8 hours, a day, a week, for good. «للأبد» is a date a hundred years away (the column holds a
 * date, never a flag): the server cuts anything further.
 */
export const MUTE_PRESETS = [
  { key: "hour", labelKey: "chatps.mute.hour", ms: 3_600_000 },
  { key: "hours8", labelKey: "chatps.mute.hours8", ms: 8 * 3_600_000 },
  { key: "day", labelKey: "chatps.mute.day", ms: 24 * 3_600_000 },
  { key: "week", labelKey: "chatps.mute.week", ms: 7 * 24 * 3_600_000 },
  { key: "forever", labelKey: "chatps.mute.forever", ms: 100 * 365 * 24 * 3_600_000 },
] as const;

/** The moment a preset's mute ends, as the ISO time `PUT …/me` takes. */
export function mutedUntilOf(preset: (typeof MUTE_PRESETS)[number], now: Date = new Date()): string {
  return new Date(now.getTime() + preset.ms).toISOString();
}

/**
 * What the personal part of a row's menu offers, from the row alone: each item says which way it goes (pin or unpin, archive or take out, mark unread or read,
 * the mute presets or lift the mute). A space row is not a conversation: it has none. A chat with something unread, or one marked unread by hand, offers
 * «علّم كمقروء» (with real unread messages it is the read mark; with only the hand mark it clears the mark).
 */
export interface PersonalOffers {
  pin: "pin" | "unpin";
  archive: "archive" | "unarchive";
  read: "unread" | "read";
  mute: "presets" | "lift";
}

export function personalOffers(row: ChatRowDto): PersonalOffers | null {
  if (row.kind === "SPACE") return null;
  return {
    pin: row.pinnedByMe ? "unpin" : "pin",
    archive: row.archivedByMe ? "unarchive" : "archive",
    read: hasUnread(row) ? "read" : "unread",
    mute: row.muted ? "lift" : "presets",
  };
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

/** The pin icon: shown only when nothing is unread (the pill takes its place otherwise). My own pin (C3a.1) or the managers' pin of a topic. */
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

/**
 * The labels of a row depend on the DAY («09:05» today, the day's name this week, `d/M` before): a row drawn in the morning must roll over at midnight even
 * if its own data never changes. The list holds one `dayKey` and gives it to every row, so the rows (which are memoized) re-draw once a day and not before.
 */
export function dayKeyOf(date: Date = new Date()): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/** Milliseconds from `date` to the next local midnight (at least one second, so a timer set at 23:59:59.999 still lands on the next day). */
export function msUntilNextDay(date: Date = new Date()): number {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0);
  return Math.max(1000, next.getTime() - date.getTime() + 500);
}
