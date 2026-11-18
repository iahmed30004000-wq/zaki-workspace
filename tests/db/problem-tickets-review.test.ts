import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as problemRoute from "@/app/api/chat/messages/[id]/problem/route";
import * as ticketPatch from "@/app/api/tickets/[id]/route";
import * as settingsRoute from "@/app/api/tickets/problem-settings/route";
import { withFeature } from "@/lib/features";
import { wipeCustomerNumbers } from "@/server/services/problem-tickets";
import { runTicketEscalation } from "@/server/services/ticket-escalation";
import { call, db, loginAs, makeUser, uid } from "./helpers";
import { makeTeamsWorld } from "./teams-helpers";
import { makeDepartment } from "./guest-helpers";

/** Q1.5 review: the holes the independent review found, each with its failing test. Against a real PostgreSQL. */
async function world() {
  const w = await makeTeamsWorld();
  const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
  await db.organization.update({ where: { id: w.org.id }, data: { timezone: "Asia/Damascus", settings: withFeature(org.settings, "autoTickets", true) as Prisma.InputJsonValue } });
  const open = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.s.id, title: `Problems ${uid()}` } });
  const dept = await makeDepartment(w.org.id, { memberIds: [w.alice.id], leadId: w.alice.id });
  const say = (body: string, extra: Partial<Prisma.ChatMessageUncheckedCreateInput> = {}) => db.chatMessage.create({ data: { orgId: w.org.id, conversationId: open.id, authorId: w.bob.id, body, ...extra } });
  return { ...w, open, dept, say };
}
const report = (messageId: string, body: Record<string, unknown>) => call(problemRoute.POST, { params: { id: messageId }, body });

describe("one problem, one ticket — even together", () => {
  it("two messages about the same order arriving at the same moment make one ticket and one comment", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    const m1 = await w.say("الطلب ZK-2026-000123 متأخر");
    const m2 = await w.say("لسا ما وصل ZK-2026-000123");
    const [a, b] = await Promise.all([report(m1.id, { kindKey: "shipping", departmentId: w.dept.id }), report(m2.id, { kindKey: "shipping", departmentId: w.dept.id })]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await db.ticket.count({ where: { orgId: w.org.id } })).toBe(1);
  });
  it("the same message reported twice is one ticket, not a ticket and a comment on itself", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    const m = await w.say("مشكلة بدون رقم");
    const first = await report(m.id, { kindKey: "other", departmentId: w.dept.id });
    const second = await report(m.id, { kindKey: "other", departmentId: w.dept.id });
    expect(second.json).toMatchObject({ ticketId: first.json!["ticketId"], merged: true });
    expect(await db.ticket.count({ where: { orgId: w.org.id } })).toBe(1);
    expect(await db.ticketComment.count({ where: { ticketId: first.json!["ticketId"] as string } })).toBe(0);
  });
  it("a bad date makes no ticket at all (the ticket and its link are one write)", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    const r = await report((await w.say("تأجيل")).id, { kindKey: "postpone", departmentId: w.dept.id, followUpDate: "2026-13-45" });
    expect(r.status).toBe(422);
    expect(await db.ticket.count({ where: { orgId: w.org.id } })).toBe(0);
  });
  it("tells the conversation at once (ticket.changed) so the chip appears for the others", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    const before = await db.realtimeEvent.count({ where: { orgId: w.org.id, kind: "ticket.changed" } });
    await report((await w.say("سؤال")).id, { kindKey: "other", departmentId: w.dept.id });
    expect(await db.realtimeEvent.count({ where: { orgId: w.org.id, kind: "ticket.changed" } })).toBe(before + 1);
  });
});

describe("the merge is only into a ticket the asker may read", () => {
  it("somebody outside that ticket gets a ticket of their own, and learns nothing of the other", async () => {
    const w = await world();
    const hidden = await db.ticket.create({ data: { orgId: w.org.id, number: 7001, title: "خاصة", creatorId: w.alice.id, assigneeId: w.alice.id, departmentId: w.dept.id, kindKey: "shipping", externalRef: "ZK-2026-000777", status: "OPEN" } });
    await loginAs(w.carol.id);
    const r = await report((await w.say("الطلب ZK-2026-000777 متأخر")).id, { kindKey: "shipping", assigneeId: w.alice.id });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ merged: false });
    expect(r.json!["ticketId"]).not.toBe(hidden.id);
    expect(await db.ticketComment.count({ where: { ticketId: hidden.id } })).toBe(0);
  });
});

describe("who gets it — a chain that falls through", () => {
  it("«@الكل» alone is not one person: the department is used", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    const r = await report((await w.say("@الكل مشكلة", { mentions: ["*"] })).id, { kindKey: "other", departmentId: w.dept.id });
    expect(r.status, r.text).toBe(201);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: r.json!["ticketId"] as string } })).departmentId).toBe(w.dept.id);
  });
  it("a suspended supervisor or a guest is skipped, the next one in the chain gets it; a bad person chosen by hand is refused", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.carol.id } }, data: { managerId: w.alice.id } });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.alice.id } }, data: { status: "SUSPENDED" } });
    const a = await report((await w.say("سؤال ١")).id, { kindKey: "other" });
    expect(a.status, a.text).toBe(201);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: a.json!["ticketId"] as string } })).assigneeId).toBe(w.spaceAdmin.id);
    const guest = await makeUser({ orgId: w.org.id, role: "GUEST", name: `G ${uid()}` });
    await db.workspaceMember.create({ data: { workspaceId: w.s.id, userId: guest.id, role: "GUEST" } });
    const single = await report((await w.say("@ضيف سؤال", { mentions: [guest.id] })).id, { kindKey: "other" });
    expect(single.status, single.text).toBe(201);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: single.json!["ticketId"] as string } })).assigneeId).toBe(w.spaceAdmin.id);
    const chosen = await report((await w.say("سؤال ٣")).id, { kindKey: "other", assigneeId: guest.id });
    expect(chosen.status).toBe(422);
  });
});

