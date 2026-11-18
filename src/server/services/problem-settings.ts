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

/**
 * The FOURTH kind of rule of `autoTicketRules` (I1.1a): by EVENT. An event the orders system sends (`order.returned`, `order.cancelled`) opens a ticket of a kind, for a
 * department or a person, made by the person who connected the integration. It lives in the same list as the three kinds of Q1.5 (`type: "event"`); `autoRulesOf`
 * (src/lib/tickets/auto-rules.ts) does not know the kind and skips it, so message-time rules never see it, and this file reads and writes it (`eventRulesOf`).
 */
export const TICKET_EVENTS = ["order.returned", "order.cancelled"] as const;
export interface EventRule {
  id: string;
  type: "event";
  event: (typeof TICKET_EVENTS)[number];
  kindKey: string;
  departmentId?: string | null;
  assigneeId?: string | null;
}

const idLike = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

/** The company's event rules: the valid ones only (a bad entry or a repeated id is dropped, never trusted). */
export function eventRulesOf(settings: unknown): EventRule[] {
  const raw = typeof settings === "object" && settings !== null ? (settings as Record<string, unknown>)["autoTicketRules"] : undefined;
  if (!Array.isArray(raw)) return [];
  const out: EventRule[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (typeof r !== "object" || r === null || Array.isArray(r)) continue;
    const o = r as Record<string, unknown>;
    if (o["type"] !== "event" || !idLike(o["id"]) || seen.has(o["id"])) continue;
    if (!(TICKET_EVENTS as readonly unknown[]).includes(o["event"])) continue;
    if (typeof o["kindKey"] !== "string" || !/^[a-z][a-z0-9_]{1,40}$/.test(o["kindKey"])) continue;
    seen.add(o["id"]);
    out.push({
      id: o["id"],
      type: "event",
      event: o["event"] as EventRule["event"],
      kindKey: o["kindKey"],
      ...(idLike(o["departmentId"]) ? { departmentId: o["departmentId"] } : {}),
      ...(idLike(o["assigneeId"]) ? { assigneeId: o["assigneeId"] } : {}),
    });
  }
  return out;
}

export const DEFAULT_WORK_HOURS: WorkHours = { from: "09:00", to: "18:00", daysOff: [5] };

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const problemSettingsSchema = z.object({
  kinds: z.array(z.unknown()).max(40).optional(),
  rules: z.array(z.unknown()).max(100).optional(),
  /** by EVENT (I1.1a): an order that came back or was cancelled opens a ticket */
  eventRules: z.array(z.unknown()).max(20).optional(),
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
  eventRules: EventRule[];
  workHours: WorkHours;
}

function manager(actor: Actor): void {
  assertCan(actor, "escalation.configure");
}

export async function readProblemSettings(actor: Actor): Promise<ProblemSettings> {
  manager(actor);
  await assertFeatureOn(actor.orgId, "autoTickets");
  const org = await db.organization.findUnique({ where: { id: actor.orgId }, select: { settings: true } });
  return { kinds: problemKindsOf(org?.settings), rules: autoRulesOf(org?.settings), eventRules: eventRulesOf(org?.settings), workHours: workHoursOf(org?.settings) };
}

export async function saveProblemSettings(actor: Actor, input: z.infer<typeof problemSettingsSchema>): Promise<ProblemSettings> {
  manager(actor);
  await assertFeatureOn(actor.orgId, "autoTickets");
  const org = await db.organization.findUniqueOrThrow({ where: { id: actor.orgId }, select: { settings: true } });
  const current = (typeof org.settings === "object" && org.settings !== null ? org.settings : {}) as Record<string, unknown>;
  let kinds = input.kinds !== undefined ? problemKindsOf({ ticketKinds: input.kinds }) : problemKindsOf(current);
  const keys = new Set(kinds.map((k) => k.key));
  let rules = input.rules !== undefined ? autoRulesOf({ autoTicketRules: input.rules }) : autoRulesOf(current);
  // a rule whose kind is gone goes with it (also when only the kinds were saved)
  rules = rules.filter((r) => keys.has(r.kindKey));
  if (input.rules !== undefined) {
    // only the company's own spaces and topics, and only kinds that exist
    const spaces = new Set((await db.workspace.findMany({ where: { organizationId: actor.orgId }, select: { id: true } })).map((s) => s.id));
    const topics = new Map((await db.conversation.findMany({ where: { orgId: actor.orgId, kind: "TOPIC" }, select: { id: true, spaceId: true } })).map((c) => [c.id, c.spaceId]));
    rules = rules.filter((r) => spaces.has(r.spaceId) && keys.has(r.kindKey) && (r.type === "content" || topics.get(r.conversationId ?? "") === r.spaceId));
  }
  // the departments and people named by a kind or a rule must be this company's: a department of another company, a guest or a person who is not active is dropped
  const deptIds = new Set((await db.department.findMany({ where: { orgId: actor.orgId }, select: { id: true } })).map((d) => d.id));
  let eventRules = (input.eventRules !== undefined ? eventRulesOf({ autoTicketRules: input.eventRules }) : eventRulesOf(current)).filter((r) => keys.has(r.kindKey));
  const named = [...kinds.map((k) => k.assigneeId), ...rules.map((r) => r.assigneeId), ...eventRules.map((r) => r.assigneeId)].filter((v): v is string => typeof v === "string");
  const okPeople = new Set((await db.organizationMember.findMany({ where: { organizationId: actor.orgId, userId: { in: named }, status: "ACTIVE", role: { not: "GUEST" } }, select: { userId: true } })).map((m) => m.userId));
  const clean = <T extends { departmentId?: string | null | undefined; assigneeId?: string | null | undefined }>(o: T): T => {
    const { departmentId, assigneeId, ...rest } = o;
    return { ...rest, ...(departmentId && deptIds.has(departmentId) ? { departmentId } : {}), ...(assigneeId && okPeople.has(assigneeId) ? { assigneeId } : {}) } as T;
  };
  kinds = kinds.map(clean);
  rules = rules.map(clean);
  eventRules = eventRules.map(clean);
  const hours = input.workHours ? { from: input.workHours.from, to: input.workHours.to, daysOff: input.workHours.daysOff ?? DEFAULT_WORK_HOURS.daysOff } : workHoursOf(current);
  if (hours.from >= hours.to) throw new ValidationError([{ path: "workHours", message: "tickets.e.hours" }]);
  // the event rules sit in the same list, after the three kinds of Q1.5
  const next = { ...current, ticketKinds: kinds, autoTicketRules: [...rules, ...eventRules], workHours: hours };
  await db.organization.update({ where: { id: actor.orgId }, data: { settings: next as unknown as Prisma.InputJsonValue } });
  return { kinds, rules, eventRules, workHours: hours };
}
