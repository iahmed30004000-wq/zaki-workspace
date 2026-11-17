import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, type OrgAccessContext } from "@/server/auth";
import { canMark } from "@/server/chat/must-read-policy";
import { canModerate, loadConversationFacts, type ConversationFacts, type OrgFacts } from "@/server/policy/conversation";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { guard } from "@/server/chat/messages";
import { messageLink, readersAmong, topicAudienceIds } from "@/server/chat/notify";
import { emitRealtime } from "@/server/realtime/emit";
import { pushNotificationToMany } from "@/server/notify";
import { AR } from "@/lib/i18n/dict";
import { featureOn } from "@/lib/features";
import { resolveTimeZone, zonedDayNumber, zonedParts } from "@/lib/zoned-time";
import { workedMinutes } from "@/lib/tickets/work-hours";
import { workHoursOf } from "@/server/services/problem-settings";
import type { MessageDto } from "@/server/chat/dto";
import type { Prisma } from "@prisma/client";

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
  /** the instants of the reminders sent (at most two) */
  reminded?: string[];
  /** the company's calendar day the author was last given the list of late readers, `YYYY-MM-DD` */
  listedOn?: string;
}

const asMeta = (v: unknown): AckMeta => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as AckMeta) : {});

export { canMark };

/** The people who must read a message of this topic by `authorId`: see the list above. */
export async function ackAudience(facts: ConversationFacts, conversationId: string, orgId: string, authorId: string): Promise<string[]> {
  const candidates = (await topicAudienceIds(facts, conversationId)).filter((id) => id !== authorId);
  const mayRead = await readersAmong(conversationId, candidates);
  if (mayRead.length === 0) return [];
  const staff = await db.organizationMember.findMany({ where: { organizationId: orgId, userId: { in: mayRead }, status: "ACTIVE", role: { not: "GUEST" } }, select: { userId: true } });
  return staff.map((m) => m.userId);
}

export async function setMustRead(ctx: OrgAccessContext, messageId: string, on: boolean): Promise<{ ackRequired: boolean }> {
  await assertFeatureOn(ctx.orgId, "mustRead");
  const msg = await db.chatMessage.findFirst({ where: { id: messageId, orgId: ctx.orgId }, select: { id: true, kind: true, deletedAt: true, conversationId: true } });
  if (!msg) throw new NotFoundError("chat.e.not_found");
  const { facts, org } = await guard(ctx, msg.conversationId);
  if (!(await canMark(ctx, facts, org))) throw new ForbiddenError("chat.e.must_read_denied");
  if (msg.deletedAt || msg.kind !== "TEXT") throw new ValidationError([{ path: "messageId", message: "chat.e.must_read_text_only" }]);
  await db.chatMessage.update({ where: { id: msg.id }, data: { ackRequired: on, ...(on ? {} : { ackMeta: null as unknown as Prisma.InputJsonValue }) } });
  return { ackRequired: on };
}

