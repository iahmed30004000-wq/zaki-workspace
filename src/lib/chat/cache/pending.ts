import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { chatKeys } from "@/lib/chat/cache/keys";
import { mergeMessage, newestKnown, normalizeMessage, rowAfterMessage } from "@/lib/chat/cache/reducers";
import { installChatDefaults } from "@/lib/chat/cache/share";
import { findRow, replaceMessage, upsertRows } from "@/lib/chat/cache/writer";
import type { MessageDto, MessagesData } from "@/lib/chat/cache/types";
import type { OutboxItem } from "@/lib/chat/outbox/queue";

/**
 * C1.8 — THE OPTIMISTIC BUBBLE. The composer writes a pending copy of my message into the newest window the moment I press send (today the
 * bubble appears only from the server's answer); the answer — or the sync, whichever comes first — replaces it IN PLACE, found by the
 * `clientId` of my own message, so there is never a duplicate; a failure marks it red, and the outbox (`src/lib/chat/outbox/`) keeps the retry.
 *
 * A file of the cache folder like the writer, beside it and not inside it: it adds a way in and never edits the writer. What it relies on:
 *  - `mergeMessage` already finds a copy by id OR by the `clientId` of my own message (`reducers.ts`), so a sync that carries the real message
 *    settles the bubble without this file being asked;
 *  - the writer's `replaceMessage` puts the server's message where the pending one stood.
 *
 * What a pending message is NOT:
 *  - never sent to anybody else (it exists only in this cache, and `dropStalePending` removes one that the device copy brings back after a
 *    reload — this page never sent it);
 *  - never a price, a card, a file, a voice note or a poll: text only (`buildPendingMessage` builds a plain TEXT message; the composer sends a
 *    message with files the old way);
 *  - never an anchor: its id is `pending:<clientId>` (a server id never has a colon), so `newestConfirmedId` skips it for `read?upTo=`.
 *
 * Known edge, written down: the sync's catch-up (`after=<newest message I know>`, `sync.ts`) names the newest message of the window; with a
 * pending bubble at the end the server answers 404 for that anchor and the catch-up falls back to refetching the newest window — which is
 * the cache's own safe path (the bubble then comes back from the server's message when the send is answered).
 */

export const PENDING_ID_PREFIX = "pending:";
export const pendingIdOf = (clientId: string): string => `${PENDING_ID_PREFIX}${clientId}`;

/** Is this message one of mine that the server has not answered yet? */
export const isPendingMessage = (m: Pick<MessageDto, "id">): boolean => m.id.startsWith(PENDING_ID_PREFIX);

/** The clientIds this PAGE put in the cache and has not settled: a pending message that is not here came back from the device copy. */
const live = new Set<string>();

export function resetPendingForTests(): void {
  live.clear();
}

export interface PendingInput {
  clientId: string;
  body: string;
  author: { id: string; name: string; avatar?: string | null };
  mentions?: string[];
  /** the message being answered: its id, a preview and who wrote it (what the bubble's quote shows) */
  replyTo?: { id: string; preview: string | null; authorName: string };
  /** «الرد في محادثة أخرى»: the quote the person saw over the box (the server's own copy replaces it) */
  crossReply?: MessageDto["crossReply"];
  now?: Date;
}

/** A plain text message of mine, marked pending. */
export function buildPendingMessage(input: PendingInput): MessageDto {
  return {
    id: pendingIdOf(input.clientId),
    kind: "TEXT",
    body: input.body,
    deleted: false,
    edited: false,
    pinned: false,
    mine: true,
    authorId: input.author.id,
    authorName: input.author.name,
    authorAvatar: input.author.avatar ?? null,
    createdAt: (input.now ?? new Date()).toISOString(),
    clientId: input.clientId,
    ...(input.replyTo ? { replyTo: { id: input.replyTo.id, preview: input.replyTo.preview, authorName: input.replyTo.authorName, deleted: false } } : {}),
    ...(input.crossReply ? { crossReply: input.crossReply } : {}),
    mentions: input.mentions ?? [],
    attachments: [],
    reactions: [],
    pending: { state: "sending" },
  };
}

/** The same one-write rule as the writer's: nothing is written when there is no data or nothing changed, and the data keeps the age it had. */
function patchMessages(qc: QueryClient, conversationId: string, fn: (old: MessagesData) => MessagesData): boolean {
  installChatDefaults(qc);
  const key: QueryKey = chatKeys.messages(conversationId);
  const state = qc.getQueryState<MessagesData>(key);
  const old = state?.data;
  if (old === undefined || !state) return false;
  const next = fn(old);
  if (next === old) return false;
  qc.setQueryData<MessagesData>(key, next, { updatedAt: state.dataUpdatedAt });
  return true;
}

function mapMessages(data: MessagesData, fn: (m: MessageDto) => MessageDto | null): MessagesData {
  let changed = false;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const messages: MessageDto[] = [];
    for (const m of page.messages) {
      const next = fn(m);
      if (next !== m) pageChanged = true;
      if (next) messages.push(next);
    }
    if (!pageChanged) return page;
    changed = true;
    return { ...page, messages };
  });
  return changed ? { ...data, pages } : data;
}

const isOf = (m: MessageDto, clientId: string): boolean => isPendingMessage(m) && m.clientId === clientId;

/**
 * Draw my message now. Returns `true` when the bubble is in the cache (also when it already was: pressing send twice for one `clientId` shows one
 * bubble), `false` when the cache cannot hold it — no window of this conversation yet, or the newest window is not the end of the conversation —
 * and the caller then sends the old way (nothing was written).
 *
 * The bubble sorts LAST: its time is this device's clock, but never earlier than the newest message the window holds (a clock behind the server's
 * would put my own message above the last one), so it never jumps over a message that was already on screen.
 */
