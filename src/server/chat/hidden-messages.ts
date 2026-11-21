import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import { NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { canRead, loadConversationFacts, loadOrgFacts } from "@/server/policy/conversation";
import { emitRealtime } from "@/server/realtime/emit";
import { assertFeatureOn } from "@/server/services/features";
import { isValidTimeZone, resolveTimeZone } from "@/lib/zoned-time";
import type { MessagesPageDto } from "@/server/chat/dto";

/**
 * S5.7 (a) — «حذف عندي» (delete for me).
 *
 * One row of `ChatMessageHidden` = one person hid one message FOR THEMSELVES. It is the opposite of a deletion: the message is not touched (no tombstone, no
 * edit, nothing in the archive or the audit trail), every other person and the owner's oversight read it as before, and who may delete for everybody is
 * unchanged. What it changes is ONE person's reads — the page, the sync feed, the in-chat search, the media tabs, the list's last line, the unread counts and the
 * calendar of the date jump — and each of them asks the two helpers below, so the rule is written once.
 *
 *  - any message the person can READ may be hidden (their own, or somebody else's); a message of a conversation they cannot read does not exist for them (404);
 *  - the door is behind the new chat screen (`chatLayoutV2`): off, it answers 404 (what was hidden stays hidden: the reads do not look at the switch);
 *  - the person's OTHER devices are told through the realtime line with `targetUserId` (ids only), exactly like a pin or a mute of their own.
 */

/** The Prisma condition «this message is not hidden by this person», to be spread into a `chatMessage` where. */
export function notHiddenFor(userId: string): Prisma.ChatMessageWhereInput {
  return { hiddenFor: { none: { userId } } };
}

/** The SQL condition «the message of alias `alias` is not hidden by this person». `alias` is a literal of the caller's own query, never user input. */
export function notHiddenSql(userId: string, alias: "m" | "am" | "ChatMessage" = "m"): Prisma.Sql {
  const column = Prisma.raw(alias === "ChatMessage" ? '"ChatMessage"."id"' : `${alias}.id`);
  return Prisma.sql`NOT EXISTS (SELECT 1 FROM "ChatMessageHidden" h WHERE h."messageId" = ${column} AND h."userId" = ${userId})`;
}

const NOT_FOUND = "chat.e.not_found";
const HIDE_FAILED = "chatparity.hide.failed";
/** The same cap as the multi-select bar. */
export const HIDE_MAX = 100;

export type HideResult = { id: string; ok: true } | { id: string; ok: false; error: string };

/** Hides each readable message for the person; reports each id on its own. Never changes a message. */
export async function hideMessagesForMe(ctx: OrgAccessContext, rawIds: readonly string[]): Promise<{ results: HideResult[] }> {
  await assertFeatureOn(ctx.orgId, "chatLayoutV2");
  const ids = [...new Set(rawIds)].slice(0, HIDE_MAX);
  const rows = await db.chatMessage.findMany({ where: { id: { in: ids }, orgId: ctx.orgId }, select: { id: true, conversationId: true, conversation: { select: { spaceId: true } } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const org = await loadOrgFacts(ctx.userId, ctx.orgId);
  const readable = new Map<string, boolean>();
  const mayRead = async (conversationId: string): Promise<boolean> => {
    const known = readable.get(conversationId);
    if (known !== undefined) return known;
    const facts = await loadConversationFacts(ctx.userId, conversationId);
    // a guest reads topics only (the same rule as opening the conversation)
    const ok = !!facts && !!org && facts.orgId === ctx.orgId && canRead(facts, org) && !(org.role === "GUEST" && facts.kind !== "TOPIC");
    readable.set(conversationId, ok);
    return ok;
  };

  const results: HideResult[] = [];
  const toHide: { id: string; conversationId: string; spaceId: string | null }[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || !(await mayRead(row.conversationId))) {
      results.push({ id, ok: false, error: NOT_FOUND });
      continue;
    }
    toHide.push({ id, conversationId: row.conversationId, spaceId: row.conversation.spaceId });
    results.push({ id, ok: true });
  }
  if (toHide.length === 0) return { results };

  try {
    const already = new Set((await db.chatMessageHidden.findMany({ where: { userId: ctx.userId, messageId: { in: toHide.map((m) => m.id) } }, select: { messageId: true } })).map((r) => r.messageId));
    const fresh = toHide.filter((m) => !already.has(m.id));
    if (fresh.length) {
      await db.$transaction(async (tx) => {
        await tx.chatMessageHidden.createMany({ data: fresh.map((m) => ({ messageId: m.id, userId: ctx.userId })), skipDuplicates: true });
        // the person's own other screens: ids only, for them alone
        for (const m of fresh) await emitRealtime(tx, ctx.orgId, "conversation.changed", { conversationId: m.conversationId, messageId: m.id, targetUserId: ctx.userId, ...(m.spaceId ? { spaceId: m.spaceId } : {}) });
      });
    }
  } catch {
    return { results: results.map((r): HideResult => (r.ok ? { id: r.id, ok: false, error: HIDE_FAILED } : r)) };
  }
  return { results };
}

/** One message: 404 when the person may not read it. */
export async function hideMessageForMe(ctx: OrgAccessContext, messageId: string): Promise<{ hidden: true }> {
  const [result] = (await hideMessagesForMe(ctx, [messageId])).results;
  if (!result?.ok) throw new NotFoundError(result?.error ?? NOT_FOUND);
  return { hidden: true };
}

/** Of these message ids, the ones the person hid (one query). */
export async function hiddenIdsAmong(userId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db.chatMessageHidden.findMany({ where: { userId, messageId: { in: [...ids] } }, select: { messageId: true } });
  return new Set(rows.map((r) => r.messageId));
}

const MAX_REFILL = 5;

/**
 * A page of messages as the person may see it: the hidden ones are taken out. A page that was ALL hidden does not end the history — the next older window is
 * asked for (up to a few times), so scrolling up never stops at a wall of hidden messages. The unread landing never points at a message that is gone: it moves to
 * the next one that is still there.
 */
export async function withoutHidden(userId: string, page: MessagesPageDto, loadOlder?: (before: string) => Promise<MessagesPageDto>): Promise<MessagesPageDto> {
  let current = page;
  for (let round = 0; ; round++) {
    const hidden = await hiddenIdsAmong(userId, current.messages.map((m) => m.id));
    if (hidden.size === 0) return current;
    const kept = current.messages.filter((m) => !hidden.has(m.id));
    const oldest = current.messages[0];
    // all hidden, and there is more history above: look further up
    if (kept.length === 0 && current.hasOlder && oldest && loadOlder && round < MAX_REFILL) {
      current = await loadOlder(oldest.id);
      continue;
    }
    const landing = current.firstUnreadId && hidden.has(current.firstUnreadId) ? (nextVisibleAfter(current.messages, current.firstUnreadId, hidden) ?? null) : current.firstUnreadId;
    return { ...current, messages: kept, firstUnreadId: landing };
  }
}

function nextVisibleAfter(messages: readonly { id: string }[], id: string, hidden: ReadonlySet<string>): string | undefined {
  const at = messages.findIndex((m) => m.id === id);
  if (at < 0) return undefined;
  return messages.slice(at + 1).find((m) => !hidden.has(m.id))?.id;
}

// ───────────────────────────── (c) the date jump ─────────────────────────────

/** The zone the days are cut in: one the caller names (a valid zone), else the company's own clock (`Organization.timezone`, the same one «اليوم» is counted in). */
async function zoneOf(orgId: string, asked: string | undefined): Promise<string> {
  if (asked !== undefined) {
    if (!isValidTimeZone(asked)) throw bad("tz", "chatparity.date.bad_zone");
    return asked;
  }
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { timezone: true } });
  return resolveTimeZone(org?.timezone);
}

export const dateJumpQuerySchema = z.object({
  days: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "chatparity.date.bad").optional(),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "chatparity.date.bad").optional(),
  tz: z.string().max(64).optional(),
});
export type DateJumpQuery = z.infer<typeof dateJumpQuerySchema>;