/** «قرأت ✓» (on) or taking it back (off): a ✅ reaction of the person, only if the message must be read and the person is one who counts. */
export async function setAck(ctx: OrgAccessContext, messageId: string, on: boolean): Promise<{ acked: boolean }> {
  await assertFeatureOn(ctx.orgId, "mustRead");
  const msg = await db.chatMessage.findFirst({ where: { id: messageId, orgId: ctx.orgId, ackRequired: true, deletedAt: null }, select: { id: true, conversationId: true, authorId: true, conversation: { select: { spaceId: true } } } });
  if (!msg) throw new NotFoundError("chat.e.not_found");
  const { facts, org } = await guard(ctx, msg.conversationId);
  if (org.role === "GUEST") throw new ForbiddenError("chat.guest_forbidden");
  const audience = await ackAudience(facts, msg.conversationId, ctx.orgId, msg.authorId);
  if (!audience.includes(ctx.userId)) throw new ForbiddenError("chat.e.must_read_not_you");
  await db.$transaction(async (tx) => {
    if (on) await tx.chatReaction.upsert({ where: { messageId_userId_emoji: { messageId: msg.id, userId: ctx.userId, emoji: ACK_EMOJI } }, create: { messageId: msg.id, userId: ctx.userId, emoji: ACK_EMOJI }, update: {} });
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

const preview = (body: string) => (body.length > 80 ? `${body.slice(0, 80)}…` : body);

/**
 * The reminders (run by the jobs runner): after 3 working hours, and again the next working morning, to the people who have not read; the author is given
 * the list of late readers once a day while there is one. Each reminder once (`ackMeta`).
 */
export async function runMustReadReminders(now: Date = new Date()): Promise<{ reminded: number; listed: number }> {
  let reminded = 0;
  let listed = 0;
  const orgs = await db.organization.findMany({ select: { id: true, timezone: true, settings: true } });
  for (const org of orgs) {
    if (!featureOn(org.settings, "mustRead")) continue;
    const hours = workHoursOf(org.settings);
    const tz = resolveTimeZone(org.timezone);
    const rows = await db.chatMessage.findMany({
      where: { orgId: org.id, ackRequired: true, deletedAt: null, kind: "TEXT", createdAt: { gt: new Date(now.getTime() - RECENT_DAYS * 86_400_000), lte: now } },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, body: true, conversationId: true, authorId: true, createdAt: true, ackMeta: true, reactions: { where: { emoji: ACK_EMOJI }, select: { userId: true } } },
    });
    for (const m of rows) {
      const facts = await loadConversationFacts(m.authorId, m.conversationId);
      if (!facts) continue;
      const audience = await ackAudience(facts, m.conversationId, org.id, m.authorId);
      const acked = new Set(m.reactions.map((r) => r.userId));
      const missing = audience.filter((id) => !acked.has(id));
      if (missing.length === 0) continue;
      const meta = asMeta(m.ackMeta);
      const sent = [...(meta.reminded ?? [])];
      const p = zonedParts(now, tz);
      const todayKey = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
      const minutesNow = p.hour * 60 + p.minute;
      const opens = Number(hours.from.slice(0, 2)) * 60 + Number(hours.from.slice(3));
      const link = messageLink(m.conversationId, m.id);
      const remind = async () => {
        await pushNotificationToMany(missing, { type: "must_read", title: AR["notif.type.must_read"] ?? "لازم تقرأ", body: preview(m.body), linkUrl: link, organizationId: org.id });
        sent.push(now.toISOString());
        reminded += missing.length;
      };
      if (sent.length === 0 && workedMinutes(m.createdAt, now, hours, tz) >= FIRST_REMINDER_MINUTES) await remind();
      else if (sent.length === 1 && zonedDayNumber(new Date(sent[0]!), tz) < zonedDayNumber(now, tz) && !hours.daysOff.includes(p.weekday) && minutesNow >= opens) await remind();
      let listedOn = meta.listedOn;
      if (sent.length > 0 && listedOn !== todayKey) {
        const names = (await db.user.findMany({ where: { id: { in: missing.slice(0, 5) } }, select: { name: true } })).map((u) => u.name);
        const more = missing.length > names.length ? ` +${missing.length - names.length}` : "";
        await pushNotificationToMany([m.authorId], { type: "must_read_late", title: AR["notif.type.must_read_late"] ?? "ناس لسا ما قرأت", body: `${names.join("، ")}${more}`, linkUrl: link, organizationId: org.id });
        listedOn = todayKey;
        listed += 1;
      }
      if (sent.length !== (meta.reminded ?? []).length || listedOn !== meta.listedOn) {
        await db.chatMessage.update({ where: { id: m.id }, data: { ackMeta: { reminded: sent, ...(listedOn ? { listedOn } : {}) } as Prisma.InputJsonValue } });
      }
    }
  }
  return { reminded, listed };
}