describe("the wipe and the reply", () => {
  it("a ticket closed straight from OPEN (no resolve date) is wiped too, 30 days after it last changed", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    const r = await report((await w.say("الزبون 0791234567")).id, { kindKey: "customer_silent", departmentId: w.dept.id });
    const id = r.json!["ticketId"] as string;
    await db.ticket.update({ where: { id }, data: { status: "CLOSED", resolvedAt: null } });
    await db.$executeRaw`UPDATE "Ticket" SET "updatedAt" = now() - interval '31 days' WHERE id = ${id}`;
    await wipeCustomerNumbers(new Date());
    expect((await db.ticket.findUniqueOrThrow({ where: { id } })).customerRefCipher).toBeNull();
  });
  it("the «✅ انحلّت» reply is written only by somebody who may post in that conversation, and only once", async () => {
    const w = await world();
    const group = await db.conversation.create({ data: { orgId: w.org.id, kind: "GROUP", title: `Private ${uid()}`, members: { create: [{ userId: w.carol.id }, { userId: w.bob.id }] } } });
    const m = await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: group.id, authorId: w.bob.id, body: "مشكلة بالطلب ZK-2026-000555" } });
    await loginAs(w.carol.id);
    const r = await report(m.id, { kindKey: "other", assigneeId: w.alice.id, confirmPublic: true });
    const id = r.json!["ticketId"] as string;
    await loginAs(w.alice.id);
    await call(ticketPatch.PATCH, { method: "PATCH", params: { id }, body: { status: "RESOLVED", resolution: "تم" } });
    expect(await db.chatMessage.count({ where: { replyToId: m.id } })).toBe(0);
    const m2 = await w.say("مشكلة ZK-2026-000556");
    await loginAs(w.carol.id);
    const r2 = await report(m2.id, { kindKey: "other", assigneeId: w.alice.id });
    const id2 = r2.json!["ticketId"] as string;
    await loginAs(w.alice.id);
    await call(ticketPatch.PATCH, { method: "PATCH", params: { id: id2 }, body: { status: "RESOLVED" } });
    await call(ticketPatch.PATCH, { method: "PATCH", params: { id: id2 }, body: { status: "IN_PROGRESS" } });
    await call(ticketPatch.PATCH, { method: "PATCH", params: { id: id2 }, body: { status: "RESOLVED" } });
    expect(await db.chatMessage.count({ where: { replyToId: m2.id } })).toBe(1);
  });
});

describe("the settings door checks the people and the kinds", () => {
  it("drops a department of another company, a guest; rules of a removed kind go with it", async () => {
    const w = await world();
    const foreign = await makeTeamsWorld();
    const foreignDept = await makeDepartment(foreign.org.id);
    const guest = await makeUser({ orgId: w.org.id, role: "GUEST", name: `G ${uid()}` });
    await loginAs(w.owner.id);
    const put = await call(settingsRoute.PUT, {
      method: "PUT",
      body: {
        kinds: [
          { key: "k1", label: "أول", reminderHours: 2, departmentId: foreignDept.id },
          { key: "k2", label: "ثاني", reminderHours: 2, assigneeId: guest.id },
          { key: "k3", label: "ثالث", reminderHours: 2, departmentId: w.dept.id },
        ],
        rules: [{ id: "r1", type: "content", spaceId: w.s.id, kindKey: "k2" }],
      },
    });
    expect(put.status, put.text).toBe(200);
    const kinds = put.json!["kinds"] as Array<{ key: string; departmentId?: string; assigneeId?: string }>;
    expect(kinds.find((k) => k.key === "k1")?.departmentId).toBeUndefined();
    expect(kinds.find((k) => k.key === "k2")?.assigneeId).toBeUndefined();
    expect(kinds.find((k) => k.key === "k3")?.departmentId).toBe(w.dept.id);
    const again = await call(settingsRoute.PUT, { method: "PUT", body: { kinds: [{ key: "k3", label: "ثالث", reminderHours: 2 }] } });
    expect((again.json!["rules"] as unknown[]).length).toBe(0);
  });
});

describe("escalation details", () => {
  const MON_9 = new Date("2030-11-11T07:00:00Z");
  it("a ticket waiting for its follow-up day is not chased; a holder who is not active is not counted as reminded", async () => {
    const w = await world();
    const make = (over: Record<string, unknown>) => db.ticket.create({ data: { orgId: w.org.id, number: Math.floor(Math.random() * 1e8), title: "t", creatorId: w.carol.id, assigneeId: w.alice.id, departmentId: w.dept.id, kindKey: "postpone", createdAt: MON_9, ...over } as never });
    await make({ followUpAt: new Date("2030-12-01T00:00:00Z") });
    const later = new Date(MON_9.getTime() + 12 * 3_600_000);
    expect((await runTicketEscalation(later)).reminded).toBe(0);
    await db.ticket.deleteMany({ where: { orgId: w.org.id } });
    await make({});
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.alice.id } }, data: { status: "SUSPENDED" } });
    expect((await runTicketEscalation(later)).reminded).toBe(0);
  });
});
