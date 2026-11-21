import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { chatKeys, convIdOfKey, isHeaderKey, isMessagesKey } from "@/lib/chat/cache/keys";
import {
  applyMarksToData,
  dropFromList,
  dropFromSpace,
  headerAgreesWithRow,
  hideInData,
  lastMessageOf,
  mergeMessage,
  mergeRowsIntoList,
  mergeRowsIntoSpace,
  newestKnown,
  normalizeMessage,
  rowAfterMessage,
  rowAfterRead,
  sortListRows,
  spaceRowAfterMessage,
  spaceRowAfterRead,
  tombstoneInData,
  type Replacing,
} from "@/lib/chat/cache/reducers";
import { restoreOpened } from "@/lib/chat/cache/opened";
import { installChatDefaults } from "@/lib/chat/cache/share";
import {
  LATEST,
  type ChatListDto,
  type ChatRowDto,
  type ConversationHeaderDto,
  type MessageDto,
  type MessagesData,
  type MessagesPageDto,
  type SpaceTopicsDto,
  type SyncAnswer,
  type SyncMessageDto,
} from "@/lib/chat/cache/types";

/**
 * C1.4 — THE WRITER. This file (with the files beside it in `src/lib/chat/cache/`) is the only place in the app that calls
 * `setQueryData` on a chat key; `tests/chat-cache-writer.test.ts` fails on a call anywhere else. Components read through the hooks
 * of `selectors.ts` and write through the functions below, so there is one truth to keep right: the unread numbers, a deleted
 * message's absent text, and the copy that is kept on the device (C1.5) all follow from it.
 *
 * Every function takes the QueryClient first. A function that finds nothing in the cache (no list yet, a conversation nobody opened)
 * does nothing: the cache never makes up a whole from a part.
 *
 * Two rules every function keeps:
 *  1. A patch that changes nothing writes nothing (`setQueryData` would make the data look fresh), and a patch keeps the time the
 *     data was last fetched — so data that came from the device stays «stale» until the server has confirmed it.
 *  2. A message only ever goes into the windows of the conversation it belongs to, and it is only ever one the server presented for
 *     this viewer. The ids of two conversations are never mixed.
 */

type Conv = string;

/** Change the data under `key` with `fn`; nothing is written when there is no data or `fn` returns the same object. */
function patch<T>(qc: QueryClient, key: QueryKey, fn: (old: T) => T): boolean {
  installChatDefaults(qc);
  const state = qc.getQueryState<T>(key);
  const old = state?.data;
  if (old === undefined || !state) return false;
  const next = fn(old);
  if (next === old) return false;
  qc.setQueryData<T>(key, next, { updatedAt: state.dataUpdatedAt });
  if (state.isInvalidated) void qc.invalidateQueries({ queryKey: key, exact: true, refetchType: "none" });
  return true;
}

const hasMessages = (qc: QueryClient, id: Conv): boolean => qc.getQueryData(chatKeys.messages(id)) !== undefined;

/** Every cached list-like query: the list, and the forum views of the spaces. */
function rowKeys(qc: QueryClient): QueryKey[] {
  return [chatKeys.list(), ...qc.getQueriesData<SpaceTopicsDto>({ queryKey: chatKeys.spaces() }).map(([key]) => key)];
}

function patchRows(qc: QueryClient, fn: (rows: ChatRowDto[], key: QueryKey) => ChatRowDto[]): void {
  const apply = (key: QueryKey, rows: ChatRowDto[]) => fn(rows, key);
  patch<ChatListDto>(qc, chatKeys.list(), (l) => {
    const rows = apply(chatKeys.list(), l.rows);
    return rows === l.rows ? l : { ...l, rows };
  });
  for (const [key] of qc.getQueriesData<SpaceTopicsDto>({ queryKey: chatKeys.spaces() })) {
    patch<SpaceTopicsDto>(qc, key, (d) => {
      const rows = apply(key, d.rows);
      return rows === d.rows ? d : { ...d, rows };
    });
  }
}

