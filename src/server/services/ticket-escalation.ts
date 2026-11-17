import { db } from "@/server/db";
import { AR } from "@/lib/i18n/dict";
import { featureOn } from "@/lib/features";
import { resolveTimeZone } from "@/lib/zoned-time";
import { problemKind, problemKindsOf } from "@/lib/tickets/problem-kinds";
import { workedMinutes } from "@/lib/tickets/work-hours";
import { pushNotificationToMany } from "@/server/notify";
import { workHoursOf } from "@/server/services/problem-settings";

/**
 * Waiting and escalation of the tickets «🎫 مشكلة» made (Q1.5). A kind has its hours before a reminder, counted INSIDE the company's working hours
 * (`Organization.settings.workHours`, default 09:00–18:00, the sixth day of the week off, in its time zone): the first time they pass, the holder is reminded; the same
 * time again, the department's lead (else the holder's manager) is told. Whoever is not ACTIVE is skipped — the next one is tried; with nobody active the
 * step is recorded and nobody is bothered. Each step happens once (a `TicketActivity` row, `reminded` / `escalated`).
 */
const NEW_ENOUGH_DAYS = 60;
const PER_ORG_LIMIT = 500;

async function firstActive(orgId: string, candidates: Array<string | null | undefined>): Promise<string | null> {
  const ids = candidates.filter((c): c is string => Boolean(c));
  if (ids.length === 0) return null;
  const active = new Set((await db.organizationMember.findMany({ where: { organizationId: orgId, userId: { in: ids }, status: "ACTIVE" }, select: { userId: true } })).map((m) => m.userId));
  return ids.find((id) => active.has(id)) ?? null;
}

export async function runTicketEscalation(now: Date = new Date()): Promise<{ reminded: number; escalated: number }> {
  let reminded = 0;
  let escalated = 0;
  const orgs = await db.organization.findMany({ select: { id: true, timezone: true, settings: true, keyPrefix: true } });
  for (const org of orgs) {
    if (!featureOn(org.settings, "autoTickets")) continue;
    const kinds = problemKindsOf(org.settings);
    const hours = workHoursOf(org.settings);
    const tz = resolveTimeZone(org.timezone);
    const tickets = await db.ticket.findMany({
      // a ticket whose last step (the escalation) is done is never read again: a backlog cannot starve the newer ones
      where: { orgId: org.id, kindKey: { not: null }, status: { in: ["OPEN", "IN_PROGRESS"] }, activities: { none: { event: "escalated" } }, createdAt: { gt: new Date(now.getTime() - NEW_ENOUGH_DAYS * 86_400_000), lte: now } },
      orderBy: { createdAt: "asc" },
      take: PER_ORG_LIMIT,
      select: { id: true, number: true, title: true, kindKey: true, creatorId: true, assigneeId: true, createdAt: true, followUpAt: true, department: { select: { leadId: true } }, activities: { where: { event: { in: ["reminded", "escalated"] } }, select: { event: true } } },
    });
    for (const t of tickets) {
      const kind = problemKind(kinds, t.kindKey);
      if (!kind) continue;
      // waiting for its follow-up day (a «حجز موعد»): it is not late until then
      if (t.followUpAt && t.followUpAt.getTime() > now.getTime()) continue;
      const need = kind.reminderHours * 60;
      const waited = workedMinutes(t.createdAt, now, hours, tz);
      const done = new Set(t.activities.map((a) => a.event));
      const label = `${org.keyPrefix}-T${t.number} · ${t.title}`;
      if (!done.has("reminded") && waited >= need) {
        await db.ticketActivity.create({ data: { ticketId: t.id, actorId: t.creatorId, event: "reminded", meta: { to: t.assigneeId ?? null, waitedMinutes: waited } } });
        // a holder who is no longer active is not "reminded": nobody was told
        if (t.assigneeId && (await firstActive(org.id, [t.assigneeId]))) {
          await pushNotificationToMany([t.assigneeId], { type: "ticket_reminder", title: AR["notif.type.ticket_reminder"] ?? "تذكير", body: label, linkUrl: "/tickets", organizationId: org.id });
          reminded += 1;
        }
      }
      if (!done.has("escalated") && waited >= need * 2) {
        // all-statuses: only the holder's supervisor link is read; whoever receives it is checked ACTIVE by `firstActive`
        const manager = t.assigneeId ? (await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: org.id, userId: t.assigneeId } }, select: { managerId: true } }))?.managerId : null;
        const to = await firstActive(org.id, [t.department?.leadId, manager]);
        await db.ticketActivity.create({ data: { ticketId: t.id, actorId: t.creatorId, event: "escalated", meta: { to, waitedMinutes: waited } } });
        if (to) {
          await pushNotificationToMany([to], { type: "ticket_reminder", title: AR["notif.type.ticket_reminder"] ?? "تذكير", body: label, linkUrl: "/tickets", organizationId: org.id });
          escalated += 1;
        }
      }
    }
  }
  return { reminded, escalated };
}
