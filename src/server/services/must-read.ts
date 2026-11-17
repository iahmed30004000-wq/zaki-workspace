import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { canMark } from "@/server/chat/must-read-policy";
import { canModerate, canRead, loadConversationFacts, type ConversationFacts, type OrgFacts } from "@/server/policy/conversation";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { guard } from "@/server/chat/messages";
import { messageLink } from "@/server/chat/notify";
import { emitRealtime } from "@/server/realtime/emit";
import { pushNotificationToMany } from "@/server/notify";
import { AR } from "@/lib/i18n/dict";
import { featureOn } from "@/lib/features";
import { resolveTimeZone, zonedDayNumber, zonedParts } from "@/lib/zoned-time";
import { workedMinutes } from "@/lib/tickets/work-hours";
import { workHoursOf } from "@/server/services/problem-settings";
import type { MessageDto } from "@/server/chat/dto";
import { Prisma } from "@prisma/client";

/**
 * «لازم ينقرأ» (Q1.6): an instruction post that people must acknowledge. The week had 26 instruction posts and 5 were acknowledged, by one person each.
 *
 *  - WHO MAY MARK a message: the moderators of its topic and the holders of «إعلانات للجميع» (`announce.send`, checked nowhere before). A text message of a
 *    TOPIC only (a direct message is two people's own talk).
 *  - WHO COUNTS: the people the topic reaches who are ACTIVE staff — not the author, not a guest, not somebody who left, not a silent oversight reader (the
 *    owner has no place in a topic but through a row of his own).
 *  - READING IT is a ✅ reaction (the existing `ChatReaction`, no new table) by the person; taking it back un-reads. The author and the moderators see
 *    «قرأ 7 من 10» and who has not; everybody else sees only their own state; a guest sees nothing.
 *  - REMINDERS: after 3 working hours of the company, and again the next working morning, to those who have not read — each once; the list of late readers
 *    goes to the author once a day. A message that everybody has read is left alone.
 */
export const ACK_EMOJI = "✅";
export const FIRST_REMINDER_MINUTES = 180;
const MISSING_LIMIT = 50;
const RECENT_DAYS = 14;

interface AckMeta {
  /** when the message was marked (the reminders count from here) */
  markedAt?: string;
  /** the instants of the reminders sent (at most two) */
  reminded?: string[];
  /** the company's calendar day the author was last given the list of late readers, `YYYY-MM-DD` */
  listedOn?: string;
}

const asMeta = (v: unknown): AckMeta => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as AckMeta) : {});

export { canMark };

const audienceCache = new Map<string, { until: number; ids: string[] }>();
const AUDIENCE_TTL_MS = 30_000;

/**
 * The people who must read a message of this topic by `authorId`: see the list above. SET-BASED (a few queries for the whole topic, not several for each
 * person): an open topic's people are its space's rows, a restricted topic's are its own rows that are also in the space; a space guest, a person who left
 * and a person who is not an ACTIVE staff member of the company are out. The answer of a topic is kept 30 seconds for the screens (`fresh` skips it: the job).
 */
export async function ackAudience(facts: ConversationFacts, conversationId: string, orgId: string, authorId: string, opts: { fresh?: boolean } = {}): Promise<string[]> {
  const key = `${conversationId}:${authorId}`;
  const hit = opts.fresh ? undefined : audienceCache.get(key);
  if (hit && hit.until > Date.now()) return hit.ids;
  const convRows = await db.conversationMember.findMany({ where: { conversationId }, select: { userId: true } });
  let ids: Set<string>;
  if (facts.spaceId) {
    const space = await db.workspaceMember.findMany({ where: { workspaceId: facts.spaceId }, select: { userId: true, role: true } });
    const inSpace = new Set(space.filter((s) => s.role !== "GUEST").map((s) => s.userId));
    ids = facts.restricted ? new Set(convRows.map((r) => r.userId).filter((id) => inSpace.has(id))) : inSpace;
  } else {
    ids = new Set(convRows.map((r) => r.userId));
  }
  ids.delete(authorId);
  const staff = ids.size ? await db.organizationMember.findMany({ where: { organizationId: orgId, userId: { in: [...ids] }, status: "ACTIVE", role: { not: "GUEST" } }, select: { userId: true } }) : [];
  const out = staff.map((m) => m.userId);
  if (audienceCache.size > 500) audienceCache.clear();
  audienceCache.set(key, { until: Date.now() + AUDIENCE_TTL_MS, ids: out });
  return out;
}

