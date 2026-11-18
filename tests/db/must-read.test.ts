import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as mustReadRoute from "@/app/api/chat/messages/[id]/must-read/route";
import * as ackRoute from "@/app/api/chat/messages/[id]/ack/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as reactRoute from "@/app/api/chat/messages/[id]/react/route";
import * as messageRoute from "@/app/api/chat/messages/[id]/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { withFeature } from "@/lib/features";
import { runMustReadReminders } from "@/server/services/must-read";
import { call, db, loginAs, makeUser, uid } from "./helpers";
import { makeTeamsWorld } from "./teams-helpers";

/**
 * Q1.6 «لازم ينقرأ»: an instruction post that people must acknowledge. Against a real PostgreSQL.
 *
 * Pins: the switch off = 404; who may mark a message (topic moderators and holders of `announce.send`), only in a topic and only a text message; who counts
 * (staff the topic reaches, not the author, not a guest, not a suspended person); «قرأت ✓» writes a ✅ reaction (no new table) and removing it un-reads;
 * the author and the moderators see «قرأ 7 من 10» with who has not, everybody else sees only their own state; reminders after 3 working hours and the next
 * working morning, each once, never to somebody who has read or is not active; the list of late readers goes to the author once a day.
 */

async function world(opts: { on?: boolean } = {}) {
  const w = await makeTeamsWorld();
  const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
  await db.organization.update({ where: { id: w.org.id }, data: { timezone: "Asia/Damascus", settings: withFeature(org.settings, "mustRead", opts.on !== false) as Prisma.InputJsonValue } });
  const topic = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.s.id, title: `Rules ${uid()}` } });
  const guest = await makeUser({ orgId: w.org.id, role: "GUEST", name: `Guest ${uid()}` });
  await db.workspaceMember.create({ data: { workspaceId: w.s.id, userId: guest.id, role: "GUEST" } });
  // the instruction: written by bob; alice, carol and the space admin are the people it reaches (the guest never counts)
  const post = await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: topic.id, authorId: w.bob.id, body: "تعليمات جديدة: ما حدا يغيّر السعر", createdAt: new Date("2030-11-11T07:00:00Z") } });
  const mark = (id: string, on = true) => call(mustReadRoute.POST, { params: { id }, body: { on } });
  const ack = (id: string) => call(ackRoute.POST, { params: { id } });
  const unack = (id: string) => call(ackRoute.DELETE, { method: "DELETE", params: { id } });
  const detail = async () => {
    const r = await call(conversationRoute.GET, { params: { id: topic.id } });
    return (r.json!["messages"] as Array<{ id: string; mustRead?: Record<string, unknown> }>).find((m) => m.id === post.id);
  };
  const bells = (userId: string, type = "must_read") => db.notification.count({ where: { userId, type } });
  return { ...w, topic, guest, post, mark, ack, unack, detail, bells };
}
type World = Awaited<ReturnType<typeof world>>;

async function marked(w: World) {
  await loginAs(w.spaceAdmin.id);
  const r = await w.mark(w.post.id);
  expect(r.status, r.text).toBe(200);
  // the tests write the post on a fixed Monday: the mark's own time is that moment (the clock of the reminders starts there)
  await db.chatMessage.update({ where: { id: w.post.id }, data: { ackMeta: { markedAt: w.post.createdAt.toISOString() } } });
}

