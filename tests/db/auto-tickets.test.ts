import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as settingsRoute from "@/app/api/tickets/problem-settings/route";
import { withFeature } from "@/lib/features";
import { call, db, loginAs, makeUser, uid } from "./helpers";
import { makeTeamsWorld } from "./teams-helpers";
import { makeDepartment } from "./guest-helpers";

/**
 * Q1.5 (part 2b): the rules that make a ticket from a message when it is sent, and who may edit them. Against a real PostgreSQL.
 *
 * Pins: a topic rule makes the ticket at once (the author is the creator) and only for its topic; a content rule needs an order number AND a problem word
 * and defaults to a suggestion (nothing made, the screen offers one tap); mode «تلقائي» makes it; a private conversation never gets an automatic ticket;
 * a failure of the rule never stops the message from being sent; the same order again is a comment, not a second ticket; the settings door needs
 * «ضبط التصعيد» (`escalation.configure`) and keeps only valid kinds and rules.
 */

async function setup(opts: { on?: boolean } = {}) {
  const w = await makeTeamsWorld();
  const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
  const settings = withFeature(org.settings, "autoTickets", opts.on !== false) as Record<string, unknown>;
  const topic = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.s.id, title: `Orders ${uid()}` } });
  const other = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.s.id, title: `Chat ${uid()}` } });
  const dept = await makeDepartment(w.org.id, { memberIds: [w.alice.id], leadId: w.alice.id });
  const rules = (list: unknown[]) => db.organization.update({ where: { id: w.org.id }, data: { settings: { ...settings, autoTicketRules: list } as Prisma.InputJsonValue } });
  await rules([]);
  return { ...w, topic, other, dept, rules };
}
type World = Awaited<ReturnType<typeof setup>>;

const send = (convId: string, body: string) => call(messagesRoute.POST, { params: { id: convId }, body: { body } });
const tickets = (w: World) => db.ticket.findMany({ where: { orgId: w.org.id }, orderBy: { createdAt: "asc" } });

describe("a topic rule", () => {
  it("makes a ticket of every message of its topic at once, made by the author; another topic gets none; the switch off gets none", async () => {
    const w = await setup();
    await w.rules([{ id: "t1", type: "topic", spaceId: w.s.id, conversationId: w.topic.id, kindKey: "other", departmentId: w.dept.id }]);
    await loginAs(w.carol.id);
    const sent = await send(w.topic.id, "الزبون زعلان وما استلم");
    expect(sent.status, sent.text).toBe(201);
    const made = await tickets(w);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ creatorId: w.carol.id, departmentId: w.dept.id, kindKey: "other", sourceMessageId: sent.json!["id"] });
    await send(w.other.id, "كلام عادي");
    expect(await tickets(w)).toHaveLength(1);
    const off = await setup({ on: false });
    await off.rules([{ id: "t1", type: "topic", spaceId: off.s.id, conversationId: off.topic.id, kindKey: "other", departmentId: off.dept.id }]);
    await loginAs(off.carol.id);
    expect((await send(off.topic.id, "الزبون زعلان")).status).toBe(201);
    expect(await tickets(off)).toHaveLength(0);
  });
  it("the same order again becomes a comment, not a second ticket", async () => {
    const w = await setup();
    await w.rules([{ id: "t1", type: "topic", spaceId: w.s.id, conversationId: w.topic.id, kindKey: "shipping", departmentId: w.dept.id }]);
    await loginAs(w.carol.id);
    await send(w.topic.id, "الطلب ZK-2026-000123 متأخر");
    await send(w.topic.id, "ولسا ما وصل ZK-2026-000123");
    const made = await tickets(w);
    expect(made).toHaveLength(1);
    expect(await db.ticketComment.count({ where: { ticketId: made[0]!.id } })).toBe(1);
  });
});