export function isDateJumpQuery(params: Record<string, string>): boolean {
  return params["days"] !== undefined || params["onDate"] !== undefined;
}

const bad = (path: string, key = "chatparity.date.bad"): ValidationError => new ValidationError([{ path, message: key }]);

/** Reading first: the same rule as opening the conversation. */
async function readable(ctx: OrgAccessContext, conversationId: string): Promise<void> {
  const [facts, org] = await Promise.all([loadConversationFacts(ctx.userId, conversationId), loadOrgFacts(ctx.userId, ctx.orgId)]);
  if (!facts || !org || facts.orgId !== ctx.orgId || !canRead(facts, org)) throw new NotFoundError(NOT_FOUND);
  if (org.role === "GUEST" && facts.kind !== "TOPIC") throw new NotFoundError(NOT_FOUND);
}

/**
 * `?days=YYYY-MM[&tz=]`: the days of that month (in the company's zone, or the one named) on which the conversation holds a message THEY can see — a hidden message's day is not offered
 * to the person who hid it, a deleted one still shows as a line in the log so its day counts. Days only: no id, no text, nothing that was not already readable.
 */
export async function messageDays(ctx: OrgAccessContext, conversationId: string, query: { days: string; tz?: string | undefined }): Promise<{ days: number[] }> {
  const tz = await zoneOf(ctx.orgId, query.tz);
  await readable(ctx, conversationId);
  const [year, month] = query.days.split("-").map(Number) as [number, number];
  // a day of margin on both sides covers every zone; the local month is decided in SQL
  const from = new Date(Date.UTC(year, month - 1, 1) - 36 * 3_600_000);
  const to = new Date(Date.UTC(year, month, 1) + 36 * 3_600_000);
  const rows = await db.$queryRaw<Array<{ d: number }>>`
    SELECT DISTINCT EXTRACT(DAY FROM local)::int AS d
    FROM (
      SELECT (m."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz} AS local
      FROM "ChatMessage" m
      WHERE m."conversationId" = ${conversationId} AND m."orgId" = ${ctx.orgId}
        AND m."createdAt" >= ${from} AND m."createdAt" < ${to}
        AND ${notHiddenSql(ctx.userId)}
    ) t
    WHERE to_char(local, 'YYYY-MM') = ${query.days}
    ORDER BY d`;
  return { days: rows.map((r) => r.d) };
}

/** `?onDate=YYYY-MM-DD&tz=`: the id of the FIRST message the person can see on or after that local day (null: none). The screen then jumps with its usual `around` window. */
export async function firstMessageOfDay(ctx: OrgAccessContext, conversationId: string, query: { onDate: string; tz?: string | undefined }): Promise<{ id: string | null }> {
  const tz = await zoneOf(ctx.orgId, query.tz);
  const [y, mo, d] = query.onDate.split("-").map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) throw bad("onDate");
  await readable(ctx, conversationId);
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT m.id
    FROM "ChatMessage" m
    WHERE m."conversationId" = ${conversationId} AND m."orgId" = ${ctx.orgId}
      AND m."createdAt" >= ((${query.onDate}::date)::timestamp AT TIME ZONE ${tz}) AT TIME ZONE 'UTC'
      AND ${notHiddenSql(ctx.userId)}
    ORDER BY m."createdAt" ASC, m.id ASC
    LIMIT 1`;
  return { id: rows[0]?.id ?? null };
}