describe("who may mark a message", () => {
  it("with the switch off the doors answer 404", async () => {
    const w = await world({ on: false });
    await loginAs(w.spaceAdmin.id);
    expect((await w.mark(w.post.id)).status).toBe(404);
  });
  it("a topic moderator and a holder of «إعلانات للجميع» may; a plain member may not; a guest may not", async () => {
    const w = await world();
    await loginAs(w.alice.id);
    expect((await w.mark(w.post.id)).status).toBe(403);
    await loginAs(w.guest.id);
    expect([403, 404]).toContain((await w.mark(w.post.id)).status);
    await loginAs(w.spaceAdmin.id);
    expect((await w.mark(w.post.id)).status).toBe(200);
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: w.post.id } })).ackRequired).toBe(true);
    // the holder of «إعلانات للجميع» must also be able to READ the topic (one who is not gets «not found»)
    await db.workspaceMember.create({ data: { workspaceId: w.s.id, userId: w.admin.id, role: "MEMBER" } });
    await loginAs(w.admin.id);
    expect((await w.mark(w.post.id, false)).status).toBe(200);
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: w.post.id } })).ackRequired).toBe(false);
  });
  it("only a text message of a topic: not a direct message, not a deleted one", async () => {
    const w = await world();
    const dm = await db.conversation.create({ data: { orgId: w.org.id, kind: "DM", members: { create: [{ userId: w.alice.id }, { userId: w.bob.id }] } } });
    const m = await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: dm.id, authorId: w.bob.id, body: "خاص" } });
    await loginAs(w.alice.id);
    expect([403, 404, 422]).toContain((await w.mark(m.id)).status);
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: m.id } })).ackRequired).toBe(false);
    await db.chatMessage.update({ where: { id: w.post.id }, data: { deletedAt: new Date() } });
    await loginAs(w.spaceAdmin.id);
    expect([403, 404, 422]).toContain((await w.mark(w.post.id)).status);
  });
  it("a message can be sent as «لازم ينقرأ» by somebody who may; a plain member's flag is refused", async () => {
    const w = await world();
    await loginAs(w.spaceAdmin.id);
    const ok = await call(messagesRoute.POST, { params: { id: w.topic.id }, body: { body: "إعلان مهم", mustRead: true } });
    expect(ok.status, ok.text).toBe(201);
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: ok.json!["id"] as string } })).ackRequired).toBe(true);
    await loginAs(w.alice.id);
    const no = await call(messagesRoute.POST, { params: { id: w.topic.id }, body: { body: "إعلان مني", mustRead: true } });
    expect(no.status).toBe(403);
  });
});

describe("reading it", () => {
  it("«قرأت ✓» writes a ✅ reaction, once; taking it back un-reads; the author and a guest cannot", async () => {
    const w = await world();
    await marked(w);
    await loginAs(w.alice.id);
    expect((await w.ack(w.post.id)).status).toBe(200);
    expect((await w.ack(w.post.id)).status).toBe(200);
    expect(await db.chatReaction.count({ where: { messageId: w.post.id, userId: w.alice.id, emoji: "✅" } })).toBe(1);
    expect((await w.detail())?.mustRead).toMatchObject({ mine: true, acked: true });
    expect((await w.unack(w.post.id)).status).toBe(200);
    expect(await db.chatReaction.count({ where: { messageId: w.post.id, userId: w.alice.id } })).toBe(0);
    expect((await w.detail())?.mustRead).toMatchObject({ mine: true, acked: false });
    await loginAs(w.bob.id);
    expect([403, 404]).toContain((await w.ack(w.post.id)).status);
    await loginAs(w.guest.id);
    expect([403, 404]).toContain((await w.ack(w.post.id)).status);
  });
  it("the author and the moderators see «قرأ 7 من 10» and who has not; everybody else sees only their own state; a guest sees nothing of it", async () => {
    const w = await world();
    await marked(w);
    await loginAs(w.alice.id);
    await w.ack(w.post.id);
    // who counts: alice, carol, the space admin and the company's other staff in the space — never bob (the author) or the guest
    const audience = await db.workspaceMember.findMany({ where: { workspaceId: w.s.id, role: { not: "GUEST" }, userId: { not: w.bob.id } }, select: { userId: true } });
    await loginAs(w.bob.id);
    const mine = (await w.detail())?.mustRead as { total: number; read: number; missing: Array<{ id: string; name: string }> };
    expect(mine.total).toBe(audience.length);
    expect(mine.read).toBe(1);
    expect(mine.missing.map((m) => m.id)).not.toContain(w.alice.id);
    expect(mine.missing.map((m) => m.id)).toContain(w.carol.id);
    await loginAs(w.carol.id);
    const theirs = (await w.detail())?.mustRead as Record<string, unknown>;
    expect(theirs).toMatchObject({ mine: true, acked: false });
    expect(theirs["missing"]).toBeUndefined();
    expect(theirs["total"]).toBeUndefined();
    await loginAs(w.guest.id);
    expect((await w.detail())?.mustRead).toBeUndefined();
  });
  it("a suspended person is not counted", async () => {
    const w = await world();
    await marked(w);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.carol.id } }, data: { status: "SUSPENDED" } });
    await loginAs(w.bob.id);
    const mr = (await w.detail())?.mustRead as { missing: Array<{ id: string }> };
    expect(mr.missing.map((m) => m.id)).not.toContain(w.carol.id);
  });
});

