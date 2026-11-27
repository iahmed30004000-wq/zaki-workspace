import { systemSentence } from "@/lib/chat/system-sentence";
import type {
  ChatListDto,
  ChatRowDto,
  MessageDto,
  MessagesData,
  MessagesPageDto,
  ReaderDto,
  SpaceTopicsDto,
} from "@/lib/chat/cache/types";
import type { ChatRowLastMessageDto } from "@/server/chat/dto";

/**
 * C1.4 — the pure half of the writer: functions from the cache's data to its next data. No QueryClient here, so every rule is a
 * unit test with plain objects. `writer.ts` wraps each one in the one `setQueryData` the chat cache has.
 *
 * Every message these functions touch was PRESENTED FOR THIS VIEWER by the server (`presentMessage`): nothing here builds a message
 * from somebody else's data, and a function that takes a conversation only ever looks inside that conversation's own windows.
 */

export const PAGE_SIZE = 50;

// ───────────────────────────────────────── messages ─────────────────────────────────────────

/**
 * What a deleted message keeps: who and when, never what. The server already sends it this way (no text, no files, no reactions,
 * no original, no history); the cache enforces it again on every way in, so nothing a person deleted can come back through a
 * stale copy, and the device copy (C1.5) never holds its text.
 */
export function toTombstone<M extends MessageDto>(m: M): M {
  const { notes: _notes, original: _original, history: _history, poll: _poll, card: _card, work: _work, mustRead: _mustRead, replyTo: _replyTo, forwardedFrom: _forwardedFrom, videoAtSec: _videoAtSec, ...rest } = m;
  void [_notes, _original, _history, _poll, _card, _work, _mustRead, _replyTo, _forwardedFrom, _videoAtSec];
  return { ...rest, deleted: true, edited: false, body: null, attachments: [], reactions: [], mentions: [] } as unknown as M;
}

/** Everything `toTombstone` takes away besides the text, the files and the reactions. */
const TOMBSTONE_DROPS = ["notes", "original", "history", "poll", "card", "work", "mustRead", "replyTo", "forwardedFrom", "videoAtSec"] as const;

/** The same message, or its tombstone when it is deleted (the very same object when there is nothing to strip). */
export function normalizeMessage<M extends MessageDto>(m: M): M {
  if (!m.deleted) return m;
  const dirty =
    m.body !== null ||
    m.edited ||
    m.attachments.length > 0 ||
    m.reactions.length > 0 ||
    m.mentions.length > 0 ||
    TOMBSTONE_DROPS.some((k) => (m as unknown as Record<string, unknown>)[k] !== undefined);
  return dirty ? toTombstone(m) : m;
}

export function normalizePage(page: MessagesPageDto): MessagesPageDto {
  let changed = false;
  const messages = page.messages.map((m) => {
    const n = normalizeMessage(m);
    if (n !== m) changed = true;
    return n;
  });
  return changed ? { ...page, messages } : page;
}

/** Oldest first: `(createdAt, id)`, the order of the server's cursor. */
export function compareMessages(a: Pick<MessageDto, "createdAt" | "id">, b: Pick<MessageDto, "createdAt" | "id">): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface Replacing {
  /** the id of the pending copy that the server's message replaces */
  id?: string;
  /** the `clientId` the pending copy was sent with (the answer carries it back) */
  clientId?: string;
}

function isSame(existing: MessageDto, incoming: MessageDto, replacing?: Replacing): boolean {
  if (existing.id === incoming.id) return true;
  if (replacing?.id && existing.id === replacing.id) return true;
  const clientId = replacing?.clientId ?? incoming.clientId;
  // a clientId is the SENDER's: only two copies of my own message can be the same one
  return !!clientId && existing.clientId === clientId && existing.mine && incoming.mine;
}

