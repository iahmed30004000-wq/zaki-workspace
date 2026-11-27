/**
 * «الرد في محادثة أخرى» — THE PRIVACY RULE against a real database (src/server/chat/cross-reply.ts):
 *  the sender must read the source and may post in the target; the others in the target get only the carried words (never the source's id, conversation or file names);
 *  the way to the source is only for whoever may read it; a deleted source takes its words away; nothing of the quote reaches search, the bell, the list or a forward.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sendLimiter } from "@/server/chat/messages";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as messageRoute from "@/app/api/chat/messages/[id]/route";
import * as crossRoute from "@/app/api/chat/messages/[id]/cross-reply/route";
import * as hideRoute from "@/app/api/chat/messages/[id]/hide/route";
import * as forwardRoute from "@/app/api/chat/messages/[id]/forward/route";
import * as syncRoute from "@/app/api/chat/sync/route";
import { searchConversation } from "@/server/chat/search";
import { openDm } from "@/server/chat/dm";
import { resetPresenceForTests } from "@/server/realtime/presence";
import type { MessageDto, MessagesPageDto, SyncDto } from "@/server/chat/dto";
import { call, db, loginAs, makeOrg, makeTeam, makeUser, makeWorkspace } from "./helpers";

async function world() {
  resetPresenceForTests();
  const t = await makeTeam();
  const orgId = t.org.id;
  const a = t.member; // reads the source and posts in the target
  const b = await makeUser({ orgId, role: "MEMBER", name: "Bee" }); // reads both
  const c = await makeUser({ orgId, role: "MEMBER", name: "Cee" }); // reads the target only
  const writer = await makeUser({ orgId, role: "MEMBER", name: "Writer" });
  const space = await makeWorkspace(orgId, [{ userId: a.id }, { userId: b.id }, { userId: c.id }, { userId: writer.id }, { userId: t.guest.id, role: "GUEST" }], "Space");
  const topic = (title: string, extra: Record<string, unknown> = {}) => db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title, ...extra } });
  const secret = await topic("غرفة سرية جدا", { restricted: true, members: { create: [{ userId: a.id }, { userId: b.id }, { userId: writer.id }] } });
  const open = await topic("المفتوح");
  const admins = await topic("للمشرفين", { postingPolicy: "ADMINS" });
  const archived = await topic("المؤرشف", { archivedAt: new Date() });
  await loginAs(a.id);
  const dm = (await openDm({ orgId, orgRole: "MEMBER", userId: a.id }, writer.id, space.id)).id;
  const other = await makeOrg();
  const outsider = await makeUser({ orgId: other.id, role: "MEMBER", name: "Outsider" });
  const otherSpace = await makeWorkspace(other.id, [{ userId: outsider.id }]);
  const otherTopic = await db.conversation.create({ data: { orgId: other.id, kind: "TOPIC", spaceId: otherSpace.id, title: "Other" } });
  const foreign = await db.chatMessage.create({ data: { orgId: other.id, conversationId: otherTopic.id, authorId: outsider.id, body: "foreign words" } });
  return { ...t, orgId, a, b, c, writer, space, secret, open, admins, archived, dm, foreign };
}
let w: Awaited<ReturnType<typeof world>>;
beforeAll(async () => {
  w = await world();
});
// the send quota is per person and per minute: each case starts with a fresh one
beforeEach(() => {
  for (const person of [w.a, w.b, w.c, w.writer, w.owner]) sendLimiter.reset(`chat.send.${person.id}`);
});

const written = (conversationId: string, body: string, extra: Record<string, unknown> = {}) => db.chatMessage.create({ data: { orgId: w.orgId, conversationId, authorId: w.writer.id, body, ...extra } });
const send = (conversationId: string, body: Record<string, unknown>) => call(messagesRoute.POST, { params: { id: conversationId }, body });
const reply = (conversationId: string, sourceId: string, text = "ردّي", more: Record<string, unknown> = {}) => send(conversationId, { body: text, crossReply: { messageId: sourceId }, ...more });
const page = async (userId: string, conversationId: string) => {
  await loginAs(userId);
  const res = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${conversationId}/messages`, params: { id: conversationId } });
  expect(res.status, res.text).toBe(200);
  return { text: res.text, messages: (res.json as unknown as MessagesPageDto).messages };
};
const door = (id: string) => call(crossRoute.GET, { url: `http://localhost/api/chat/messages/${id}/cross-reply`, params: { id } });
const setSwitch = (on: boolean | null) => db.organization.update({ where: { id: w.orgId }, data: { settings: on === null ? {} : { features: { chatReplyElsewhere: on } } } });

describe("who may carry what", () => {
  it("a person who reads the source and posts in the target: the quote is the SERVER's snapshot, and anything the browser adds is ignored", async () => {
    const source = await written(w.secret.id, "**السعر** النهائي ||سري للغاية|| تأكد");
    await loginAs(w.a.id);
    const res = await send(w.open.id, { body: "شوفوا هاد", crossReply: { messageId: source.id, authorName: "منتحل", text: "كلام ملفق" } });
    expect(res.status, res.text).toBe(201);
    const dto = res.json as unknown as MessageDto;
    expect(dto.crossReply).toEqual({ authorName: "Writer", text: "السعر النهائي ••• تأكد", kind: "text", jump: true });
    const row = await db.chatMessage.findUniqueOrThrow({ where: { id: dto.id } });
    expect(row.crossReplyToId).toBe(source.id);
    expect(row.crossReply).toEqual({ author: "Writer", text: "السعر النهائي ••• تأكد", kind: "text" });
    expect(row.replyToId).toBeNull();
    expect(JSON.stringify(row.crossReply)).not.toContain("للغاية");
  });

  it("somebody in the target who cannot read the source gets the carried words only: no id, no conversation, no way there", async () => {
    const source = await written(w.secret.id, "رقم الخزنة تحت الدرج");
    await loginAs(w.a.id);
    const made = (await reply(w.open.id, source.id)).json as unknown as MessageDto;
    const seen = await page(w.c.id, w.open.id);
    const mine = seen.messages.find((m) => m.id === made.id)!;
    expect(mine.crossReply).toEqual({ authorName: "Writer", text: "رقم الخزنة تحت الدرج", kind: "text" });
    expect(seen.text).not.toContain(source.id);
    expect(seen.text).not.toContain(w.secret.id);
    expect(seen.text).not.toContain("غرفة سرية جدا");
    expect((await door(made.id)).status).toBe(404);
    // a reader of the source is offered the way, and the door gives it
    const theirs = (await page(w.b.id, w.open.id)).messages.find((m) => m.id === made.id)!;
    expect(theirs.crossReply?.jump).toBe(true);
    const there = await door(made.id);
    expect(there.status).toBe(200);
    expect(there.json).toEqual({ conversationId: w.secret.id, messageId: source.id });
  });

  it("a guest in the target reads the words without the writer's name and is never offered the way", async () => {
    const source = await written(w.open.id, "كلام من المفتوح");
    const guestTopic = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: "مع الشريك" } });
    await loginAs(w.a.id);
    const made = (await reply(guestTopic.id, source.id)).json as unknown as MessageDto;
    const seen = (await page(w.guest.id, guestTopic.id)).messages.find((m) => m.id === made.id)!;
    expect(seen.crossReply).toEqual({ authorName: "", text: "كلام من المفتوح", kind: "text" });
    expect((await door(made.id)).status).toBe(404);
  });

  it("a source I cannot read, of another company, hidden by me or unknown is the same «not found», and nothing is written", async () => {
    const source = await written(w.secret.id, "ما بتشوفها");
    const mine = await written(w.secret.id, "خبيتها");
    const before = await db.chatMessage.count({ where: { conversationId: w.open.id } });
    await loginAs(w.c.id);
    for (const id of [source.id, w.foreign.id, "nope"]) {
      const res = await reply(w.open.id, id);
      expect(res.status).toBe(404);
      expect(res.text).toContain("chat.e.cross_not_found");
    }
    await db.organization.update({ where: { id: w.orgId }, data: { settings: { features: { chatLayoutV2: true } } } });
    await loginAs(w.a.id);
    expect((await call(hideRoute.POST, { params: { id: mine.id } })).status).toBe(200);
    expect((await reply(w.open.id, mine.id)).status).toBe(404);
    await setSwitch(null);
    expect(await db.chatMessage.count({ where: { conversationId: w.open.id } })).toBe(before);
  });

  it("I must be able to POST in the target; an archived topic, the same conversation, two replies at once, a deleted source and a system line are refused", async () => {
    const source = await written(w.secret.id, "مصدر");
    const gone = await written(w.secret.id, "محذوفة", { deletedAt: new Date() });
    const system = await written(w.secret.id, JSON.stringify({ k: "join", p: {} }), { kind: "SYSTEM" });
    const here = await written(w.open.id, "هون");
    await loginAs(w.a.id);
    expect((await reply(w.admins.id, source.id)).status).toBe(403);
    expect((await reply(w.archived.id, source.id)).status).toBe(403);
    expect((await reply(w.secret.id, source.id)).status).toBe(422);
    expect((await reply(w.open.id, source.id, "ردّين", { replyToId: here.id })).status).toBe(422);
    expect((await reply(w.open.id, gone.id)).status).toBe(403);
    expect((await reply(w.open.id, system.id)).status).toBe(403);
    // c is not in the restricted topic: he cannot post INTO it either, whatever he may read
    await loginAs(w.c.id);
    expect((await reply(w.secret.id, here.id)).status).toBe(403);
  });

  it("the silent eye carries nothing out of a conversation it only reads: it joins first", async () => {
    const source = await written(w.dm, "حكي خاص بين اثنين");
    await loginAs(w.owner.id);
    await db.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: w.space.id, userId: w.owner.id } }, create: { workspaceId: w.space.id, userId: w.owner.id }, update: {} });
    await db.conversationMember.upsert({ where: { conversationId_userId: { conversationId: w.open.id, userId: w.owner.id } }, create: { conversationId: w.open.id, userId: w.owner.id }, update: {} });
    const res = await reply(w.open.id, source.id);
    expect(res.status, res.text).toBe(403);
    expect(res.text).toContain("chat.e.join_first");
  });
});

describe("when the source changes", () => {
  it("an edit does not change what was carried; a delete takes the words from everybody and tells the target live", async () => {
    const source = await written(w.secret.id, "النسخة الأولى");
    await loginAs(w.a.id);
    const made = (await reply(w.open.id, source.id)).json as unknown as MessageDto;
    await loginAs(w.writer.id);
    expect((await call(messageRoute.PATCH, { method: "PATCH", params: { id: source.id }, body: { body: "النسخة الثانية" } })).status).toBe(200);
    expect((await page(w.c.id, w.open.id)).messages.find((m) => m.id === made.id)!.crossReply?.text).toBe("النسخة الأولى");

    await loginAs(w.c.id);
    const cursor = ((await call(syncRoute.GET, { url: "http://localhost/api/chat/sync" })).json as unknown as SyncDto).cursor;
    await loginAs(w.writer.id);
    expect((await call(messageRoute.DELETE, { method: "DELETE", params: { id: source.id } })).status).toBe(200);
    await loginAs(w.c.id);
    const feed = await call(syncRoute.GET, { url: `http://localhost/api/chat/sync?after=${cursor}` });
    const told = (feed.json as unknown as SyncDto).messages.find((m) => m.id === made.id)!;
    expect(told.crossReply).toEqual({ authorName: "Writer", text: null, kind: "text", gone: true });
    expect(feed.text).not.toContain("النسخة الأولى");
    for (const person of [w.a.id, w.b.id, w.c.id, w.owner.id]) {
      const seen = await page(person, w.open.id);
      expect(seen.messages.find((m) => m.id === made.id)!.crossReply).toMatchObject({ text: null, gone: true });
      expect(seen.messages.find((m) => m.id === made.id)!.crossReply?.jump).toBeUndefined();
    }
    await loginAs(w.a.id);
    expect((await door(made.id)).status).toBe(404);
  });
});

describe("the carried words go nowhere else", () => {
  it("not into search, the bell, the message's own words or a forward of the reply", async () => {
    const source = await written(w.secret.id, "كلمةفريدةللبحث عن المورد");
    await loginAs(w.a.id);
    const made = (await reply(w.open.id, source.id, "تمام @Cee")).json as unknown as MessageDto;
    expect(await searchConversation({ orgId: w.orgId, orgRole: "MEMBER", userId: w.c.id }, w.open.id, "كلمةفريدةللبحث")).toEqual([]);
    const bells = await db.notification.findMany({ where: { userId: { in: [w.c.id, w.b.id] } }, select: { title: true, body: true } });
    expect(JSON.stringify(bells)).not.toContain("كلمةفريدةللبحث");
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: made.id } })).body).toBe("تمام @Cee");
    const copy = await call(forwardRoute.POST, { params: { id: made.id }, body: { conversationId: w.dm } });
    expect(copy.status, copy.text).toBe(201);
    const row = await db.chatMessage.findUniqueOrThrow({ where: { id: (copy.json as { id: string }).id } });
    expect(row.crossReply).toBeNull();
    expect(row.crossReplyToId).toBeNull();
  });

  it("a file is named by its kind only: no file name travels", async () => {
    const source = await written(w.secret.id, "");
    const file = await db.storedFile.create({ data: { orgId: w.orgId, uploaderId: w.writer.id, familyId: `f-${source.id}`, name: "رواتب-الموظفين.pdf", mimeType: "application/pdf", size: 4, path: `x-${source.id}`, purpose: "CHAT" } });
    await db.messageAttachment.create({ data: { messageId: source.id, fileId: file.id, kind: "FILE" } });
    await loginAs(w.a.id);
    const made = (await reply(w.open.id, source.id)).json as unknown as MessageDto;
    expect(made.crossReply).toMatchObject({ text: "", kind: "file" });
    const seen = await page(w.c.id, w.open.id);
    expect(seen.text).not.toContain("رواتب");
  });
});

describe("the company's switch", () => {
  it("off: the send refuses it, no quote is sent, the door is closed; on again the stored quote is back", async () => {
    const source = await written(w.secret.id, "قبل الإطفاء");
    await loginAs(w.a.id);
    const made = (await reply(w.open.id, source.id)).json as unknown as MessageDto;
    await setSwitch(false);
    await loginAs(w.a.id);
    expect((await reply(w.open.id, source.id)).status).toBe(404);
    expect((await page(w.b.id, w.open.id)).messages.find((m) => m.id === made.id)!.crossReply).toBeUndefined();
    expect((await door(made.id)).status).toBe(404);
    await setSwitch(null);
    expect((await page(w.b.id, w.open.id)).messages.find((m) => m.id === made.id)!.crossReply?.text).toBe("قبل الإطفاء");
  });
});