/** The row of a conversation, wherever the cache holds it. */
export function findRow(qc: QueryClient, id: string): ChatRowDto | null {
  const inList = qc.getQueryData<ChatListDto>(chatKeys.list())?.rows.find((r) => r.id === id);
  if (inList) return inList;
  for (const [, data] of qc.getQueriesData<SpaceTopicsDto>({ queryKey: chatKeys.spaces() })) {
    const found = data?.rows.find((r) => r.id === id);
    if (found) return found;
  }
  return null;
}

/** My own id, learned from any message of mine the cache holds (a message of mine is the only place the cache can read it). */
export function meIdOf(qc: QueryClient): string | undefined {
  for (const [key, data] of qc.getQueriesData<MessagesData>({ queryKey: chatKeys.convs() })) {
    if (!isMessagesKey(key) || !data) continue;
    for (const page of data.pages) {
      const mine = page.messages.find((m) => m.mine);
      if (mine) return mine.authorId;
    }
  }
  return undefined;
}

// ───────────────────────────────────────── rows ─────────────────────────────────────────

/** The list rows of a sync answer (or of any answer): replaced by id, the list kept in order. The server's numbers replace the derived ones. */
export function upsertRows(qc: QueryClient, rows: ChatRowDto[]): void {
  if (!rows.length) return;
  patch<ChatListDto>(qc, chatKeys.list(), (l) => mergeRowsIntoList(l, rows) ?? l);
  for (const [key] of qc.getQueriesData<SpaceTopicsDto>({ queryKey: chatKeys.spaces() })) patch<SpaceTopicsDto>(qc, key, (d) => mergeRowsIntoSpace(d, rows) ?? d);
  // a topic that was renamed, closed, made private or archived: its header says the old thing, so it is asked for again
  for (const row of rows) {
    if (row.kind !== "TOPIC") continue;
    const header = qc.getQueryData<ConversationHeaderDto>(chatKeys.header(row.id));
    if (header && !headerAgreesWithRow(header, row)) void qc.invalidateQueries({ queryKey: chatKeys.header(row.id), exact: true });
  }
}

/** A conversation the person can no longer read (or that is gone): nothing of it stays, rows, chips, header, messages. */
export function removeConversation(qc: QueryClient, id: string): void {
  patch<ChatListDto>(qc, chatKeys.list(), (l) => dropFromList(l, id) ?? l);
  for (const [key] of qc.getQueriesData<SpaceTopicsDto>({ queryKey: chatKeys.spaces() })) patch<SpaceTopicsDto>(qc, key, (d) => dropFromSpace(d, id) ?? d);
  qc.removeQueries({ queryKey: chatKeys.conv(id) });
}

/** I read this conversation: nothing waits in its row, and its share leaves the forum row of its space. */
export function markConversationRead(qc: QueryClient, id: string): void {
  const row = findRow(qc, id);
  if (!row) return;
  const was = { unread: row.unread, mentionsUnread: row.mentionsUnread };
  const spaceId = row.space?.id;
  patchRows(qc, (rows) => {
    let changed = false;
    const next = rows.map((r) => {
      if (r.id === id) {
        const n = rowAfterRead(r);
        if (n !== r) changed = true;
        return n;
      }
      if (r.kind === "SPACE" && r.id === spaceId && row.kind === "TOPIC" && (was.unread || was.mentionsUnread || r.topicChips?.some((c) => c.id === id && c.unread))) {
        changed = true;
        return spaceRowAfterRead(r, id, was);
      }
      return r;
    });
    return changed ? next : rows;
  });
}

// ───────────────────────────────────────── messages ─────────────────────────────────────────

function mergeInto(qc: QueryClient, conversationId: Conv, message: MessageDto, opts: { append: boolean; replacing?: Replacing }): "replaced" | "appended" | "skipped" {
  const out: { status: "replaced" | "appended" | "skipped"; pinChanged: boolean } = { status: "skipped", pinChanged: false };
  patch<MessagesData>(qc, chatKeys.messages(conversationId), (d) => {
    const r = mergeMessage(d, message, opts);
    out.status = r.status;
    out.pinChanged = r.pinChanged;
    return r.data;
  });
  if (out.pinChanged) void qc.invalidateQueries({ queryKey: chatKeys.header(conversationId), exact: true });
  return out.status;
}