export function findInData(data: MessagesData, id: string): { page: number; index: number } | null {
  for (let p = 0; p < data.pages.length; p++) {
    const index = data.pages[p]!.messages.findIndex((m) => m.id === id);
    if (index >= 0) return { page: p, index };
  }
  return null;
}

export function messagesOfData(data: MessagesData): MessageDto[] {
  const seen = new Set<string>();
  const out: MessageDto[] = [];
  for (const page of data.pages) {
    for (const m of page.messages) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

/** The newest message the windows hold, when the last window reaches the newest message of the conversation. */
export function newestKnown(data: MessagesData): MessageDto | null {
  const last = data.pages[data.pages.length - 1];
  if (!last || last.hasNewer) return null;
  return last.messages[last.messages.length - 1] ?? null;
}

function withMessages(data: MessagesData, pageIndex: number, messages: MessageDto[]): MessagesData {
  return { ...data, pages: data.pages.map((p, i) => (i === pageIndex ? { ...p, messages } : p)) };
}

export interface MergeResult {
  data: MessagesData;
  status: "replaced" | "appended" | "skipped";
  /** the `pinned` flag of a message that was already here changed (the header's pinned bar is now stale) */
  pinChanged: boolean;
}

/**
 * Puts one message into the windows of its conversation. A copy that is already there (same id, or the same `clientId` of my own
 * pending message) is replaced IN PLACE; a new one is added only when `append` is true and the last window reaches the newest
 * message — a window opened around an old message does not grow at the wrong end, it learns of the newer ones when it is scrolled to.
 */
export function mergeMessage(data: MessagesData, incoming: MessageDto, opts: { append: boolean; replacing?: Replacing }): MergeResult {
  const message = normalizeMessage(incoming);
  for (let p = 0; p < data.pages.length; p++) {
    const messages = data.pages[p]!.messages;
    const index = messages.findIndex((m) => isSame(m, message, opts.replacing));
    if (index < 0) continue;
    const old = messages[index]!;
    const next = messages.slice();
    next[index] = message;
    return { data: withMessages(data, p, next), status: "replaced", pinChanged: old.pinned !== message.pinned };
  }
  if (!opts.append) return { data, status: "skipped", pinChanged: false };
  const lastIndex = data.pages.length - 1;
  const last = data.pages[lastIndex];
  if (!last || last.hasNewer) return { data, status: "skipped", pinChanged: false };
  let at = last.messages.length;
  while (at > 0 && compareMessages(last.messages[at - 1]!, message) > 0) at--;
  // older than everything of the newest window while older windows exist: it belongs to a window this cache does not hold in order
  if (at === 0 && last.messages.length > 0 && (last.hasOlder || data.pages.length > 1)) return { data, status: "skipped", pinChanged: false };
  const next = last.messages.slice();
  next.splice(at, 0, message);
  return { data: withMessages(data, lastIndex, next), status: "appended", pinChanged: false };
}

/** A message the person (or the server) deleted: its place stays, its content goes; the messages that quoted it lose the quote. */
export function tombstoneInData(data: MessagesData, id: string): MessagesData {
  const at = findInData(data, id);
  const pages = data.pages.map((page, p) => {
    let changed = false;
    const messages = page.messages.map((m, i) => {
      if (at && at.page === p && at.index === i) {
        const t = m.deleted ? normalizeMessage(m) : toTombstone(m);
        if (t !== m) changed = true;
        return t;
      }
      if (m.replyTo?.id === id && !m.replyTo.deleted) {
        changed = true;
        return { ...m, replyTo: { ...m.replyTo, preview: null, deleted: true } };
      }
      return m;
    });
    return changed ? { ...page, messages } : page;
  });
  return pages.some((p, i) => p !== data.pages[i]) ? { ...data, pages } : data;
}

/**
 * S5.7, «حذف عندي»: a message the person hid for themselves leaves THEIR windows (nothing is left in its place: it is not a tombstone, it is as if it never came). What
 * quotes it stays as it is; the unread landing never points at a message that is gone. The very same object when the message is not in the windows.
 */
export function hideInData(data: MessagesData, id: string): MessagesData {
  if (!findInData(data, id)) return data;
  const pages = data.pages.map((page) => {
    if (!page.messages.some((m) => m.id === id)) return page;
    return { ...page, messages: page.messages.filter((m) => m.id !== id), firstUnreadId: page.firstUnreadId === id ? null : page.firstUnreadId };
  });
  return { ...data, pages };
}

/**
 * Read marks and delivery marks of the OTHER people: the ticks of my own messages in a private chat (`status`), and the «who read»
 * avatars under the newest window of a topic. Never my own marks (they move the unread number, not the ticks). `meId` is told by
 * the caller or read from any message of mine in the windows; with neither, ticks are left alone — a wrong tick is worse than an old one.
 */
export function applyMarksToData(
  data: MessagesData,
  marks: { reads: { userId: string; lastReadAt: string }[]; delivered: { userId: string; lastDeliveredAt: string }[] },
  meId?: string,
): MessagesData {
  const me = meId ?? messagesOfData(data).find((m) => m.mine)?.authorId;
  if (!me) return data;
  const readAt = marks.reads.filter((r) => r.userId !== me).map((r) => Date.parse(r.lastReadAt)).filter(Number.isFinite);
  const deliveredAt = marks.delivered.filter((r) => r.userId !== me).map((r) => Date.parse(r.lastDeliveredAt)).filter(Number.isFinite);
  const newestRead = readAt.length ? Math.max(...readAt) : -Infinity;
  const newestDelivered = deliveredAt.length ? Math.max(...deliveredAt) : -Infinity;
  const lastIndex = data.pages.length - 1;
  const pages = data.pages.map((page, p) => {
    let changed = false;
    const messages = page.messages.map((m) => {
      if (!m.mine || m.status === undefined || m.deleted) return m;
      const at = Date.parse(m.createdAt);
      if (m.status !== "read" && at <= newestRead) {
        changed = true;
        return { ...m, status: "read" as const };
      }
      if (m.status === "sent" && at <= newestDelivered) {
        changed = true;
        return { ...m, status: "delivered" as const };
      }
      return m;
    });
    let readers: ReaderDto[] = page.readers;
    if (p === lastIndex && page.readers.length) {
      readers = page.readers.map((r) => {
        const mark = marks.reads.find((x) => x.userId === r.userId && r.userId !== me);
        if (!mark) return r;
        const upTo = Date.parse(mark.lastReadAt);
        const seen = [...page.messages].reverse().find((m) => !m.deleted && Date.parse(m.createdAt) <= upTo);
        if (!seen || (seen.id === r.messageId && r.readAt === mark.lastReadAt)) return r;
        changed = true;
        return { ...r, messageId: seen.id, readAt: mark.lastReadAt };
      });
    }
    return changed ? { ...page, messages, readers } : page;
  });
  return pages.some((p, i) => p !== data.pages[i]) ? { ...data, pages } : data;
}

// ───────────────────────────────────────── rows ─────────────────────────────────────────

const timeOf = (row: ChatRowDto): number => (row.lastMessage ? Date.parse(row.lastMessage.at) : 0);

/** The list's order: the newest activity first (what the server answers; kept when one row moves). */
export function sortListRows(rows: ChatRowDto[]): ChatRowDto[] {
  return rows.slice().sort((a, b) => timeOf(b) - timeOf(a) || a.title.localeCompare(b.title, "ar"));
}

/** A forum view's order: an archived topic (by the moderators, or by me) last, my own pins first, the managers' pins next, then the newest activity (ties keep the server's order). */
export function sortTopicRows(rows: ChatRowDto[]): ChatRowDto[] {
  return rows
    .slice()
    .sort(
      (a, b) =>
        Number(!!a.archived || a.archivedByMe) - Number(!!b.archived || b.archivedByMe) ||
        Number(b.pinnedByMe) - Number(a.pinnedByMe) ||
        Number(!!b.pinned) - Number(!!a.pinned) ||
        timeOf(b) - timeOf(a),
    );
}

function upsertById(rows: ChatRowDto[], incoming: ChatRowDto[]): ChatRowDto[] {
  const next = rows.slice();
  for (const row of incoming) {
    const at = next.findIndex((r) => r.id === row.id);
    if (at >= 0) next[at] = row;
    else next.push(row);
  }
  return next;
}

/**
 * Rows of a sync answer into the list. The list of «قائمة وحدة» (`scope: "all"`) holds a forum row per space and the private chats:
 * those are upserted (a first message of a new chat adds its row), a topic row is only a replacement of one it holds (its space's
 * row already carries it). The list of one space (`scope: "space"`) holds that space's topics and its private chats and nothing else.
 * No list yet: nothing is made up from a part.
 */
export function mergeRowsIntoList(list: ChatListDto | undefined, rows: ChatRowDto[]): ChatListDto | undefined {
  if (!list || !rows.length) return list;
  const have = new Set(list.rows.map((r) => r.id));
  const take = rows.filter((row) => {
    if (list.scope === "all") return row.kind === "TOPIC" ? have.has(row.id) : true;
    if (row.kind === "SPACE") return false;
    return have.has(row.id) || row.space?.id === list.spaceId;
  });
  if (!take.length) return list;
  return { ...list, rows: sortListRows(upsertById(list.rows, take)) };
}

/** Topic rows of a space into its forum view (a new topic is added, a changed one replaced). */
export function mergeRowsIntoSpace(data: SpaceTopicsDto | undefined, rows: ChatRowDto[]): SpaceTopicsDto | undefined {
  if (!data) return data;
  const take = rows.filter((row) => row.kind === "TOPIC" && row.space?.id === data.space.id);
  if (!take.length) return data;
  return { ...data, rows: sortTopicRows(upsertById(data.rows, take)) };
}

/** A conversation that is gone: its row, and its chip under its space's row. */
export function dropFromRows(rows: ChatRowDto[], id: string): ChatRowDto[] {
  let changed = false;
  const next: ChatRowDto[] = [];
  for (const row of rows) {
    if (row.id === id) {
      changed = true;
      continue;
    }
    if (row.topicChips?.some((c) => c.id === id)) {
      changed = true;
      next.push({ ...row, topicChips: row.topicChips.filter((c) => c.id !== id) });
      continue;
    }
    next.push(row);
  }
  return changed ? next : rows;
}

export function dropFromList(list: ChatListDto | undefined, id: string): ChatListDto | undefined {
  if (!list) return list;
  const rows = dropFromRows(list.rows, id);
  return rows === list.rows ? list : { ...list, rows };
}

export function dropFromSpace(data: SpaceTopicsDto | undefined, id: string): SpaceTopicsDto | undefined {
  if (!data) return data;
  const rows = dropFromRows(data.rows, id);
  return rows === data.rows ? data : { ...data, rows };
}

// ───────────────────────────────────────── derived row numbers ─────────────────────────────────────────

/** The row's «last message» line for one message, the way the server writes it (a system line is its sentence, a deleted one has none). */
export function lastMessageOf(m: MessageDto): ChatRowLastMessageDto {
  const out: ChatRowLastMessageDto = {
    id: m.id,
    authorName: m.authorName,
    preview: m.kind === "SYSTEM" ? systemSentence(m.system, m.authorName) : m.deleted ? null : (m.body?.slice(0, 140) ?? null),
    kind: m.kind,
    at: m.createdAt,
    mine: m.mine,
  };
  if (m.status && m.mine && m.kind !== "SYSTEM") out.status = m.status;
  if (!m.deleted && m.attachments?.[0]?.round) out.round = true;
  return out;
}

/** Does this message add to somebody's unread number? Mine do not, a deleted one does not, a system line does not. */
export function countsAsUnread(m: MessageDto): boolean {
  return !m.mine && !m.deleted && m.kind !== "SYSTEM";
}

/** A row after a message that is NEWER than its last one arrived (otherwise untouched). */
export function rowAfterMessage(row: ChatRowDto, m: MessageDto, opts: { mentionsMe?: boolean } = {}): ChatRowDto {
  if (row.lastMessage && Date.parse(row.lastMessage.at) > Date.parse(m.createdAt)) return row;
  if (row.lastMessage?.id === m.id) return row;
  const counts = countsAsUnread(m);
  return {
    ...row,
    lastMessage: lastMessageOf(m),
    unread: counts ? row.unread + 1 : row.unread,
    mentionsUnread: counts && opts.mentionsMe ? row.mentionsUnread + 1 : row.mentionsUnread,
    // C3a.1: an archived chat that is not muted comes back to the main list when a message (not a system line) arrives, as the server's row says too
    ...(row.archivedByMe && !row.muted && m.kind !== "SYSTEM" && !m.deleted ? { archivedByMe: false } : {}),
  };
}

/** The forum row of a space after one of its topics got a message. */
export function spaceRowAfterMessage(row: ChatRowDto, topicId: string, m: MessageDto, opts: { mentionsMe?: boolean } = {}): ChatRowDto {
  const counts = countsAsUnread(m);
  const newer = !row.lastMessage || Date.parse(row.lastMessage.at) <= Date.parse(m.createdAt);
  return {
    ...row,
    lastMessage: newer ? lastMessageOf(m) : row.lastMessage,
    unread: counts ? row.unread + 1 : row.unread,
    mentionsUnread: counts && opts.mentionsMe ? row.mentionsUnread + 1 : row.mentionsUnread,
    ...(row.topicChips ? { topicChips: row.topicChips.map((c) => (c.id === topicId && counts ? { ...c, unread: c.unread + 1 } : c)) } : {}),
  };
}

/** A conversation I read: nothing waiting, the manual mark gone. */
export function rowAfterRead(row: ChatRowDto): ChatRowDto {
  if (row.unread === 0 && row.mentionsUnread === 0 && !row.markedUnread) return row;
  return { ...row, unread: 0, mentionsUnread: 0, markedUnread: false };
}

/** The forum row of a space after one of its topics was read: that topic's share leaves its numbers. */
export function spaceRowAfterRead(row: ChatRowDto, topicId: string, was: { unread: number; mentionsUnread: number }): ChatRowDto {
  return {
    ...row,
    unread: Math.max(0, row.unread - was.unread),
    mentionsUnread: Math.max(0, row.mentionsUnread - was.mentionsUnread),
    ...(row.topicChips ? { topicChips: row.topicChips.map((c) => (c.id === topicId ? { ...c, unread: 0 } : c)) } : {}),
  };
}

/**
 * Does the header of a TOPIC still say what its row says? (`false`: the header is stale — it was renamed, closed, made private,
 * archived or moved — and is asked for again.) A private chat or a group is never compared: nothing a sync row says about one can
 * make its header wrong, and a header that is refetched on every message would cost more than the staleness it cures.
 */
export function headerAgreesWithRow(
  header: { title: string; emoji: string | null; closed: boolean; restricted?: boolean; topicType?: string; archived?: boolean; teamId?: string | null },
  row: ChatRowDto,
): boolean {
  if (row.kind !== "TOPIC") return true;
  return (
    header.title === row.title &&
    header.emoji === row.emoji &&
    header.closed === (row.closed ?? header.closed) &&
    (header.restricted ?? false) === row.restricted &&
    (header.topicType === undefined || row.topicType === undefined || header.topicType === row.topicType) &&
    (header.archived === undefined || row.archived === undefined || header.archived === row.archived) &&
    (header.teamId === undefined || row.teamId === undefined || header.teamId === row.teamId)
  );
}
