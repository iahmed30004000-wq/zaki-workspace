import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as problemRoute from "@/app/api/chat/messages/[id]/problem/route";
import * as detailRoute from "@/app/api/tickets/[id]/detail/route";
import { withFeature } from "@/lib/features";
import { wipeCustomerNumbers } from "@/server/services/problem-tickets";
import { call, db, loginAs, makeUser, makeWorkspace, uid } from "./helpers";
import { makeTeamsWorld } from "./teams-helpers";
import { makeDepartment } from "./guest-helpers";

/**
 * Q1.5 (part 1): «🎫 مشكلة» on a message — a ticket made where the message is. Against a real PostgreSQL.
 *
 * Pins: the switch off = 404; never by a guest; the kind must be one of the company's; who gets it (one @-mentioned person → an instant ticket; else the
 * kind's department; else the asker's supervisor); one problem = one ticket (a later message with the same order number or the same customer number
 * becomes a comment on the open one); a customer's number is stored ENCRYPTED with a keyed hash, never in the title, the text or a comment, shown in full
 * only to the ticket's own readers, and wiped 30 days after it was resolved; a private source needs the confirmation; a kind that asks for a screen
 * recording is refused without one.
 */

const PHONE = "0791234567";

async function setSwitch(orgId: string, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "autoTickets", on) as Prisma.InputJsonValue } });
}

async function world(opts: { on?: boolean } = {}) {
  const w = await makeTeamsWorld();
  if (opts.on !== false) await setSwitch(w.org.id, true);
  const open = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.s.id, title: `Problems ${uid()}` } });
  const dept = await makeDepartment(w.org.id, { memberIds: [w.alice.id], leadId: w.alice.id });
  const say = (body: string, authorId = w.bob.id, extra: Partial<Prisma.ChatMessageUncheckedCreateInput> = {}) =>
    db.chatMessage.create({ data: { orgId: w.org.id, conversationId: open.id, authorId, body, ...extra } });
  return { ...w, open, dept, say };
}
type World = Awaited<ReturnType<typeof world>>;

const report = (messageId: string, body: Record<string, unknown>) => call(problemRoute.POST, { params: { id: messageId }, body });
const detail = (id: string) => call(detailRoute.GET, { params: { id } });

describe("the switch and who may", () => {
  it("with the switch off the door answers 404 and nothing is made", async () => {
    const w = await world({ on: false });
    const m = await w.say("الطلب ZK-2026-000123 رقم غلط");
    await loginAs(w.carol.id);
    expect((await report(m.id, { kindKey: "wrong_number", departmentId: w.dept.id })).status).toBe(404);
    expect(await db.ticket.count({ where: { orgId: w.org.id } })).toBe(0);
  });
  it("a guest makes none; an unknown kind or a name of the language («constructor») is refused", async () => {
    const w = await world();
    const m = await w.say("مشكلة");
    const guest = await makeUser({ orgId: w.org.id, role: "GUEST", name: `Guest ${uid()}` });
    await db.workspaceMember.create({ data: { workspaceId: w.s.id, userId: guest.id, role: "GUEST" } });
    await loginAs(guest.id);
    expect([403, 404]).toContain((await report(m.id, { kindKey: "other" })).status);
    await loginAs(w.carol.id);
    for (const kindKey of ["no_such_kind", "constructor", "__proto__"]) expect((await report(m.id, { kindKey })).status, kindKey).toBe(422);
    expect(await db.ticket.count({ where: { orgId: w.org.id } })).toBe(0);
  });
});