describe("the reminders", () => {
  // the post was written Monday 11 Nov 2030 09:00 (Damascus, UTC+2) = 07:00Z; working hours 09:00-18:00, Friday off
  const at = (iso: string) => new Date(iso);
  it("after 3 working hours the people who have not read are reminded once, not those who have", async () => {
    const w = await world();
    await marked(w);
    await loginAs(w.alice.id);
    await w.ack(w.post.id);
    await runMustReadReminders(at("2030-11-11T09:00:00Z")); // 11:00 local: 2 working hours
    expect(await w.bells(w.carol.id)).toBe(0);
    await runMustReadReminders(at("2030-11-11T10:30:00Z")); // 12:30 local: 3.5 working hours
    expect(await w.bells(w.carol.id)).toBe(1);
    expect(await w.bells(w.alice.id)).toBe(0);
    expect(await w.bells(w.bob.id)).toBe(0);
    await runMustReadReminders(at("2030-11-11T11:30:00Z"));
    expect(await w.bells(w.carol.id)).toBe(1);
  });
  it("again the next working morning, once; Friday is skipped", async () => {
    const w = await world();
    await marked(w);
    await runMustReadReminders(at("2030-11-11T10:30:00Z"));
    expect(await w.bells(w.carol.id)).toBe(1);
    await runMustReadReminders(at("2030-11-12T05:00:00Z")); // Tuesday 07:00 local: before opening
    expect(await w.bells(w.carol.id)).toBe(1);
    await runMustReadReminders(at("2030-11-12T07:30:00Z")); // Tuesday 09:30 local
    expect(await w.bells(w.carol.id)).toBe(2);
    await runMustReadReminders(at("2030-11-12T12:00:00Z"));
    expect(await w.bells(w.carol.id)).toBe(2);
  });
  it("the list of late readers goes to the author once a day, on a working day, in a run that did not remind; nothing when everybody has read; nothing when the switch is off", async () => {
    const w = await world();
    await marked(w);
    await db.chatMessage.update({ where: { id: w.post.id }, data: { ackMeta: { markedAt: "2030-11-11T07:00:00.000Z" } } });
    await runMustReadReminders(at("2030-11-11T10:30:00Z")); // Monday: the first reminder
    expect(await w.bells(w.bob.id, "must_read_late")).toBe(0);
    await runMustReadReminders(at("2030-11-12T07:30:00Z")); // Tuesday morning: the second reminder
    expect(await w.bells(w.bob.id, "must_read_late")).toBe(0);
    await runMustReadReminders(at("2030-11-13T07:30:00Z")); // Wednesday morning: nothing to remind, the list
    expect(await w.bells(w.bob.id, "must_read_late")).toBe(1);
    await runMustReadReminders(at("2030-11-13T12:00:00Z"));
    expect(await w.bells(w.bob.id, "must_read_late")).toBe(1);
    await runMustReadReminders(at("2030-11-15T08:00:00Z")); // Friday: a day off
    expect(await w.bells(w.bob.id, "must_read_late")).toBe(1);
    const done = await world();
    await loginAs(done.spaceAdmin.id);
    await done.mark(done.post.id);
    const everyone = await db.workspaceMember.findMany({ where: { workspaceId: done.s.id, role: { not: "GUEST" }, userId: { not: done.bob.id } }, select: { userId: true } });
    for (const m of everyone) await db.chatReaction.create({ data: { messageId: done.post.id, userId: m.userId, emoji: "✅" } });
    await runMustReadReminders(at("2030-11-13T07:30:00Z"));
    expect(await done.bells(done.bob.id, "must_read_late")).toBe(0);
    const off = await world({ on: false });
    await db.chatMessage.update({ where: { id: off.post.id }, data: { ackRequired: true } });
    await runMustReadReminders(at("2030-11-11T10:30:00Z"));
    expect(await off.bells(off.carol.id)).toBe(0);
  });
  it("a person who left is not reminded", async () => {
    const w = await world();
    await marked(w);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.carol.id } }, data: { status: "OFFBOARDED" } });
    await runMustReadReminders(at("2030-11-11T10:30:00Z"));
    expect(await w.bells(w.carol.id)).toBe(0);
  });
});