/** The row numbers after a message that is new to this cache (explicitly appended: my own send, a caught-up window). */
function bumpRows(qc: QueryClient, conversationId: Conv, message: MessageDto, meId?: string): void {
  const row = findRow(qc, conversationId);
  if (!row) return;
  const mentionsMe = !!meId && message.mentions.includes(meId);
  const spaceId = row.kind === "TOPIC" ? row.space?.id : undefined;
  patchRows(qc, (rows) => {
    let changed = false;
    const next = rows.map((r) => {
      let n = r;
      if (r.id === conversationId) n = rowAfterMessage(r, message, { mentionsMe });
      else if (spaceId && r.kind === "SPACE" && r.id === spaceId) n = spaceRowAfterMessage(r, conversationId, message, { mentionsMe });
      if (n !== r) changed = true;
      return n;
    });
    return changed ? next : rows;
  });
}

/**
 * A message of a conversation that is new to the cache: it joins the last window (when that window reaches the newest message) and
 * the conversation's row follows (its last message, one more unread unless the message is mine). A copy already there is replaced
 * in place. `meId` lets «mentioned me» be counted; without it only the plain number moves.
 */
export function appendMessage(qc: QueryClient, conversationId: string, message: MessageDto, opts: { meId?: string } = {}): void {
  const status = mergeInto(qc, conversationId, message, { append: true });
  if (status !== "replaced") bumpRows(qc, conversationId, normalizeMessage(message), opts.meId);
}

/**
 * The server's message takes the place of its pending copy (found by `replacing.id`, or by the `clientId` of my own message), in
 * place; when there is no pending copy it is appended like any new message. The row's last-message line follows when it was the pending one.
 */
export function replaceMessage(qc: QueryClient, conversationId: string, message: MessageDto, replacing?: Replacing): void {
  const status = mergeInto(qc, conversationId, message, { append: true, ...(replacing ? { replacing } : {}) });
  const row = findRow(qc, conversationId);
  if (!row) return;
  if (status === "appended") {
    bumpRows(qc, conversationId, normalizeMessage(message));
    return;
  }
  const was = replacing?.id ?? message.id;
  if (row.lastMessage?.id === was) {
    const last = lastMessageOf(normalizeMessage(message));
    patchRows(qc, (rows) => {
      const at = rows.findIndex((r) => r.id === conversationId);
      if (at < 0) return rows;
      const next = rows.slice();
      next[at] = { ...rows[at]!, lastMessage: last };
      return next;
    });
  }
}

/** Which conversation holds this message in its cached windows. */
export function conversationOfMessage(qc: QueryClient, messageId: string): Conv | null {
  for (const [key, data] of qc.getQueriesData<MessagesData>({ queryKey: chatKeys.convs() })) {
    if (!isMessagesKey(key) || !data) continue;
    if (data.pages.some((p) => p.messages.some((m) => m.id === messageId))) return convIdOfKey(key);
  }
  return null;
}

/** A deleted message: its place stays, its content goes (in its window, in the quotes of it, in the pinned bar and in the row's line). */
export function tombstone(qc: QueryClient, conversationId: string | null, messageId: string): void {
  const conv = conversationId ?? conversationOfMessage(qc, messageId);
  if (!conv) return;
  patch<MessagesData>(qc, chatKeys.messages(conv), (d) => tombstoneInData(d, messageId));
  patch<ConversationHeaderDto>(qc, chatKeys.header(conv), (h) => (h.pinnedMessages?.some((p) => p.id === messageId) ? { ...h, pinnedMessages: h.pinnedMessages.filter((p) => p.id !== messageId) } : h));
  scrubRowLines(qc, messageId);
}

