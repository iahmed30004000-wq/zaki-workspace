import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import { NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { canRead, hasOversight, loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";
import { emitRealtime } from "@/server/realtime/emit";
import { parse } from "@/server/validation";
import { cleanOrder } from "@/lib/chat/order";

/**
 * REALTIME owns the implementation; the signature is the contract from
 * 11-PHASE3-SHARED.md — do not change it (`conversationId` is an optional narrowing).
 *
 * Delivery marks are written for DMs only (the ticks: sent / delivered / read).
 * Called when a person's SSE client connects and when a `message.created` event
 * of a DM reaches one of their connected clients. Never called for the OWNER in
 * oversight (oversight reads silently and marks nothing).
 *
 * Only a DM with a message from the OTHER person newer than the mark moves (the author's own
 * message never marks anything delivered), and each mark that moves emits
 * `conversation.delivered`, so the sender's ✓ turns into ✓✓ live.
 */
export async function markDeliveredForUser(userId: string, conversationId?: string): Promise<void> {
  const rows = await db.conversationMember.findMany({
    where: { userId, conversation: { kind: "DM" }, ...(conversationId ? { conversationId } : {}) },
    select: { conversationId: true, lastDeliveredAt: true, conversation: { select: { orgId: true } } },
  });
  for (const row of rows) {
    const newer = await db.chatMessage.findFirst({
      where: {
        conversationId: row.conversationId,
        authorId: { not: userId },
        kind: { not: "SYSTEM" },
        ...(row.lastDeliveredAt ? { createdAt: { gt: row.lastDeliveredAt } } : {}),
      },
      select: { id: true },
    });
    if (!newer) continue;
    await db.$transaction(async (tx) => {
      await tx.conversationMember.update({
        where: { conversationId_userId: { conversationId: row.conversationId, userId } },
        data: { lastDeliveredAt: new Date() },
      });
      await emitRealtime(tx, row.conversation.orgId, "conversation.delivered", { conversationId: row.conversationId, userId });
    });
  }
}

// ───────────────────────────────────────── C3a.1: my own pin, archive, mark unread and mute ─────────────────────────────────────────

/** At most this many personal pins per person (Telegram's limit is 5 to 10). */
export const PINS_MAX = 10;
/** «للأبد» is a date far away, not a flag (the same choice as the space's mute): the column stays simple. */
const MUTE_MAX_MS = 100 * 365 * 24 * 60 * 60_000;
/** The scope of `UserChatOrder` that keeps the order of a person's pins, the newest on top. */
export const PINS_SCOPE = "pins";

export const myChatStateSchema = z
  .object({
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    markedUnread: z.boolean().optional(),
    /** an ISO time: the mute ends then (the presets are the screen's: an hour, 8 hours, a day, a week, for good); null lifts it */
    mutedUntil: z.string().datetime().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "chatps.empty" });

export type MyChatStateInput = z.infer<typeof myChatStateSchema>;

/** The person's own state of one conversation after a change (what the screen draws), and their pins in order. */
export interface MyChatStateDto {
  pinned: boolean;
  /** the stored archive: whether it still holds (a message that arrived after it brings an unmuted chat back) is the list's answer */
  archived: boolean;
  markedUnread: boolean;
  mutedUntil: string | null;
  pins: string[];
}

/**
 * SQL: the company's switch `chatPersonalState`, read INSIDE the query that needs it (the sync feed never reads the company's settings in a call of its
 * own, and a list is one query). The same rule as `featureOn`: a stored boolean wins, anything else is the default, which is ON.
 */
export function personalOnSql(orgId: string): Prisma.Sql {
  return Prisma.sql`COALESCE(
    (SELECT CASE WHEN jsonb_typeof(o.settings -> 'features' -> 'chatPersonalState') = 'boolean' THEN (o.settings -> 'features' ->> 'chatPersonalState')::boolean END
     FROM "Organization" o WHERE o.id = ${orgId}),
    true
  )`;
}

/**
 * SQL (a fragment of the list's one query and of the sidebar number): is this conversation archived FOR the person? Their archive stands while
 * the chat is muted; an unmuted one comes back when a message (not a system line, not a deleted one) arrives after `archivedAt`
 * (Telegram's behaviour). `cm` is the person's own `ConversationMember` (may be absent) and `c` the conversation; the company's switch
 * `chatPersonalState` is applied (off: nothing is archived for anybody, the data stays).
 */
export function archivedByMeSql(orgId: string): Prisma.Sql {
  return Prisma.sql`COALESCE(
    ${personalOnSql(orgId)} AND cm."archivedAt" IS NOT NULL AND (
      COALESCE(cm."mutedUntil" > now(), false)
      OR NOT EXISTS (
        SELECT 1 FROM "ChatMessage" am
        WHERE am."conversationId" = c.id AND am."createdAt" > cm."archivedAt" AND am.kind <> 'SYSTEM' AND am."deletedAt" IS NULL
      )
    ),
    false
  )`;
}

/**
 * `PUT /api/chat/conversations/[id]/me` `{ pinned?, archived?, markedUnread?, mutedUntil? }`: «لإلي بس». Nobody else's list, count or feed moves; the
 * moderators' pin and archive of a topic (for everybody) are not touched.
 *
 * PRIVACY (no trace — the owner's rule). The answer to «you have no audience here» is ONE: a 404, the same as for a conversation that does not exist,
 * and nothing is written: no row, no event.
 *  - A reader in silent oversight (the primary owner, a partner who still holds `archive.view`, and has no row of his own) is refused: his reading
 *    leaves no trace and neither does this.
 *  - A restricted topic or a private chat needs a row the person ALREADY has (no row = no audience).
 *  - An open topic the person reads gets a row, like `markRead`.
 * At most `PINS_MAX` pins per person (the 11th is a 422 `chatps.pins_full`); their order is kept in `UserChatOrder` scope `pins`, the newest on top.
 * A change that changes nothing writes nothing and says nothing. A change is ONE event for the person alone (`conversation.changed` with
 * `targetUserId`, ids only): their other tabs and devices get the row through the sync feed.
 */
export async function setMyChatState(ctx: OrgAccessContext, conversationId: string, input: unknown): Promise<MyChatStateDto> {
  const want = parse(myChatStateSchema, input);
  const [facts, org] = await Promise.all([loadConversationFacts(ctx.userId, conversationId), loadOrgFacts(ctx.userId, ctx.orgId)]);
  if (!facts || !org || facts.orgId !== ctx.orgId) throw new NotFoundError("chat.e.not_found");
  if (org.role === "GUEST" && facts.kind !== "TOPIC") throw new NotFoundError("chat.e.not_found");
  if (hasOversight(org) && !facts.viewerIsMember) throw new NotFoundError("chat.e.not_found");
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  const openTopicReader = !facts.viewerIsMember && facts.kind === "TOPIC" && !facts.restricted;
  if (!facts.viewerIsMember && !openTopicReader) throw new NotFoundError("chat.e.not_found");

  const now = new Date();
  const where = { conversationId_userId: { conversationId, userId: ctx.userId } };
  const mineOf = (tx: Prisma.TransactionClient) => tx.conversationMember.findUnique({ where, select: { pinnedAt: true, archivedAt: true, markedUnread: true, mutedUntil: true } });
  return db.$transaction(async (tx) => {
    // pins are counted and written under one lock per person, so two at once never make eleven
    if (want.pinned === true) await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`chatpins:${ctx.userId}`}))) l`;
    const row = await mineOf(tx);
    const data: { pinnedAt?: Date | null; archivedAt?: Date | null; markedUnread?: boolean; mutedUntil?: Date | null } = {};
    let pinChanged = false;

    if (want.pinned !== undefined) {
      const isPinned = !!row?.pinnedAt;
      if (want.pinned && !isPinned) {
        const pinned = await tx.conversationMember.count({ where: { userId: ctx.userId, pinnedAt: { not: null }, conversation: { orgId: ctx.orgId } } });
        if (pinned >= PINS_MAX) throw new ValidationError([{ path: "pinned", message: "chatps.pins_full" }]);
        data.pinnedAt = now;
        pinChanged = true;
      } else if (!want.pinned && isPinned) {
        data.pinnedAt = null;
        pinChanged = true;
      }
    }
    // archiving always stamps «now»: that is the moment a newer message is measured against (an archive that is already there is archived again)
    if (want.archived === true) data.archivedAt = now;
    else if (want.archived === false && row?.archivedAt) data.archivedAt = null;
    if (want.markedUnread !== undefined && (row?.markedUnread ?? false) !== want.markedUnread) data.markedUnread = want.markedUnread;
    if (want.mutedUntil !== undefined) {
      // a time in the past is a lifted mute; further than a hundred years is cut at the hundred
      const asked = want.mutedUntil === null ? null : new Date(want.mutedUntil);
      const until = asked && asked > now ? new Date(Math.min(asked.getTime(), now.getTime() + MUTE_MAX_MS)) : null;
      if ((row?.mutedUntil?.getTime() ?? null) !== (until?.getTime() ?? null)) data.mutedUntil = until;
    }

    const changed = Object.keys(data).length > 0;
    if (changed) {
      await tx.conversationMember.upsert({ where, create: { conversationId, userId: ctx.userId, ...data }, update: data });
    }
    if (pinChanged) await writePinsOrder(tx, ctx, conversationId, want.pinned === true);
    if (changed) {
      await emitRealtime(tx, ctx.orgId, "conversation.changed", { conversationId, targetUserId: ctx.userId, spaceId: facts.spaceId ?? undefined });
    }

    const mine = await mineOf(tx);
    const pins = cleanOrder((await tx.userChatOrder.findUnique({ where: { userId_orgId_scope: { userId: ctx.userId, orgId: ctx.orgId, scope: PINS_SCOPE } }, select: { order: true } }))?.order);
    return {
      pinned: !!mine?.pinnedAt,
      archived: !!mine?.archivedAt,
      markedUnread: mine?.markedUnread ?? false,
      mutedUntil: mine?.mutedUntil && mine.mutedUntil > now ? mine.mutedUntil.toISOString() : null,
      pins,
    };
  });
}

/** Keeps `UserChatOrder` scope `pins` in step with the pins that exist: the one just made on top, an un-pinned one gone, ids that are no longer pinned dropped. */
async function writePinsOrder(tx: Prisma.TransactionClient, ctx: OrgAccessContext, conversationId: string, pinned: boolean): Promise<void> {
  const key = { userId_orgId_scope: { userId: ctx.userId, orgId: ctx.orgId, scope: PINS_SCOPE } };
  const stored = cleanOrder((await tx.userChatOrder.findUnique({ where: key, select: { order: true } }))?.order).filter((id) => id !== conversationId);
  const rows = await tx.conversationMember.findMany({
    where: { userId: ctx.userId, pinnedAt: { not: null }, conversation: { orgId: ctx.orgId } },
    orderBy: { pinnedAt: "desc" },
    select: { conversationId: true },
  });
  const alive = new Set(rows.map((r) => r.conversationId));
  const kept = stored.filter((id) => alive.has(id));
  // pins the order does not know yet (made before it, or by another path) come first, newest first; the one just made is the newest of all
  const unknown = rows.map((r) => r.conversationId).filter((id) => !kept.includes(id) && id !== conversationId);
  const order = [...(pinned && alive.has(conversationId) ? [conversationId] : []), ...unknown, ...kept];
  if (order.length === 0) {
    await tx.userChatOrder.deleteMany({ where: { userId: ctx.userId, orgId: ctx.orgId, scope: PINS_SCOPE } });
    return;
  }
  await tx.userChatOrder.upsert({ where: key, create: { userId: ctx.userId, orgId: ctx.orgId, scope: PINS_SCOPE, order }, update: { order } });
}

/**
 * Opening a conversation clears «علّم كغير مقروء». Called by the read route after `markRead` accepted the call (so a person with no audience got
 * their 404 first); a reader in silent oversight has no row, so nothing matches and nothing is written or said. One statement; an event for the person
 * alone only when the flag was really set.
 */
export async function clearMarkedUnread(ctx: OrgAccessContext, conversationId: string): Promise<void> {
  const cleared = await db.conversationMember.updateMany({ where: { conversationId, userId: ctx.userId, markedUnread: true }, data: { markedUnread: false } });
  if (cleared.count === 0) return;
  const conv = await db.conversation.findUnique({ where: { id: conversationId }, select: { spaceId: true, orgId: true } });
  if (!conv || conv.orgId !== ctx.orgId) return;
  await emitRealtime(db, ctx.orgId, "conversation.changed", { conversationId, targetUserId: ctx.userId, spaceId: conv.spaceId ?? undefined });
}
