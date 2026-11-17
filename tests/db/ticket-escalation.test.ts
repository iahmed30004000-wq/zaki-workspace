import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { withFeature } from "@/lib/features";
import { runTicketEscalation } from "@/server/services/ticket-escalation";
import { db } from "./helpers";
import { makeTeamsWorld } from "./teams-helpers";
import { makeDepartment } from "./guest-helpers";

/**
 * Q1.5 (part 2c): waiting and escalation. A ticket made by «🎫 مشكلة» has hours before a reminder (its kind's), counted INSIDE the company's working hours;
 * then a reminder to whoever holds it, and after the same time again to the department's lead or the holder's manager — skipping anybody not ACTIVE.
 * Each step once. Against a real PostgreSQL.
 */

// the company's clock: Asia/Damascus (UTC+2 in winter), 09:00–18:00, Friday off. Monday 16 Nov 2026.
const MON_9 = new Date("2026-11-16T07:00:00Z");
const at = (hoursAfterMonday9: number) => new Date(MON_9.getTime() + hoursAfterMonday9 * 3_600_000);

async function world(opts: { on?: boolean } = {}) {
  const w = await makeTeamsWorld();
  const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
  await db.organization.update({ where: { id: w.org.id }, data: { timezone: "Asia/Damascus", settings: withFeature(org.settings, "autoTickets", opts.on !== false) as Prisma.InputJsonValue } });
  const dept = await makeDepartment(w.org.id, { memberIds: [w.alice.id, w.bob.id], leadId: w.bob.id });
  const make = (over: Record<string, unknown> = {}) =>
    db.ticket.create({
      data: { orgId: w.org.id, number: Math.floor(Math.random() * 1e8), title: "مشكلة شحن", creatorId: w.carol.id, assigneeId: w.alice.id, departmentId: dept.id, kindKey: "shipping", createdAt: MON_9, ...over } as never,
    });
  const bells = (userId: string) => db.notification.count({ where: { userId, type: "ticket_reminder" } });
  return { ...w, dept, make, bells };
}

describe("the first reminder", () => {
  it("after the kind's working hours (4 for «مشكلة شحن») the holder is reminded, once", async () => {
    const w = await world();
    const t = await w.make();
    await runTicketEscalation(at(3));
    expect(await w.bells(w.alice.id)).toBe(0);
    await runTicketEscalation(at(4.5));
    expect(await w.bells(w.alice.id)).toBe(1);
    await runTicketEscalation(at(5));
    expect(await w.bells(w.alice.id)).toBe(1);
    expect(await db.ticketActivity.count({ where: { ticketId: t.id, event: "reminded" } })).toBe(1);
  });
  it("the night does not count: created at 17:00, 4 clock hours later (21:00) it has waited one working hour", async () => {
    const w = await world();
    await w.make({ createdAt: at(8) });
    await runTicketEscalation(at(12));
    expect(await w.bells(w.alice.id)).toBe(0);
  });
  it("a resolved ticket, a ticket not made by this feature, and the switch off are never reminded", async () => {
    const w = await world();
    await w.make({ status: "RESOLVED", resolvedAt: at(1) });
    await w.make({ kindKey: null });
    await runTicketEscalation(at(8));
    expect(await w.bells(w.alice.id)).toBe(0);
    const off = await world({ on: false });
    await off.make();
    await runTicketEscalation(at(8));
    expect(await off.bells(off.alice.id)).toBe(0);
  });
});

describe("the second step", () => {
  it("after the same time again it goes to the department's lead; once", async () => {
    const w = await world();
    await w.make();
    await runTicketEscalation(at(4.5));
    await runTicketEscalation(at(8.5));
    expect(await w.bells(w.bob.id)).toBe(1);
    await runTicketEscalation(at(9));
    expect(await w.bells(w.bob.id)).toBe(1);
    expect(await w.bells(w.alice.id)).toBe(1);
  });
  it("a suspended lead is skipped: the holder's manager gets it; with nobody active it is recorded and nobody is bothered", async () => {
    const w = await world();
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.bob.id } }, data: { status: "SUSPENDED" } });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.alice.id } }, data: { managerId: w.carol.id } });
    await w.make();
    await runTicketEscalation(at(9));
    expect(await w.bells(w.bob.id)).toBe(0);
    expect(await w.bells(w.carol.id)).toBe(1);
    // nobody active at all
    const w2 = await world();
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w2.org.id, userId: w2.bob.id } }, data: { status: "SUSPENDED" } });
    const t2 = await w2.make();
    await runTicketEscalation(at(9));
    expect(await w2.bells(w2.bob.id)).toBe(0);
    const ev = await db.ticketActivity.findFirstOrThrow({ where: { ticketId: t2.id, event: "escalated" } });
    expect((ev.meta as { to?: string | null }).to).toBeNull();
  });
});