export async function setMustRead(ctx: OrgAccessContext, messageId: string, on: boolean): Promise<{ ackRequired: boolean }> {
  await assertFeatureOn(ctx.orgId, "mustRead");
  const msg = await db.chatMessage.findFirst({ where: { id: messageId, orgId: ctx.orgId }, select: { id: true, kind: true, deletedAt: true, conversationId: true } });
  if (!msg) throw new NotFoundError("chat.e.not_found");
  const { facts, org } = await guard(ctx, msg.conversationId);
  // nobody marks what they may not read: «not found», the same answer as for a message that does not exist
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  if (!(await canMark(ctx, facts, org))) throw new ForbiddenError("chat.e.must_read_denied");
  if (msg.deletedAt || msg.kind !== "TEXT") throw new ValidationError([{ path: "messageId", message: "chat.e.must_read_text_only" }]);
  // the reminders' clock starts at the mark (an old post marked this morning waits its 3 hours); taking the mark off forgets the reminders
  await db.chatMessage.update({ where: { id: msg.id }, data: { ackRequired: on, ackMeta: on ? ({ markedAt: new Date().toISOString() } as Prisma.InputJsonValue) : Prisma.JsonNull } });
  return { ackRequired: on };
}

/** «قرأت ✓» (on) or taking it back (off): a ✅ reaction of the person, only if the message must be read and the person is one who counts. */
export async function setAck(ctx: OrgAccessContext, messageId: string, on: boolean): Promise<{ acked: boolean }> {
  await assertFeatureOn(ctx.orgId, "mustRead");
  const msg = await db.chatMessage.findFirst({ where: { id: messageId, orgId: ctx.orgId, ackRequired: true, deletedAt: null }, select: { id: true, conversationId: true, authorId: true, conversation: { select: { spaceId: true } } } });
  if (!msg) throw new NotFoundError("chat.e.not_found");
  const { facts, org } = await guard(ctx, msg.conversationId);
  if (!canRead(facts, org)) throw new NotFoundError("chat.e.not_found");
  if (org.role === "GUEST") throw new ForbiddenError("chat.guest_forbidden");
  const audience = await ackAudience(facts, msg.conversationId, ctx.orgId, msg.authorId);
  if (!audience.includes(ctx.userId)) throw new ForbiddenError("chat.e.must_read_not_you");
  await db.$transaction(async (tx) => {
    // createMany + skipDuplicates: a double tap is the same ✅, never a failed write
    if (on) await tx.chatReaction.createMany({ data: [{ messageId: msg.id, userId: ctx.userId, emoji: ACK_EMOJI }], skipDuplicates: true });
    else await tx.chatReaction.deleteMany({ where: { messageId: msg.id, userId: ctx.userId, emoji: ACK_EMOJI } });
    await emitRealtime(tx, ctx.orgId, "message.reacted", { conversationId: msg.conversationId, messageId: msg.id, ...(msg.conversation.spaceId ? { spaceId: msg.conversation.spaceId } : {}) });
  });
  return { acked: on };
}

/**
 * Adds `mustRead` to the messages of a conversation page that must be read (the screen shows «قرأت ✓» / «قرأ 7 من 10»). Nothing for a guest, and nothing
 * while the switch is off. The same audience is computed once for the page.
 */
export async function decorateMustRead(
  ctx: OrgAccessContext,
  facts: ConversationFacts,
  org: OrgFacts,
  conversationId: string,
  rows: Array<{ id: string; ackRequired?: boolean; authorId: string; deletedAt?: Date | null; reactions?: { emoji: string; userId: string }[] }>,
  dtos: MessageDto[],
): Promise<void> {
  if (org.role === "GUEST" || !rows.some((r) => r.ackRequired && !r.deletedAt)) return;
  if (!(await isFeatureOn(ctx.orgId, "mustRead"))) return;
  const byId = new Map(dtos.map((d) => [d.id, d]));
  const moderator = canModerate(facts, org);
  const audienceByAuthor = new Map<string, string[]>();
  const names = new Map<string, string>();
  for (const row of rows) {
    if (!row.ackRequired || row.deletedAt) continue;
    const dto = byId.get(row.id);
    if (!dto) continue;
    if (!audienceByAuthor.has(row.authorId)) audienceByAuthor.set(row.authorId, await ackAudience(facts, conversationId, ctx.orgId, row.authorId));
    const audience = audienceByAuthor.get(row.authorId)!;
    const acked = new Set((row.reactions ?? []).filter((r) => r.emoji === ACK_EMOJI).map((r) => r.userId));
    const mine = audience.includes(ctx.userId);
    const mustRead: NonNullable<MessageDto["mustRead"]> = { mine, acked: acked.has(ctx.userId) };
    if (row.authorId === ctx.userId || moderator) {
      const missing = audience.filter((id) => !acked.has(id));
      mustRead.total = audience.length;
      mustRead.read = audience.length - missing.length;
      const shown = missing.slice(0, MISSING_LIMIT);
      const unknown = shown.filter((id) => !names.has(id));
      if (unknown.length) for (const u of await db.user.findMany({ where: { id: { in: unknown } }, select: { id: true, name: true } })) names.set(u.id, u.name);
      mustRead.missing = shown.map((id) => ({ id, name: names.get(id) ?? "" }));
    }
    dto.mustRead = mustRead;
  }
}

