import { db } from "@/server/db";
import { ForbiddenError, type OrgAccessContext } from "@/server/auth";
import { canModerate } from "@/server/policy/conversation";
import type { MessageDto, SyncDto } from "@/server/chat/dto";
import {
  chatScope,
  factsOfRecord,
  listViewerOf,
  loadConversationBatch,
  peerMarks,
  rowsForSync,
  silentOwnerIds,
  spaceRoleHeld,
  type ConvRecord,
  type ListViewer,
} from "@/server/chat/list";
import { dmStatusFor, messageInclude } from "@/server/chat/messages";
import { presentMessage, type Viewer } from "@/server/chat/redact";
import { decorateMustRead } from "@/server/services/must-read";
import type { RealtimeKind } from "@/server/realtime/emit";

/**
 * C1.2 — THE SYNC FEED (Telegram's «get difference»). `GET /api/chat/sync?after=<eventId>&limit=500`.
 *
 * It reads the `RealtimeEvent` rows of the company after `after` (ids only, never content: the 48 h table the live line already
 * writes) and answers with what changed FOR THIS PERSON: the messages touched (presented for them, through `presentMessage`), the read and
 * delivery marks, the list rows whose summary moved, and the conversations they can no longer read.
 *
 * PRIVACY. The conversations of a whole batch are loaded and judged in ONE query (`loadConversationBatch`: the policy's own `canRead` over
 * the facts it returned, plus the list's rules), never one lookup per row; a message is only fetched with `conversationId IN (the ones the
 * person reads)`, so a message of a restricted topic, of somebody else's private chat, of another team or of another company can not come
 * back whatever an event says. A deleted message is a tombstone with no text, no files and no reactions for everybody, the owner included
 * (the original is read through the archive, not here); the edit history is never sent. `typing`, `call.ring`, `call.changed`,
 * `whiteboard.changed` and `watch.changed` are not in it: they live on the stream only.
 *
 * `removed` holds the conversations the person can no longer read: a topic made private for the people dropped, a chat they left, a
 * conversation that no longer exists. It is built from `conversation.changed` and from `membership.changed` about THEM, and it names only a
 * conversation they could have known: they have a row in it, it is a private chat with their id in its key, or it is a topic of a space they
 * are in. An id is opaque (no title, nothing in it).
 */

export const SYNC_DEFAULT_LIMIT = 500;
const SPACE_EVENT_SKEW_MS = 5 * 60_000;

/** The events the feed understands. The others (calls, whiteboard, watch) are stream-only. */
const MESSAGE_EVENTS = new Set<RealtimeKind>(["message.created", "message.edited", "message.deleted", "message.reacted", "message.pinned", "poll.voted", "ticket.changed"]);
const ROW_EVENTS = new Set<RealtimeKind>(["message.created", "message.edited", "message.deleted", "conversation.changed", "membership.changed"]);
const KNOWN = new Set<string>([...MESSAGE_EVENTS, ...ROW_EVENTS, "conversation.read", "conversation.delivered"]);