/**
 * S5.7, «حذف عندي»: the message leaves the person's windows and the pinned bar of its header (the server's list row is asked for again by the caller: its last line and
 * its numbers are the server's). Found from the windows when the conversation is not given.
 */
export function hideMessage(qc: QueryClient, conversationId: string | null, messageId: string): void {
  const conv = conversationId ?? conversationOfMessage(qc, messageId);
  if (!conv) return;
  patch<MessagesData>(qc, chatKeys.messages(conv), (d) => hideInData(d, messageId));
  patch<ConversationHeaderDto>(qc, chatKeys.header(conv), (h) => (h.pinnedMessages?.some((p) => p.id === messageId) ? { ...h, pinnedMessages: h.pinnedMessages.filter((p) => p.id !== messageId) } : h));
}

/**
 * A message deleted that no cached window holds (an old one, pinned or quoted by a message that is on screen): the answer does not say
 * which conversation it was in, so what still names it is scrubbed wherever it is — the quotes of it in every window, the pinned bar of
 * every header, and a row's last line.
 */
export function scrubDeletedEverywhere(qc: QueryClient, messageId: string): void {
  for (const [key] of qc.getQueriesData<MessagesData>({ queryKey: chatKeys.convs() })) {
    if (isMessagesKey(key)) patch<MessagesData>(qc, key, (d) => tombstoneInData(d, messageId));
    else if (isHeaderKey(key)) patch<ConversationHeaderDto>(qc, key, (h) => (h.pinnedMessages?.some((p) => p.id === messageId) ? { ...h, pinnedMessages: h.pinnedMessages.filter((p) => p.id !== messageId) } : h));
  }
  scrubRowLines(qc, messageId);
}

/** Every row (a conversation's own, a forum row of its space) whose last line is this message loses the line's text. */
function scrubRowLines(qc: QueryClient, messageId: string): void {
  patchRows(qc, (rows) => {
    let changed = false;
    const next = rows.map((r) => {
      if (r.lastMessage?.id !== messageId || r.lastMessage.preview === null) return r;
      changed = true;
      return { ...r, lastMessage: { ...r.lastMessage, preview: null } };
    });
    return changed ? next : rows;
  });
}

/**
 * Read and delivery marks of a sync answer. The OTHER people's marks move the ticks of my private chats and the «who read» avatars;
 * MY mark (a read on another device of mine) empties the row's unread number when it covers the row's last message. The server's
 * rows come in the same answer and win either way.
 */
export function applyReads(
  qc: QueryClient,
  marks: { reads: { conversationId: string; userId: string; lastReadAt: string }[]; delivered?: { conversationId: string; userId: string; lastDeliveredAt: string }[] },
  opts: { meId?: string } = {},
): void {
  const delivered = marks.delivered ?? [];
  const me = opts.meId ?? meIdOf(qc);
  const touched = new Set([...marks.reads.map((r) => r.conversationId), ...delivered.map((r) => r.conversationId)]);
  for (const conv of touched) {
    if (hasMessages(qc, conv)) {
      patch<MessagesData>(qc, chatKeys.messages(conv), (d) =>
        applyMarksToData(d, { reads: marks.reads.filter((r) => r.conversationId === conv), delivered: delivered.filter((r) => r.conversationId === conv) }, me),
      );
    }
    const row = findRow(qc, conv);
    if (!row?.lastMessage) continue;
    const last = Date.parse(row.lastMessage.at);
    const mine = me ? marks.reads.find((r) => r.conversationId === conv && r.userId === me) : undefined;
    if (mine && Date.parse(mine.lastReadAt) >= last) markConversationRead(qc, conv);
    // the tick under my last message in a private chat
    if (me && row.kind === "DM" && row.lastMessage.mine && row.lastMessage.status && row.lastMessage.status !== "read") {
      const peerRead = marks.reads.find((r) => r.conversationId === conv && r.userId !== me && Date.parse(r.lastReadAt) >= last);
      const peerGot = delivered.find((r) => r.conversationId === conv && r.userId !== me && Date.parse(r.lastDeliveredAt) >= last);
      const status = peerRead ? ("read" as const) : peerGot && row.lastMessage.status === "sent" ? ("delivered" as const) : null;
      if (status) {
        patchRows(qc, (rows) => {
          const at = rows.findIndex((r) => r.id === conv);
          if (at < 0) return rows;
          const next = rows.slice();
          next[at] = { ...rows[at]!, lastMessage: { ...row.lastMessage!, status } };
          return next;
        });
      }
    }
  }
}