describe("review fixes", () => {
  const at = (iso: string) => new Date(iso);
  it("the clock starts when the message is marked, not when it was written: an old post marked this morning waits its 3 hours", async () => {
    const w = await world();
    await db.chatMessage.update({ where: { id: w.post.id }, data: { createdAt: new Date("2030-11-04T07:00:00Z") } });
    await marked(w);
    await db.chatMessage.update({ where: { id: w.post.id }, data: { ackMeta: { markedAt: "2030-11-11T07:00:00.000Z" } } });
    await runMustReadReminders(at("2030-11-11T08:30:00Z")); // 1.5 working hours after the mark
    expect(await w.bells(w.carol.id)).toBe(0);
    await runMustReadReminders(at("2030-11-11T10:30:00Z"));
    expect(await w.bells(w.carol.id)).toBe(1);
    // marking sets the mark's own time
    const fresh = await db.chatMessage.findUniqueOrThrow({ where: { id: (await world()).post.id } });
    expect(fresh.ackRequired).toBe(false);
  });
  it("marking records the moment of the mark", async () => {
    const w = await world();
    await loginAs(w.spaceAdmin.id);
    expect((await w.mark(w.post.id)).status).toBe(200);
    const m = await db.chatMessage.findUniqueOrThrow({ where: { id: w.post.id } });
    expect(typeof (m.ackMeta as { markedAt?: string }).markedAt).toBe("string");
  });
  it("two runs at the same moment remind once", async () => {
    const w = await world();
    await marked(w);
    await db.chatMessage.update({ where: { id: w.post.id }, data: { ackMeta: { markedAt: "2030-11-11T07:00:00.000Z" } } });
    await Promise.all([runMustReadReminders(at("2030-11-11T10:30:00Z")), runMustReadReminders(at("2030-11-11T10:30:00Z"))]);
    expect(await w.bells(w.carol.id)).toBe(1);
  });
  it("somebody who cannot read the topic gets «not found» from both doors, not a hint that the message exists", async () => {
    const w = await world();
    const secret = await db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId: w.s.id, title: `Secret ${uid()}`, restricted: true, members: { create: [{ userId: w.carol.id }, { userId: w.bob.id }] } } });
    const m = await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: secret.id, authorId: w.bob.id, body: "خاص بالمجموعة" } });
    await loginAs(w.admin.id);
    expect((await w.mark(m.id)).status).toBe(404);
    await db.chatMessage.update({ where: { id: m.id }, data: { ackRequired: true } });
    expect((await w.ack(m.id)).status).toBe(404);
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: m.id } })).ackRequired).toBe(true);
  });
  it("the ✅ is the acknowledgement only: the reaction bar refuses it", async () => {
    const w = await world();
    await marked(w);
    await loginAs(w.guest.id);
    const r = await call(reactRoute.POST, { params: { id: w.post.id }, body: { emoji: "✅" } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(await db.chatReaction.count({ where: { messageId: w.post.id, emoji: "✅" } })).toBe(0);
  });
  it("a reminder never keeps the text of a message that was edited or deleted", async () => {
    const w = await world();
    await marked(w);
    await db.chatMessage.update({ where: { id: w.post.id }, data: { ackMeta: { markedAt: "2030-11-11T07:00:00.000Z" } } });
    await runMustReadReminders(at("2030-11-11T10:30:00Z"));
    const before = await db.notification.findFirstOrThrow({ where: { userId: w.carol.id, type: "must_read" } });
    expect(before.body).toContain("تعليمات");
    await loginAs(w.bob.id);
    await call(messageRoute.DELETE, { method: "DELETE", params: { id: w.post.id } });
    const after = await db.notification.findFirstOrThrow({ where: { userId: w.carol.id, type: "must_read" } });
    expect(after.body).not.toContain("تعليمات");
  });
  it("a double tap on «قرأت ✓» is not an error", async () => {
    const w = await world();
    await marked(w);
    await loginAs(w.alice.id);
    const both = await Promise.all([w.ack(w.post.id), w.ack(w.post.id)]);
    expect(both.map((b) => b.status)).toEqual([200, 200]);
    expect(await db.chatReaction.count({ where: { messageId: w.post.id, userId: w.alice.id, emoji: "✅" } })).toBe(1);
  });
});
