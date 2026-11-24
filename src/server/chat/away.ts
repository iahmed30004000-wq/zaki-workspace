import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { emitRealtime } from "@/server/realtime/emit";
import { moveLastMessageAt, systemMessage } from "@/server/chat/system";
import { assertFeatureOn, isFeatureOn } from "@/server/services/features";
import { chatAutomationSchema, withinWorkHours, workHoursSchema, type ChatAutomation, type WorkHours } from "@/lib/chat/work-hours";

/**
 * «أتمتة المحادثة» — work hours and the away line (src/lib/chat/work-hours.ts for the rules; the contract is docs/contracts/telegram-look.md).
 *
 *   WHAT  a person saves their work hours and a short text; while the switch `chatAutomation` is on, a message written to them in a PRIVATE chat outside those hours is followed by one
 *         line of that chat, `{k:"away", p:{text, at}}`, drawn labelled «رد تلقائي». It is a system line: never a message in the person's name, never sent to an AI, never in a topic.
 *   WHEN  at most one line per twelve hours per chat (`at` is the moment it was written, so the rule needs no other clock), never for the person's own messages, never without hours.
 */
export const AWAY_EVERY_MS = 12 * 3_600_000;

let clock: () => Date = () => new Date();
/** For tests only: the moment the rule thinks it is. */
export function setAwayClockForTests(next: (() => Date) | null): void {
  clock = next ?? (() => new Date());
}

export const automationInputSchema = z.object({
  workHours: workHoursSchema.nullable().optional(),
  chatAutomation: chatAutomationSchema.optional(),
});

export interface MyAutomation {
  workHours: WorkHours | null;
  chatAutomation: ChatAutomation;
}

const OFF: ChatAutomation = { on: false, text: "" };

function readHours(value: unknown): WorkHours | null {
  const parsed = workHoursSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
function readAutomation(value: unknown): ChatAutomation {
  const parsed = chatAutomationSchema.safeParse(value);
  return parsed.success ? parsed.data : OFF;
}

export async function getMyAutomation(ctx: { orgId: string; userId: string }): Promise<MyAutomation> {
  await assertFeatureOn(ctx.orgId, "chatAutomation");
  const me = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { workHours: true, chatAutomation: true } });
  return { workHours: readHours(me.workHours), chatAutomation: readAutomation(me.chatAutomation) };
}

/** Saves what was sent (a part is left as it is when absent; `workHours: null` clears the hours). Only my own row. */
export async function setMyAutomation(ctx: { orgId: string; userId: string }, input: z.infer<typeof automationInputSchema>): Promise<MyAutomation> {
  await assertFeatureOn(ctx.orgId, "chatAutomation");
  const data: Prisma.UserUpdateInput = {};
  if (input.workHours !== undefined) data.workHours = input.workHours === null ? Prisma.JsonNull : (input.workHours as Prisma.InputJsonValue);
  if (input.chatAutomation !== undefined) data.chatAutomation = input.chatAutomation as Prisma.InputJsonValue;
  const me = await db.user.update({ where: { id: ctx.userId }, data, select: { workHours: true, chatAutomation: true } });
  return { workHours: readHours(me.workHours), chatAutomation: readAutomation(me.chatAutomation) };
}


const jobs = new Set<Promise<void>>();
/** For tests only: waits for the lines being written. */
export async function settleAwayForTests(): Promise<void> {
  while (jobs.size > 0) await Promise.allSettled([...jobs]);
}

/** After a text message was stored: in a private chat, the other person's away line, once in a while. Off the sender's path; a failure is logged and nothing else. */
export function afterMessageAway(input: { orgId: string; conversationId: string; authorId: string }): void {
  const job = run(input).catch((err: unknown) => log.error("away.crashed", { name: err instanceof Error ? err.name : "unknown" }));
  jobs.add(job);
  void job.finally(() => jobs.delete(job));
}

async function run(input: { orgId: string; conversationId: string; authorId: string }): Promise<void> {
  const conv = await db.conversation.findFirst({ where: { id: input.conversationId, orgId: input.orgId }, select: { kind: true, spaceId: true, members: { select: { userId: true } } } });
  if (!conv || conv.kind !== "DM") return;
  const others = conv.members.map((m) => m.userId).filter((id) => id !== input.authorId);
  if (others.length !== 1) return;
  const awayId = others[0]!;
  if (!(await isFeatureOn(input.orgId, "chatAutomation"))) return;
  const person = await db.user.findUnique({ where: { id: awayId }, select: { workHours: true, chatAutomation: true } });
  const hours = readHours(person?.workHours);
  const automation = readAutomation(person?.chatAutomation);
  const now = clock();
  if (!hours || !automation.on || automation.text === "" || withinWorkHours(hours, now)) return;
  // once in twelve hours: the newest lines of this kind written in the person's name, by the moment they carry
  const recent = await db.chatMessage.findMany({ where: { conversationId: input.conversationId, kind: "SYSTEM", authorId: awayId, body: { startsWith: '{"k":"away"' } }, orderBy: { createdAt: "desc" }, take: 3, select: { body: true } });
  const last = Math.max(0, ...recent.map((m) => Number((JSON.parse(m.body) as { p?: { at?: number } }).p?.at ?? 0)));
  if (now.getTime() - last < AWAY_EVERY_MS) return;
  await db.$transaction(async (tx) => {
    const msg = await tx.chatMessage.create({ data: { orgId: input.orgId, conversationId: input.conversationId, authorId: awayId, body: systemMessage("away", { text: automation.text, at: now.getTime() }), kind: "SYSTEM" }, select: { id: true, createdAt: true } });
    await moveLastMessageAt(tx, input.conversationId, msg.createdAt);
    await emitRealtime(tx, input.orgId, "message.created", { conversationId: input.conversationId, messageId: msg.id, ...(conv.spaceId ? { spaceId: conv.spaceId } : {}) });
  });
}