describe("who gets it", () => {
  it("exactly one @-mentioned person: an instant ticket handed to them, made by the asker, kept with its kind, order number and source message", async () => {
    const w = await world();
    const m = await w.say("@Alice الطلب ZK-2026-000123 رقم غلط", w.bob.id, { mentions: [w.alice.id] });
    await loginAs(w.carol.id);
    const r = await report(m.id, { kindKey: "wrong_number" });
    expect(r.status, r.text).toBe(201);
    const t = await db.ticket.findUniqueOrThrow({ where: { id: r.json!["ticketId"] as string } });
    expect(t).toMatchObject({ departmentId: null, assigneeId: w.alice.id, creatorId: w.carol.id, kindKey: "wrong_number", externalRef: "ZK-2026-000123", sourceMessageId: m.id, status: "OPEN" });
  });
  it("nobody mentioned: the department that was named; failing that the asker's supervisor", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    const a = await report((await w.say("سؤال ١")).id, { kindKey: "other", departmentId: w.dept.id });
    expect(a.status, a.text).toBe(201);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: a.json!["ticketId"] as string } })).departmentId).toBe(w.dept.id);

    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.carol.id } }, data: { managerId: w.alice.id } });
    const b = await report((await w.say("سؤال ٢")).id, { kindKey: "other" });
    expect(b.status, b.text).toBe(201);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: b.json!["ticketId"] as string } })).assigneeId).toBe(w.alice.id);
  });
  it("nobody mentioned, no department and no supervisor: the space's manager (never the owner by default); with none at all, a clear refusal and nothing made", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    const a = await report((await w.say("سؤال")).id, { kindKey: "other" });
    expect(a.status, a.text).toBe(201);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: a.json!["ticketId"] as string } })).assigneeId).toBe(w.spaceAdmin.id);
    // a space with nobody in charge
    const loneSpace = await makeWorkspace(w.org.id, [{ userId: w.carol.id }, { userId: w.bob.id }], `Lone ${uid()}`);
    const lone = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: loneSpace.id, title: `Lone ${uid()}` } });
    const m = await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: lone.id, authorId: w.bob.id, body: "سؤال" } });
    const none = await report(m.id, { kindKey: "other" });
    expect(none.status).toBe(422);
    expect(await db.ticket.count({ where: { orgId: w.org.id } })).toBe(1);
  });
});

describe("one problem, one ticket", () => {
  it("a second message with the same order number becomes a comment on the open ticket, not a new ticket", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    const first = await report((await w.say("الطلب ZK-2026-000123 متأخر")).id, { kindKey: "shipping", departmentId: w.dept.id });
    const second = await report((await w.say("ولسا ما وصل ZK-2026-000123")).id, { kindKey: "shipping", departmentId: w.dept.id });
    expect(second.status, second.text).toBe(200);
    expect(second.json).toMatchObject({ ticketId: first.json!["ticketId"], merged: true });
    expect(await db.ticket.count({ where: { orgId: w.org.id } })).toBe(1);
    expect(await db.ticketComment.count({ where: { ticketId: first.json!["ticketId"] as string } })).toBe(1);
    // once it is resolved the same number may open a new one
    await db.ticket.update({ where: { id: first.json!["ticketId"] as string }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    const third = await report((await w.say("رجعت المشكلة ZK-2026-000123")).id, { kindKey: "shipping", departmentId: w.dept.id });
    expect(third.status).toBe(201);
    expect(await db.ticket.count({ where: { orgId: w.org.id } })).toBe(2);
  });
  it("the same customer number (written another way) matches too", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    const first = await report((await w.say(`الزبون ${PHONE} ما بيرد`)).id, { kindKey: "customer_silent", departmentId: w.dept.id });
    const second = await report((await w.say("رجع اتصل +962 79 123 4567")).id, { kindKey: "customer_silent", departmentId: w.dept.id });
    expect(second.json).toMatchObject({ ticketId: first.json!["ticketId"], merged: true });
  });
});