const preview = (body: string) => (body.trim() ? (body.length > 80 ? `${body.slice(0, 80)}…` : body) : "");

let running = false;

/**
 * The reminders (run by the jobs runner): after 3 working hours since the MARK, and again the next working morning, to the people who have not read; the
 * author is given the list of late readers once a day, on a working day, in a run that did not remind. Each step is written down BEFORE it is sent (a crash
 * or a slow run never sends it twice), and one run at a time (a slow one is not started again beside itself). The cheap checks come first: a message
 * whose next step is not due costs no audience query.
 */
export async function runMustReadReminders(now: Date = new Date()): Promise<{ reminded: number; listed: number }> {
  if (running) return { reminded: 0, listed: 0 };
  running = true;
  try {
    return await remindAll(now);
  } finally {
    running = false;
  }
}

async function remindAll(now: Date): Promise<{ reminded: number; listed: number }> {
  let reminded = 0;
  let listed = 0;
  const orgs = await db.organization.findMany({ select: { id: true, timezone: true, settings: true } });
  for (const org of orgs) {
    if (!featureOn(org.settings, "mustRead")) continue;
    const hours = workHoursOf(org.settings);
    const tz = resolveTimeZone(org.timezone);
    const p = zonedParts(now, tz);
    const todayKey = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
    const minutesNow = p.hour * 60 + p.minute;
    const opens = Number(hours.from.slice(0, 2)) * 60 + Number(hours.from.slice(3));
    const closes = Number(hours.to.slice(0, 2)) * 60 + Number(hours.to.slice(3));
    const workingNow = !hours.daysOff.includes(p.weekday) && minutesNow >= opens && minutesNow < closes;
    const rows = await db.chatMessage.findMany({
      where: { orgId: org.id, ackRequired: true, deletedAt: null, kind: "TEXT", createdAt: { lte: now } },
      orderBy: { createdAt: "desc" },
      take: 200,
      select: { id: true, body: true, conversationId: true, authorId: true, createdAt: true, ackMeta: true, reactions: { where: { emoji: ACK_EMOJI }, select: { userId: true } } },
    });
    for (const m of rows) {
      const meta = asMeta(m.ackMeta);
      const markedAt = meta.markedAt ? new Date(meta.markedAt) : m.createdAt;
      const start = Number.isNaN(markedAt.getTime()) || markedAt < m.createdAt ? m.createdAt : markedAt;
      if (now.getTime() - start.getTime() > RECENT_DAYS * 86_400_000 || start.getTime() > now.getTime()) continue;
      const sent = [...(meta.reminded ?? [])];
      const firstDue = sent.length === 0 && workedMinutes(start, now, hours, tz) >= FIRST_REMINDER_MINUTES;
      const secondDue = sent.length === 1 && zonedDayNumber(new Date(sent[0]!), tz) < zonedDayNumber(now, tz) && workingNow;
      const listDue = sent.length > 0 && meta.listedOn !== todayKey && workingNow;
      if (!firstDue && !secondDue && !listDue) continue;
      const facts = await loadConversationFacts(m.authorId, m.conversationId);
      if (!facts) continue;
      const audience = await ackAudience(facts, m.conversationId, org.id, m.authorId, { fresh: true });
      const acked = new Set(m.reactions.map((r) => r.userId));
      const missing = audience.filter((id) => !acked.has(id));
      if (missing.length === 0) continue;
      const link = messageLink(m.conversationId, m.id);
      const remindNow = firstDue || secondDue;
      let listedOn = meta.listedOn;
      if (remindNow) {
        sent.push(now.toISOString());
        // the reminder day is the list's day: the author is not told the same names twice in one day
        listedOn = todayKey;
      }
      const sendList = !remindNow && listDue;
      if (sendList) listedOn = todayKey;
      // written down first, then sent
      await db.chatMessage.update({ where: { id: m.id }, data: { ackMeta: { markedAt: start.toISOString(), reminded: sent, ...(listedOn ? { listedOn } : {}) } as Prisma.InputJsonValue } });
      if (remindNow) {
        await pushNotificationToMany(missing, { type: "must_read", title: AR["notif.type.must_read"] ?? "لازم تقرأ", body: preview(m.body) || (AR["mustread.attachment"] ?? ""), linkUrl: link, organizationId: org.id });
        reminded += missing.length;
      }
      if (sendList) {
        const names = (await db.user.findMany({ where: { id: { in: missing.slice(0, 5) } }, select: { name: true } })).map((u) => u.name);
        const more = missing.length > names.length ? ` +${missing.length - names.length}` : "";
        await pushNotificationToMany([m.authorId], { type: "must_read_late", title: AR["notif.type.must_read_late"] ?? "ناس لسا ما قرأت", body: `${names.join("، ")}${more}`, linkUrl: link, organizationId: org.id });
        listed += 1;
      }
    }
  }
  return { reminded, listed };
}
