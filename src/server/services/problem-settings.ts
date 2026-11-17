import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ValidationError } from "@/server/auth";
import { assertCan, type Actor } from "@/server/policy/actor";
import { assertFeatureOn } from "@/server/services/features";
import { autoRulesOf, type AutoRule } from "@/lib/tickets/auto-rules";
import { problemKindsOf, type ProblemKind } from "@/lib/tickets/problem-kinds";

/**
 * The kinds of problem, the rules and the working hours of «المشاكل تصير تذاكر» (Q1.5): who edits them is «ضبط التصعيد» (`escalation.configure`), a
 * capability that was checked nowhere before this step. They live in `Organization.settings` (`ticketKinds`, `autoTicketRules`, `workHours`); other keys are
 * never touched. A kind or a rule that is not valid is dropped, a rule for a space or a topic of another company is refused.
 */
export interface WorkHours {
  /** `HH:MM` in the company's time zone */
  from: string;
  to: string;
  /** days off, 0 = Sunday … 6 = Saturday (the default: Friday) */
  daysOff: number[];
}

export const DEFAULT_WORK_HOURS: WorkHours = { from: "09:00", to: "18:00", daysOff: [5] };

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const problemSettingsSchema = z.object({
  kinds: z.array(z.unknown()).max(40).optional(),
  rules: z.array(z.unknown()).max(100).optional(),
  workHours: z.object({ from: hhmm, to: hhmm, daysOff: z.array(z.number().int().min(0).max(6)).max(6).optional() }).optional(),
});

export function workHoursOf(settings: unknown): WorkHours {
  const raw = typeof settings === "object" && settings !== null ? (settings as Record<string, unknown>)["workHours"] : undefined;
  const parsed = z.object({ from: hhmm, to: hhmm, daysOff: z.array(z.number().int().min(0).max(6)).max(6).optional() }).safeParse(raw);
  if (!parsed.success || parsed.data.from >= parsed.data.to) return { ...DEFAULT_WORK_HOURS };
  return { from: parsed.data.from, to: parsed.data.to, daysOff: parsed.data.daysOff ?? DEFAULT_WORK_HOURS.daysOff };
}

export interface ProblemSettings {
  kinds: ProblemKind[];
  rules: AutoRule[];
  workHours: WorkHours;
}

function manager(actor: Actor): void {
  assertCan(actor, "escalation.configure");
}

export async function readProblemSettings(actor: Actor): Promise<ProblemSettings> {
  manager(actor);
  await assertFeatureOn(actor.orgId, "autoTickets");
  const org = await db.organization.findUnique({ where: { id: actor.orgId }, select: { settings: true } });
  return { kinds: problemKindsOf(org?.settings), rules: autoRulesOf(org?.settings), workHours: workHoursOf(org?.settings) };
}

export async function saveProblemSettings(actor: Actor, input: z.infer<typeof problemSettingsSchema>): Promise<ProblemSettings> {
  manager(actor);
  await assertFeatureOn(actor.orgId, "autoTickets");
  const org = await db.organization.findUniqueOrThrow({ where: { id: actor.orgId }, select: { settings: true } });
  const current = (typeof org.settings === "object" && org.settings !== null ? org.settings : {}) as Record<string, unknown>;
  const kinds = input.kinds !== undefined ? problemKindsOf({ ticketKinds: input.kinds }) : problemKindsOf(current);
  const keys = new Set(kinds.map((k) => k.key));
  let rules = input.rules !== undefined ? autoRulesOf({ autoTicketRules: input.rules }) : autoRulesOf(current);
  if (input.rules !== undefined) {
    // only the company's own spaces and topics, and only kinds that exist
    const spaces = new Set((await db.workspace.findMany({ where: { organizationId: actor.orgId }, select: { id: true } })).map((s) => s.id));
    const topics = new Map((await db.conversation.findMany({ where: { orgId: actor.orgId, kind: "TOPIC" }, select: { id: true, spaceId: true } })).map((c) => [c.id, c.spaceId]));
    rules = rules.filter((r) => spaces.has(r.spaceId) && keys.has(r.kindKey) && (r.type === "content" || topics.get(r.conversationId ?? "") === r.spaceId));
  }
  const hours = input.workHours ? { from: input.workHours.from, to: input.workHours.to, daysOff: input.workHours.daysOff ?? DEFAULT_WORK_HOURS.daysOff } : workHoursOf(current);
  if (hours.from >= hours.to) throw new ValidationError([{ path: "workHours", message: "tickets.e.hours" }]);
  const next = { ...current, ticketKinds: kinds, autoTicketRules: rules, workHours: hours };
  await db.organization.update({ where: { id: actor.orgId }, data: { settings: next as unknown as Prisma.InputJsonValue } });
  return { kinds, rules, workHours: hours };
}