export function appendPending(qc: QueryClient, conversationId: string, input: PendingInput): boolean {
  let placed = false;
  patchMessages(qc, conversationId, (data) => {
    if (data.pages.some((p) => p.messages.some((m) => isOf(m, input.clientId)))) {
      placed = true;
      return data;
    }
    const newest = newestKnown(data);
    const floor = newest ? Date.parse(newest.createdAt) + 1 : 0;
    const at = new Date(Math.max((input.now ?? new Date()).getTime(), Number.isFinite(floor) ? floor : 0));
    const result = mergeMessage(data, buildPendingMessage({ ...input, now: at }), { append: true });
    placed = result.status === "appended";
    return result.data;
  });
  if (placed) live.add(input.clientId);
  return placed;
}

/**
 * The server's message of mine takes the bubble's place, in place (found by `clientId`). With no bubble (a refetch dropped it) the message is added
 * once; with the real message already there (the sync won the race) it is replaced by itself. The chat list's row follows my send.
 */
export function replacePending(qc: QueryClient, conversationId: string, message: MessageDto): void {
  // a clientId is the SENDER's: only a message of mine can settle my bubble
  const clientId = message.mine ? (message.clientId ?? undefined) : undefined;
  replaceMessage(qc, conversationId, message, clientId ? { id: pendingIdOf(clientId), clientId } : undefined);
  if (clientId) live.delete(clientId);
  // the row: my own message is its newest one now (no unread number: it is mine); the sync's rows confirm it a moment later
  const row = findRow(qc, conversationId);
  if (!row) return;
  const next = rowAfterMessage(row, normalizeMessage(message));
  if (next !== row) upsertRows(qc, [next]);
}

function setState(qc: QueryClient, conversationId: string, clientId: string, pending: NonNullable<MessageDto["pending"]>): boolean {
  let found = false;
  patchMessages(qc, conversationId, (data) =>
    mapMessages(data, (m) => {
      if (!isOf(m, clientId)) return m;
      found = true;
      const same = m.pending?.state === pending.state && m.pending.reason === pending.reason;
      return same ? m : { ...m, pending };
    }),
  );
  return found;
}

/** The send failed for good: the bubble turns red with the reason (a dictionary key); the outbox holds the message for «إعادة المحاولة». */
export function failPending(qc: QueryClient, conversationId: string, clientId: string, reason?: string): boolean {
  return setState(qc, conversationId, clientId, { state: "failed", ...(reason ? { reason } : {}) });
}

/** The person pressed «إعادة المحاولة»: the bubble is sending again. */
export function resumePending(qc: QueryClient, conversationId: string, clientId: string): boolean {
  return setState(qc, conversationId, clientId, { state: "sending" });
}

/** The person deleted the bubble (the outbox item goes with it). */
export function removePending(qc: QueryClient, conversationId: string, clientId: string): boolean {
  let found = false;
  patchMessages(qc, conversationId, (data) =>
    mapMessages(data, (m) => {
      if (!isOf(m, clientId)) return m;
      found = true;
      return null;
    }),
  );
  live.delete(clientId);
  return found;
}

/**
 * Pending bubbles that this page did not put there came back from the device copy after a reload: nothing is sending them, and the outbox draws
 * what it holds on its own. They go, except the ones the outbox still holds (`keep`: its clientIds). Returns how many went.
 */
export function dropStalePending(qc: QueryClient, conversationId: string, keep: Iterable<string> = []): number {
  const kept = new Set(keep);
  let dropped = 0;
  patchMessages(qc, conversationId, (data) =>
    mapMessages(data, (m) => {
      if (!isPendingMessage(m) || !m.clientId || live.has(m.clientId) || kept.has(m.clientId)) return m;
      dropped++;
      return null;
    }),
  );
  return dropped;
}

/**
 * The outbox decides what a bubble that went to it looks like: a refused item turns its bubble red, a retried one gets its clock back. An item
 * that merely waits for the network (a failed attempt, not a refusal) leaves the bubble as it is.
 */
export function syncPendingWithOutbox(qc: QueryClient, conversationId: string, items: readonly OutboxItem[]): void {
  const data = qc.getQueryData<MessagesData>(chatKeys.messages(conversationId));
  if (!data) return;
  for (const page of data.pages) {
    for (const m of page.messages) {
      if (!isPendingMessage(m) || !m.clientId) continue;
      const item = items.find((i) => i.clientId === m.clientId);
      if (!item) continue;
      if (item.failed) failPending(qc, conversationId, m.clientId, item.failed.key);
      else if (m.pending?.state === "failed") resumePending(qc, conversationId, m.clientId);
    }
  }
}

/** The id of the newest message that is really on the server: what `read?upTo=` and `after=` may name. */
export function newestConfirmedId(messages: readonly Pick<MessageDto, "id">[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (!isPendingMessage(m)) return m.id;
  }
  return null;
}

/** A pending message in the shape the outbox's own bubble (`PendingBubble`) draws: its words, its time, its retry, its reason. */
export function outboxItemOfPending(conversationId: string, m: MessageDto): OutboxItem {
  return {
    clientId: m.clientId ?? m.id.slice(PENDING_ID_PREFIX.length),
    conversationId,
    body: m.body ?? "",
    mentions: m.mentions,
    ...(m.replyTo ? { replyToId: m.replyTo.id } : {}),
    createdAt: Date.parse(m.createdAt),
    attempts: 0,
    ...(m.pending?.state === "failed" ? { failed: { status: 0, key: m.pending.reason ?? "outbox.reason.other" } } : {}),
  };
}