interface EventIds {
  conversationId?: string;
  messageId?: string;
  spaceId?: string;
  userId?: string;
  targetUserId?: string;
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
function idsOf(raw: unknown): EventIds {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { conversationId: str(o["conversationId"]), messageId: str(o["messageId"]), spaceId: str(o["spaceId"]), userId: str(o["userId"]), targetUserId: str(o["targetUserId"]) };
}

const empty = (cursor: string, extra: Partial<SyncDto> = {}): SyncDto => ({ cursor, messages: [], reads: [], delivered: [], rows: [], removed: [], ...extra });

/** The highest event id ever issued and the lowest one still kept (the purge keeps 48 hours), in one statement. */
async function eventRange(): Promise<{ last: bigint; min: bigint | null }> {
  const [row] = await db.$queryRaw<Array<{ last: bigint; min: bigint | null }>>`
    SELECT (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM "RealtimeEvent_id_seq")::bigint AS last,
           (SELECT MIN(id) FROM "RealtimeEvent")::bigint AS min`;
  return { last: row?.last ?? 0n, min: row?.min ?? null };
}

export async function syncFeed(ctx: OrgAccessContext, opts: { after?: bigint; limit?: number } = {}): Promise<SyncDto> {
  const limit = Math.min(Math.max(opts.limit ?? SYNC_DEFAULT_LIMIT, 1), SYNC_DEFAULT_LIMIT);
  const org = await chatScope(ctx).org();
  if (!org || org.status !== "ACTIVE") throw new ForbiddenError("chat.e.not_found");

  const range = await eventRange();
  // no cursor yet: nothing to replay, here is where "now" is
  if (opts.after === undefined) return empty(String(range.last));
  const after = opts.after;
  // a cursor from the future, or one older than what the table still keeps (events between it and the oldest kept one are gone): start over
  const lost = range.min === null ? after < range.last : after < range.min - 1n;
  if (after > range.last || lost) return empty(String(range.last), { reset: true });

  const events = await db.realtimeEvent.findMany({ where: { orgId: ctx.orgId, id: { gt: after } }, orderBy: { id: "asc" }, take: limit });
  const cursor = events.length ? String(events[events.length - 1]!.id) : String(after);
  const more = events.length === limit ? ({ more: true } as const) : {};

  const v = listViewerOf(ctx, org);
  const mine = ctx.userId;
  const messageIds = new Set<string>();
  const convIds = new Set<string>();
  const rowCandidates = new Set<string>(); // conversations whose own row may have changed
  const tickCandidates = new Set<string>(); // somebody else read: the row changes only for a private chat (the ticks)
  const removalCandidates = new Set<string>();
  const readPairs: { conversationId: string; userId: string }[] = [];
  const deliveredPairs: { conversationId: string; userId: string }[] = [];
  const spaceTouches = new Map<string, Date>(); // spaces told «something changed» without a conversation (a topic opened)
  let aboutMe = false;

  for (const e of events) {
    const kind = e.kind;
    if (!KNOWN.has(kind)) continue;
    const ids = idsOf(e.ids);
    if (ids.targetUserId && ids.targetUserId !== mine) continue; // an event for one other person
    if (ids.targetUserId === mine && !ids.conversationId) {
      // my rank, my permissions or my mute changed: what I may read can have changed in ways no single id names
      aboutMe = true;
      continue;
    }
    if (!ids.conversationId) {
      if ((kind === "conversation.changed" || kind === "membership.changed") && ids.spaceId) {
        const first = spaceTouches.get(ids.spaceId);
        if (!first || first > e.createdAt) spaceTouches.set(ids.spaceId, e.createdAt);
      }
      continue;
    }
    const cv = ids.conversationId;
    convIds.add(cv);
    if (MESSAGE_EVENTS.has(kind as RealtimeKind) && ids.messageId) messageIds.add(ids.messageId);
    if (ROW_EVENTS.has(kind as RealtimeKind)) rowCandidates.add(cv);
    if (kind === "conversation.changed" || (kind === "membership.changed" && ids.userId === mine)) removalCandidates.add(cv);
    if (kind === "conversation.read" && ids.userId) {
      readPairs.push({ conversationId: cv, userId: ids.userId });
      if (ids.userId === mine) rowCandidates.add(cv); // my own unread moved (on another device)
    }
    if (kind === "conversation.delivered" && ids.userId) {
      deliveredPairs.push({ conversationId: cv, userId: ids.userId });
      rowCandidates.add(cv); // the tick of a private chat's last message
    }
    if (kind === "conversation.read" && ids.userId !== mine) tickCandidates.add(cv); // a private chat's tick (a topic has no row change for it)
  }
  if (aboutMe) return empty(cursor, { reset: true, ...more });

  // a topic opened (an event that names a space and no conversation): the topics of that space born since then. The clocks of the app and of the database
  // are two clocks, so the window starts a few minutes early; the cost of that is a few rows more, never a missing one.
  if (spaceTouches.size) {
    const since = new Date([...spaceTouches.values()].reduce((a, b) => (a < b ? a : b)).getTime() - SPACE_EVENT_SKEW_MS);
    const touched = await db.conversation.findMany({
      where: { orgId: ctx.orgId, spaceId: { in: [...spaceTouches.keys()] }, createdAt: { gte: since } },
      select: { id: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    for (const c of touched) {
      convIds.add(c.id);
      rowCandidates.add(c.id);
    }
  }
  if (!convIds.size) return empty(cursor, more);

  // ONE query decides for the whole batch
  const { all, visible } = await loadConversationBatch(v, [...convIds]);

  // ---- messages: only of conversations the person reads, presented for them ----
  const wanted = [...messageIds];
  const rows = wanted.length && visible.size
    ? await db.chatMessage.findMany({ where: { id: { in: wanted }, orgId: ctx.orgId, conversationId: { in: [...visible.keys()] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: messageInclude() })
    : [];
  const messages: MessageDto[] = [];
  const byConversation = new Map<string, { rows: typeof rows; dtos: MessageDto[] }>();
  for (const row of rows) {
    const rec = visible.get(row.conversationId)!;
    const viewer: Viewer = { userId: mine, role: org.role, oversight: v.oversight, canModerateHere: canModerate(factsOfRecord(rec), org), isMember: rec.isMember };
    const dto = presentMessage(row as never, viewer, rec.kind === "DM" && row.authorId === mine ? dmStatusFor(peerMarks(rec), row.createdAt) : undefined);
    // a tombstone is a tombstone for everybody here: no text, no files, no reactions (the owner reads the original through the archive); no edit history
    delete dto.history;
    delete dto.original;
    if (dto.deleted) {
      dto.attachments = [];
      dto.reactions = [];
    }
    messages.push(dto);
    const group = byConversation.get(row.conversationId) ?? { rows: [], dtos: [] };
    group.rows.push(row);
    group.dtos.push(dto);
    byConversation.set(row.conversationId, group);
  }
  // «لازم ينقرأ»: the count and the viewer's own state (one audience per conversation)
  for (const [conversationId, g] of byConversation) await decorateMustRead(ctx, factsOfRecord(visible.get(conversationId)!), org, conversationId, g.rows as never, g.dtos);

  // ---- reads and delivery marks (current values; a person who is not ACTIVE is nobody; the owner's silent reading never shows) ----
  const readsWanted = readPairs.filter((p) => visible.has(p.conversationId));
  const deliveredWanted = deliveredPairs.filter((p) => visible.get(p.conversationId)?.kind === "DM");
  const markUsers = [...new Set([...readsWanted, ...deliveredWanted].map((p) => p.userId))];
  const [marks, silent] = markUsers.length
    ? await Promise.all([
        db.conversationMember.findMany({
          where: {
            conversationId: { in: [...new Set([...readsWanted, ...deliveredWanted].map((p) => p.conversationId))] },
            userId: { in: markUsers },
            user: { memberships: { some: { organizationId: ctx.orgId, status: "ACTIVE" } } },
          },
          select: { conversationId: true, userId: true, lastReadAt: true, lastDeliveredAt: true },
        }),
        silentOwnerIds(ctx.orgId, markUsers),
      ])
    : [[], new Set<string>()];
  const markOf = new Map(marks.map((m) => [`${m.conversationId}|${m.userId}`, m]));
  const seenRead = new Set<string>();
  const reads: SyncDto["reads"] = [];
  for (const p of readsWanted) {
    const key = `${p.conversationId}|${p.userId}`;
    const m = markOf.get(key);
    if (!m || seenRead.has(key) || (silent.has(p.userId) && p.userId !== mine)) continue;
    seenRead.add(key);
    reads.push({ conversationId: p.conversationId, userId: p.userId, lastReadAt: m.lastReadAt.toISOString() });
  }
  const seenDelivered = new Set<string>();
  const delivered: SyncDto["delivered"] = [];
  for (const p of deliveredWanted) {
    const key = `${p.conversationId}|${p.userId}`;
    const m = markOf.get(key);
    if (!m?.lastDeliveredAt || seenDelivered.has(key)) continue;
    seenDelivered.add(key);
    delivered.push({ conversationId: p.conversationId, userId: p.userId, lastDeliveredAt: m.lastDeliveredAt.toISOString() });
  }

  // ---- rows: the changed conversations' own rows, and their spaces' rows ----
  for (const id of tickCandidates) if (visible.get(id)?.kind === "DM") rowCandidates.add(id);
  const changed = [...rowCandidates].filter((id) => visible.has(id));
  const rowSpaces = [...new Set(changed.map((id) => visible.get(id)!).filter((r) => r.kind === "TOPIC" && r.spaceId).map((r) => r.spaceId!))];
  const listRows = await rowsForSync(v, changed, rowSpaces);

  // ---- removed ----
  const removed: string[] = [];
  for (const id of removalCandidates) {
    if (visible.has(id)) continue;
    const rec = all.get(id);
    if (!rec || couldHaveKnown(rec, v, ctx.userId)) removed.push(id); // gone altogether, or one they could have seen
  }

  return { cursor, ...more, messages, reads, delivered, rows: listRows, removed };
}

/** Could this person have known the conversation (so that «you can no longer read it» tells them nothing new)? */
function couldHaveKnown(rec: ConvRecord, v: ListViewer, userId: string): boolean {
  if (rec.isMember) return true;
  if (rec.kind === "DM") return (rec.dmKey ?? "").split("@")[0]!.split("|").includes(userId);
  if (rec.kind === "TOPIC") return spaceRoleHeld(rec, v) !== null;
  return false;
}