// ───────────────────────────────────────── whole-cache moves ─────────────────────────────────────────

/** Keep only the newest window of a conversation (when the windows reach the newest message), so a refetch of it is one coherent window. */
export function collapseToNewest(qc: QueryClient, conversationId: string): void {
  patch<MessagesData>(qc, chatKeys.messages(conversationId), (d) => {
    const last = d.pages[d.pages.length - 1];
    if (!last || last.hasNewer || d.pages.length === 1) return d;
    return { pages: [last], pageParams: [LATEST] };
  });
}

/** One conversation's messages are asked for again (a caught-up window that failed): only the newest window, so it stays coherent. */
export function refreshMessages(qc: QueryClient, conversationId: string): void {
  collapseToNewest(qc, conversationId);
  void qc.invalidateQueries({ queryKey: chatKeys.messages(conversationId), exact: true });
}

/**
 * The feed said «start over» (its cursor is older than what the server keeps, or something about me changed in a way no id names):
 * every list, header and window is stale. What is on screen is asked for again at once, what is not is marked stale (it paints from
 * the cache and is checked when it is opened), and every window is cut back to its newest page so a refetch of it is coherent.
 */
export function resetChatCache(qc: QueryClient): void {
  for (const [key] of qc.getQueriesData<MessagesData>({ queryKey: chatKeys.convs() })) {
    if (isMessagesKey(key)) collapseToNewest(qc, convIdOfKey(key)!);
  }
  void qc.invalidateQueries({ queryKey: chatKeys.all() });
}

/** Drops every chat query: the wipe (sign-out) and nothing else. */
export function dropAllChatQueries(qc: QueryClient): void {
  qc.removeQueries({ queryKey: chatKeys.all() });
}

export interface ApplyOutcome {
  /** conversations whose window may be missing messages that this answer cannot place: ask `messages?after=` for them */
  catchUp: string[];
}

/**
 * ONE sync answer (`GET /api/chat/sync`) into the cache. In order: a `reset` marks everything stale; `removed` drops conversations
 * from every key; the messages go to their windows; the read and delivery marks follow; the rows replace the derived numbers.
 *
 * Where a message goes: the answer's messages carry no conversation id (C1.2), so a message already in a window is replaced in place
 * (an edit, a reaction, a deletion), and a NEW one is placed through the list row that names it as its newest message — but only
 * when it is the only new message of its conversation in the answer; if there are more (a burst, a message deleted at once), the
 * window cannot be sure it has them all in order, and the conversation is returned in `catchUp` instead. When the server adds
 * `conversationId` to the answer's messages, that field is used and none of this is needed.
 */