describe("a content rule", () => {
  const rule = (w: World, extra: Record<string, unknown> = {}) => ({ id: "c1", type: "content", spaceId: w.s.id, kindKey: "shipping", departmentId: w.dept.id, ...extra });
  it("suggests by default: no ticket is made, and the screen is given the rule so it can offer «بدك تعمليها تذكرة؟»", async () => {
    const w = await setup();
    await w.rules([rule(w)]);
    await loginAs(w.carol.id);
    expect((await send(w.topic.id, "الطلب ZK-2026-000123 متأخر")).status).toBe(201);
    expect(await tickets(w)).toHaveLength(0);
    const detail = await call(conversationRoute.GET, { params: { id: w.topic.id } });
    const me = detail.json!["me"] as { problemRules?: Array<{ id: string; mode: string }>; problemKinds?: Array<{ key: string }> };
    expect(me.problemRules).toEqual([expect.objectContaining({ id: "c1", mode: "suggest", kindKey: "shipping" })]);
    expect(me.problemKinds?.map((k) => k.key)).toContain("shipping");
  });
  it("in mode «تلقائي» it makes the ticket; with no problem word or no order number it does nothing", async () => {
    const w = await setup();
    await w.rules([rule(w, { mode: "auto" })]);
    await loginAs(w.carol.id);
    await send(w.topic.id, "الطلب ZK-2026-000123 وصل تمام");
    await send(w.topic.id, "متأخر بدون رقم");
    expect(await tickets(w)).toHaveLength(0);
    await send(w.topic.id, "الطلب ZK-2026-000123 متأخر");
    expect(await tickets(w)).toHaveLength(1);
  });
  it("never in a private conversation, even in mode «تلقائي»", async () => {
    const w = await setup();
    await w.rules([rule(w, { mode: "auto" })]);
    const restricted = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.s.id, title: `Restricted ${uid()}`, restricted: true, members: { create: [{ userId: w.carol.id }, { userId: w.bob.id }] } } });
    const group = await db.conversation.create({ data: { orgId: w.org.id, kind: "GROUP", title: `Group ${uid()}`, members: { create: [{ userId: w.carol.id }, { userId: w.bob.id }] } } });
    await loginAs(w.carol.id);
    expect((await send(restricted.id, "الطلب ZK-2026-000123 متأخر")).status).toBe(201);
    expect((await send(group.id, "الطلب ZK-2026-000123 متأخر")).status).toBe(201);
    expect(await tickets(w)).toHaveLength(0);
  });
  it("a rule that cannot make its ticket (nobody to give it to) never stops the message", async () => {
    const w = await setup();
    await w.rules([{ id: "c1", type: "content", spaceId: w.s.id, kindKey: "shipping", mode: "auto" }]);
    await db.workspaceMember.deleteMany({ where: { workspaceId: w.s.id, role: "ADMIN" } });
    await loginAs(w.carol.id);
    const sent = await send(w.topic.id, "الطلب ZK-2026-000123 متأخر");
    expect(sent.status, sent.text).toBe(201);
    expect(await tickets(w)).toHaveLength(0);
  });
});

describe("who edits the kinds and the rules", () => {
  it("«ضبط التصعيد» only: the owner and an admin may, a member and a guest may not", async () => {
    const w = await setup();
    const body = { kinds: [{ key: "mine", label: "نوعي", reminderHours: 2 }], rules: [], workHours: { from: "09:00", to: "18:00" } };
    await loginAs(w.carol.id);
    expect((await call(settingsRoute.PUT, { method: "PUT", body })).status).toBe(403);
    expect((await call(settingsRoute.GET, {})).status).toBe(403);
    const guest = await makeUser({ orgId: w.org.id, role: "GUEST", name: `G ${uid()}` });
    await loginAs(guest.id);
    expect((await call(settingsRoute.PUT, { method: "PUT", body })).status).toBe(403);
    await loginAs(w.owner.id);
    const ok = await call(settingsRoute.PUT, { method: "PUT", body });
    expect(ok.status, ok.text).toBe(200);
    const got = await call(settingsRoute.GET, {});
    expect((got.json!["kinds"] as Array<{ key: string }>).map((k) => k.key)).toEqual(["mine"]);
  });
  it("keeps only valid entries; a rule for another company's space or topic is refused", async () => {
    const w = await setup();
    const foreign = await makeTeamsWorld();
    await loginAs(w.owner.id);
    const r = await call(settingsRoute.PUT, {
      method: "PUT",
      body: {
        kinds: [{ key: "ok1", label: "تمام", reminderHours: 3 }, { key: "BAD KEY", label: "x", reminderHours: 3 }],
        rules: [
          { id: "good", type: "topic", spaceId: w.s.id, conversationId: w.topic.id, kindKey: "ok1" },
          { id: "alien", type: "topic", spaceId: foreign.s.id, conversationId: w.topic.id, kindKey: "ok1" },
          { id: "unknown-kind", type: "content", spaceId: w.s.id, kindKey: "nope" },
        ],
        workHours: { from: "09:00", to: "18:00" },
      },
    });
    expect(r.status, r.text).toBe(200);
    const got = await call(settingsRoute.GET, {});
    expect((got.json!["kinds"] as Array<{ key: string }>).map((k) => k.key)).toEqual(["ok1"]);
    expect((got.json!["rules"] as Array<{ id: string }>).map((x) => x.id)).toEqual(["good"]);
  });
});