describe("a customer's number", () => {
  it("is stored encrypted with a keyed hash and never in the title, the text or a comment", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    const r = await report((await w.say(`الزبون ${PHONE} ما بيرد\nوكمان ٠٧٩١٢٣٤٥٦٧`)).id, { kindKey: "customer_silent", departmentId: w.dept.id });
    expect(r.status, r.text).toBe(201);
    const t = await db.ticket.findUniqueOrThrow({ where: { id: r.json!["ticketId"] as string } });
    expect(t.customerRefCipher).toBeTruthy();
    expect(t.customerRefCipher).not.toContain(PHONE);
    expect(t.customerRefHash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.customerRefHash).not.toContain(PHONE);
    for (const text of [t.title, t.description ?? ""]) {
      expect(text).not.toContain(PHONE);
      expect(text).not.toContain("٠٧٩١٢٣٤٥٦٧");
    }
    expect(t.description).toContain("07••••••67");
    // the merge comment is masked too
    const again = await report((await w.say(`تاني ${PHONE} لسا`)).id, { kindKey: "customer_silent", departmentId: w.dept.id });
    expect(again.json).toMatchObject({ merged: true });
    const c = await db.ticketComment.findFirstOrThrow({ where: { ticketId: t.id } });
    expect(c.body).not.toContain(PHONE);
    expect(c.body).toContain("07••••••67");
  });
  it("a typed number (the form) is used when the message has none", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    const r = await report((await w.say("الزبون ما بيرد")).id, { kindKey: "customer_silent", departmentId: w.dept.id, customerNumber: "+962 79 123 4567" });
    expect(r.status, r.text).toBe(201);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: r.json!["ticketId"] as string } })).customerRefHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("the ticket's own readers see it in full; somebody who may not read the ticket gets nothing, and the department's people see it", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    const r = await report((await w.say(`الزبون ${PHONE}`)).id, { kindKey: "customer_silent", departmentId: w.dept.id });
    const id = r.json!["ticketId"] as string;
    const mine = await detail(id);
    expect(mine.status, mine.text).toBe(200);
    expect(JSON.stringify(mine.json)).toContain(PHONE);
    await loginAs(w.alice.id);
    expect(JSON.stringify((await detail(id)).json)).toContain(PHONE);
    await loginAs(w.spaceAdmin.id);
    const stranger = await detail(id);
    expect(stranger.status).toBe(404);
    expect(stranger.text).not.toContain(PHONE);
  });
  it("is wiped 30 days after the ticket was resolved, not before, and not while it is open", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    const r = await report((await w.say(`الزبون ${PHONE}`)).id, { kindKey: "customer_silent", departmentId: w.dept.id });
    const id = r.json!["ticketId"] as string;
    const days = (n: number) => new Date(Date.now() - n * 86_400_000);
    expect((await wipeCustomerNumbers(new Date())).wiped).toBe(0);
    await db.ticket.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: days(29) } });
    expect((await wipeCustomerNumbers(new Date())).wiped).toBe(0);
    await db.ticket.update({ where: { id }, data: { resolvedAt: days(31) } });
    expect((await wipeCustomerNumbers(new Date())).wiped).toBeGreaterThanOrEqual(1);
    const t = await db.ticket.findUniqueOrThrow({ where: { id } });
    expect(t.customerRefCipher).toBeNull();
    expect(t.customerRefHash).toBeNull();
    expect(JSON.stringify((await call(detailRoute.GET, { params: { id } })).json ?? {})).not.toContain(PHONE);
  });
});

describe("private sources and the screen recording", () => {
  it("from a private conversation the ticket needs the confirmation (it is read by its department)", async () => {
    const w = await world();
    const dm = await db.conversation.create({ data: { orgId: w.org.id, kind: "GROUP", title: `Private ${uid()}`, members: { create: [{ userId: w.carol.id }, { userId: w.bob.id }] } } });
    const m = await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: dm.id, authorId: w.bob.id, body: "مشكلة بالطلب ZK-2026-000999" } });
    await loginAs(w.carol.id);
    const refused = await report(m.id, { kindKey: "other", departmentId: w.dept.id });
    expect(refused.status).toBe(422);
    const ok = await report(m.id, { kindKey: "other", departmentId: w.dept.id, confirmPublic: true });
    expect(ok.status, ok.text).toBe(201);
  });
  it("«مشكلة بالموقع» is refused without a recording (a file on the message) and accepted with one", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    const bare = await w.say("الموقع واقف");
    expect((await report(bare.id, { kindKey: "website", departmentId: w.dept.id })).status).toBe(422);
    const withFile = await w.say("الموقع واقف وهاد تسجيل");
    const file = await db.storedFile.create({ data: { orgId: w.org.id, uploaderId: w.bob.id, familyId: `f-${uid()}`, name: "rec.mp4", path: `p/${uid()}`, mimeType: "video/mp4", size: 1000, purpose: "CHAT" } });
    await db.messageAttachment.create({ data: { messageId: withFile.id, fileId: file.id, kind: "VIDEO", name: "rec.mp4" } });
    expect((await report(withFile.id, { kindKey: "website", departmentId: w.dept.id })).status).toBe(201);
  });
});

void ({} as World);