export function applySync(qc: QueryClient, sync: SyncAnswer, opts: { meId?: string } = {}): ApplyOutcome {
  if (sync.reset) resetChatCache(qc);
  for (const id of sync.removed) removeConversation(qc, id);
  const removed = new Set(sync.removed);

  const index = new Map<string, Conv>();
  for (const [key, data] of qc.getQueriesData<MessagesData>({ queryKey: chatKeys.convs() })) {
    if (!isMessagesKey(key) || !data) continue;
    const conv = convIdOfKey(key)!;
    for (const page of data.pages) for (const m of page.messages) index.set(m.id, conv);
  }

  const unplaced: SyncMessageDto[] = [];
  for (const m of sync.messages) {
    const conv = m.conversationId ?? index.get(m.id);
    if (conv && removed.has(conv)) continue;
    if (!conv) {
      unplaced.push(m);
      continue;
    }
    if (hasMessages(qc, conv)) mergeInto(qc, conv, m, { append: m.conversationId !== undefined });
  }

  // a deletion also reaches what quotes the message, the pinned bar and the row's last line (the window already holds the tombstone)
  for (const m of sync.messages) {
    if (!m.deleted) continue;
    const conv = m.conversationId ?? index.get(m.id);
    if (!conv) scrubDeletedEverywhere(qc, m.id);
    else if (!removed.has(conv)) tombstone(qc, conv, m.id);
  }

  // «حذف عندي»: what this person hid on another device leaves the windows here too
  for (const id of sync.hidden ?? []) hideMessage(qc, index.get(id) ?? null, id);

  const catchUp = new Set<Conv>();
  if (unplaced.length) {
    const byLast = new Map<string, ChatRowDto>();
    for (const row of sync.rows) if (row.kind !== "SPACE" && row.lastMessage) byLast.set(row.lastMessage.id, row);
    const leftover = unplaced.filter((m) => !byLast.has(m.id));
    for (const m of unplaced) {
      const row = byLast.get(m.id);
      if (!row || removed.has(row.id) || !hasMessages(qc, row.id)) continue;
      if (leftover.length === 0) mergeInto(qc, row.id, m, { append: true });
      else catchUp.add(row.id);
    }
  }

  if (sync.reads.length || sync.delivered.length) applyReads(qc, { reads: sync.reads, delivered: sync.delivered }, opts);
  upsertRows(qc, sync.rows.filter((r) => !removed.has(r.id)));
  return { catchUp: [...catchUp] };
}

/** Messages fetched with `after=<newest I know>` (a caught-up window): each joins the newest window, in order, once. */
export function applyCatchUp(qc: QueryClient, conversationId: string, page: MessagesPageDto): void {
  for (const m of page.messages) mergeInto(qc, conversationId, m, { append: true });
}

/** The id of the newest message the conversation's windows know, and whether its newest window reaches the end. */
export function newestKnownId(qc: QueryClient, conversationId: string): string | null {
  const data = qc.getQueryData<MessagesData>(chatKeys.messages(conversationId));
  return data ? (newestKnown(data)?.id ?? null) : null;
}

// ───────────────────────────────────────── the device copy comes back (C1.5) ─────────────────────────────────────────

export interface DeviceConversation {
  id: string;
  header: ConversationHeaderDto | null;
  messages: MessageDto[];
  hasOlder: boolean;
  readers: MessagesPageDto["readers"];
  /** when a person last opened it (the device copy's eviction order); absent: never */
  openedAt?: number;
}

/**
 * What was kept on the device, put back as «stale» data: it paints at once and the first fetch or sync confirms it. Nothing that is
 * already in the cache is overwritten (a fresher answer won the race), and a deleted message comes back as a tombstone whatever the
 * stored copy said.
 */
export function seedFromDevice(qc: QueryClient, snapshot: { list: ChatListDto | null; conversations: DeviceConversation[] }): void {
  installChatDefaults(qc);
  const put = <T>(key: QueryKey, data: T) => {
    if (qc.getQueryData(key) !== undefined) return;
    // «fetched at 0»: stale at once (a screen that mounts on it asks the server), and the persister knows it is not confirmed yet
    qc.setQueryData<T>(key, data, { updatedAt: 0 });
  };
  if (snapshot.list) put(chatKeys.list(), { ...snapshot.list, rows: sortListRows(snapshot.list.rows) });
  for (const c of snapshot.conversations) {
    if (c.openedAt) restoreOpened(c.id, c.openedAt);
    if (c.header) put(chatKeys.header(c.id), c.header);
    if (!c.messages.length) continue;
    const page: MessagesPageDto = {
      messages: c.messages.map(normalizeMessage),
      hasOlder: c.hasOlder,
      hasNewer: false,
      // the unread landing is decided by the server when the conversation is opened (C1.6); a stored copy never says it
      firstUnreadId: null,
      readers: c.readers,
    };
    put<MessagesData>(chatKeys.messages(c.id), { pages: [page], pageParams: [LATEST] });
  }
}
