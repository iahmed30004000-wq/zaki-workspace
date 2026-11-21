/**
 * S5.7 — «حذف عندي» (delete for me), «رد بالاقتباس» (quote) and the date jump, on a real database.
 *
 * Hiding a message is ONE row of the person (`ChatMessageHidden`): it leaves every read path of THAT person — the page, the sync feed, the in-chat search, the media
 * tabs, the list's last line and the unread counts — and changes nothing for anybody else, nothing in the owner's archive, and nothing about who may delete for
 * everybody. A quote is the piece of the parent's words the sender picked: stored with the reply, never forged, never kept for a deleted parent.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as hideRoute from "@/app/api/chat/messages/[id]/hide/route";
import * as deleteManyRoute from "@/app/api/chat/messages/delete/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { claimUploads } from "@/server/chat/attachments";
import type { MessageDto, MessagesPageDto, SyncDto } from "@/server/chat/dto";
import { chatList } from "@/server/chat/list";
import { listConversationMedia } from "@/server/chat/media";
import { deleteMessage, sendMessage } from "@/server/chat/messages";
import { searchConversation } from "@/server/chat/search";
import { syncFeed } from "@/server/chat/sync";
import { unreadTotal } from "@/server/chat/unread";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

type Role = "OWNER" | "ADMIN" | "LEAD" | "MEMBER" | "GUEST";
const ctxOf = (orgId: string, userId: string, orgRole: Role = "MEMBER") => ({ orgId, userId, orgRole });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const a = t.member; // the person who hides
  const b = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const outsider = await makeUser({ orgId, role: "MEMBER", name: "Outsider" });
  const space = await makeWorkspace(orgId, [{ userId: a.id }, { userId: b.id }, { userId: t.admin.id, role: "ADMIN" }]);
  const topic = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "عام" } });
  const restricted = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: space.id, title: "سري", restricted: true, members: { create: [{ userId: b.id }] } } });
  await db.conversationMember.create({ data: { conversationId: topic.id, userId: a.id, lastReadAt: new Date(0) } });
  await db.organization.update({ where: { id: orgId }, data: { settings: { features: { chatLayoutV2: true, chatMultiSelect: true } } } });
  const base = Date.parse("2026-11-10T09:00:00.000Z");
  let n = 0;
  const say = (conversationId: string, authorId: string, body: string, extra: Record<string, unknown> = {}) =>
    db.chatMessage.create({ data: { orgId, conversationId, authorId, body, createdAt: new Date(base + 60_000 * n++), ...extra } });
  return { ...t, orgId, a, b, outsider, space, topic, restricted, say };
}
type World = Awaited<ReturnType<typeof world>>;

const pageOf = async (w: World, viewerId: string, query = "") => {
  await loginAs(viewerId);
  const res = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}/messages${query}`, params: { id: w.topic.id } });
  expect(res.status).toBe(200);
  return res.json as unknown as MessagesPageDto;
};
const idsOf = (page: MessagesPageDto) => page.messages.map((m) => m.id);

async function hide(viewerId: string, messageId: string) {
  await loginAs(viewerId);
  return call(hideRoute.POST, { method: "POST", url: `http://localhost/api/chat/messages/${messageId}/hide`, params: { id: messageId } });
}

describe("«حذف عندي»: the message leaves every read path of the person who hid it, and only theirs", () => {
  it("the page: gone for the person, still there for everybody else", async () => {
    const w = await world();
    const keep = await w.say(w.topic.id, w.b.id, "keep");
    const gone = await w.say(w.topic.id, w.b.id, "gone");
    expect((await hide(w.a.id, gone.id)).status).toBe(200);
    expect(idsOf(await pageOf(w, w.a.id))).toEqual([keep.id]);
    for (const other of [w.b, w.admin, w.owner]) expect(idsOf(await pageOf(w, other.id)), other.name).toEqual([keep.id, gone.id]);
    // the row says nothing else changed: not deleted, not edited
    const row = await db.chatMessage.findUniqueOrThrow({ where: { id: gone.id } });
    expect(row.deletedAt).toBeNull();
    expect(row.body).toBe("gone");
  });

  it("works for a message of somebody else AND for my own, is idempotent, and a window around it does not return it", async () => {
    const w = await world();
    const mine = await w.say(w.topic.id, w.a.id, "my words");
    const theirs = await w.say(w.topic.id, w.b.id, "their words");
    expect((await hide(w.a.id, mine.id)).status).toBe(200);
    expect((await hide(w.a.id, theirs.id)).status).toBe(200);
    expect((await hide(w.a.id, theirs.id)).status).toBe(200);
    expect(await db.chatMessageHidden.count({ where: { userId: w.a.id } })).toBe(2);
    expect(idsOf(await pageOf(w, w.a.id))).toEqual([]);
    expect(idsOf(await pageOf(w, w.a.id, `?around=${mine.id}`))).toEqual([]);
  });

  it("a page that is all hidden still pages: older messages beyond it come back", async () => {
    const w = await world();
    const old = await w.say(w.topic.id, w.b.id, "old and visible");
    const hiddenOnes: string[] = [];
    for (let i = 0; i < 5; i++) hiddenOnes.push((await w.say(w.topic.id, w.b.id, `h${i}`)).id);
    for (const id of hiddenOnes) await hide(w.a.id, id);
    const page = await pageOf(w, w.a.id, "?limit=5");
    expect(idsOf(page)).toEqual([old.id]);
  });

  it("a message of a conversation the person cannot read cannot be hidden (404) and nothing is written", async () => {
    const w = await world();
    const secret = await w.say(w.restricted.id, w.b.id, "restricted words");
    const res = await hide(w.a.id, secret.id);
    expect(res.status).toBe(404);
    expect(await db.chatMessageHidden.count({ where: { messageId: secret.id } })).toBe(0);
    // a person of another company
    const other = await makeTeam();
    const foreign = await hide(other.member.id, (await w.say(w.topic.id, w.b.id, "x")).id);
    expect(foreign.status).toBe(404);
  });

  it("the sync feed: the other device learns the id (`hidden`), the message is never returned to the person again, others get nothing", async () => {
    const w = await world();
    const msg = await w.say(w.topic.id, w.b.id, "to hide");
    const aCtx = ctxOf(w.orgId, w.a.id);
    const bCtx = ctxOf(w.orgId, w.b.id);
    const start = (await syncFeed(aCtx)).cursor;
    const startB = (await syncFeed(bCtx)).cursor;
    await hide(w.a.id, msg.id);
    const mine: SyncDto = await syncFeed(aCtx, { after: BigInt(start) });
    expect(mine.hidden).toEqual([msg.id]);
    expect(mine.messages.map((m) => m.id)).not.toContain(msg.id);
    const theirs: SyncDto = await syncFeed(bCtx, { after: BigInt(startB) });
    expect(theirs.hidden ?? []).toEqual([]);
    // the author edits it afterwards: the person who hid it still does not get it
    await db.chatMessage.update({ where: { id: msg.id }, data: { body: "edited", editedAt: new Date() } });
    await db.realtimeEvent.create({ data: { orgId: w.orgId, kind: "message.edited", ids: { conversationId: w.topic.id, messageId: msg.id } } });
    const again: SyncDto = await syncFeed(aCtx, { after: BigInt(mine.cursor) });
    expect(again.messages.map((m) => m.id)).not.toContain(msg.id);
    const stillB: SyncDto = await syncFeed(bCtx, { after: BigInt(theirs.cursor) });
    expect(stillB.messages.map((m) => m.id)).toContain(msg.id);
  });

  it("the in-chat search does not find it for the person, and finds it for the others", async () => {
    const w = await world();
    const msg = await w.say(w.topic.id, w.b.id, "كلمةفريدةجدا هنا");
    await hide(w.a.id, msg.id);
    expect(await searchConversation(ctxOf(w.orgId, w.a.id), w.topic.id, "كلمةفريدةجدا")).toEqual([]);
    expect((await searchConversation(ctxOf(w.orgId, w.b.id), w.topic.id, "كلمةفريدةجدا")).map((h) => h.id)).toEqual([msg.id]);
    // the date jump and «من:» are narrowing views of the same rule
    expect(await searchConversation(ctxOf(w.orgId, w.a.id), w.topic.id, "", { from: w.b.id })).toEqual([]);
  });

  it("the media tabs: a picture of a hidden message is not counted or listed for the person", async () => {
    const w = await world();
    const dir = process.env["UPLOAD_DIR"] ?? path.join(process.cwd(), ".data", "uploads");
    await mkdir(dir, { recursive: true });
    const withPhoto = async (name: string) => {
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      await writeFile(path.join(dir, id), PNG);
      const file = await db.storedFile.create({ data: { id, orgId: w.orgId, uploaderId: w.b.id, familyId: id, name, mimeType: "image/png", size: PNG.length, path: id, purpose: "CHAT" } });
      const msg = await w.say(w.topic.id, w.b.id, name);
      await db.$transaction((tx) => claimUploads(tx, { orgId: w.orgId, uploaderId: w.b.id, conversationId: w.topic.id, messageId: msg.id, attachmentIds: [file.id] }));
      return msg;
    };
    const one = await withPhoto("one.png");
    const two = await withPhoto("two.png");
    await hide(w.a.id, two.id);
    const counts = (await listConversationMedia(ctxOf(w.orgId, w.a.id), w.topic.id, { counts: "1" })) as { counts: { IMAGE: number } };
    expect(counts.counts.IMAGE).toBe(1);
    const list = (await listConversationMedia(ctxOf(w.orgId, w.a.id), w.topic.id, { kind: "IMAGE" })) as { items: { messageId: string }[] };
    expect(list.items.map((i) => i.messageId)).toEqual([one.id]);
    const others = (await listConversationMedia(ctxOf(w.orgId, w.b.id), w.topic.id, { kind: "IMAGE" })) as { items: { messageId: string }[] };
    expect(others.items.map((i) => i.messageId).sort()).toEqual([one.id, two.id].sort());
  });

  it("the list: the last line skips it and the unread number drops (the badge too)", async () => {
    const w = await world();
    await w.say(w.topic.id, w.b.id, "first");
    await w.say(w.topic.id, w.b.id, "second");
    const last = await w.say(w.topic.id, w.b.id, "last-hidden");
    const aCtx = ctxOf(w.orgId, w.a.id);
    const rowOf = async (c: ReturnType<typeof ctxOf>) => (await chatList(c, { spaceId: w.space.id })).rows.find((r) => r.id === w.topic.id)!;
    const before = await rowOf(aCtx);
    expect(before.unread).toBe(3);
    expect(before.lastMessage?.id).toBe(last.id);
    const totalBefore = await unreadTotal(aCtx);
    await hide(w.a.id, last.id);
    const after = await rowOf(aCtx);
    expect(after.unread).toBe(2);
    expect(after.lastMessage?.preview ?? "").toContain("second");
    expect(await unreadTotal(aCtx)).toBe(totalBefore - 1);
    // everybody else is unchanged
    await db.conversationMember.upsert({ where: { conversationId_userId: { conversationId: w.topic.id, userId: w.admin.id } }, create: { conversationId: w.topic.id, userId: w.admin.id, lastReadAt: new Date(0) }, update: {} });
    const adminRow = await rowOf(ctxOf(w.orgId, w.admin.id, "ADMIN"));
    expect(adminRow.lastMessage?.id).toBe(last.id);
  });

  it("a mention that was hidden no longer counts as an unread mention", async () => {
    const w = await world();
    const m = await w.say(w.topic.id, w.b.id, "@أنت", { mentions: [w.a.id] });
    const row = async () => (await chatList(ctxOf(w.orgId, w.a.id), { spaceId: w.space.id })).rows.find((r) => r.id === w.topic.id)!;
    expect((await row()).mentionsUnread).toBe(1);
    await hide(w.a.id, m.id);
    expect((await row()).mentionsUnread).toBe(0);
  });

  it("does not touch deletion for everybody: the owner's archive still holds a message the person hid and the author later deleted", async () => {
    const w = await world();
    const m = await w.say(w.topic.id, w.b.id, "will be deleted for all");
    await hide(w.a.id, m.id);
    await deleteMessage(ctxOf(w.orgId, w.b.id), m.id);
    const row = await db.chatMessage.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.body).toBe("will be deleted for all"); // kept for the owner's archive
    const ownerPage = await pageOf(w, w.owner.id);
    expect(ownerPage.messages.find((x) => x.id === m.id)?.original?.body).toBe("will be deleted for all");
    // and a person who hid it is still not allowed to delete it for everybody
    await expect(deleteMessage(ctxOf(w.orgId, w.a.id), (await w.say(w.topic.id, w.b.id, "not mine")).id)).rejects.toThrow();
  });

  it("the multi-select door: `forMe` hides each readable id, reports each, deletes nothing", async () => {
    const w = await world();
    const x = await w.say(w.topic.id, w.b.id, "x");
    const y = await w.say(w.topic.id, w.b.id, "y");
    const secret = await w.say(w.restricted.id, w.b.id, "secret");
    await loginAs(w.a.id);
    const res = await call(deleteManyRoute.POST, { body: { ids: [x.id, y.id, secret.id], forMe: true } });
    expect(res.status).toBe(200);
    const results = res.json?.["results"] as { id: string; ok: boolean }[];
    expect(results.filter((r) => r.ok).map((r) => r.id).sort()).toEqual([x.id, y.id].sort());
    expect(results.find((r) => r.id === secret.id)?.ok).toBe(false);
    expect((await db.chatMessage.findMany({ where: { id: { in: [x.id, y.id] } } })).every((m) => m.deletedAt === null)).toBe(true);
    expect(idsOf(await pageOf(w, w.a.id))).toEqual([]);
  });

  it("the door is behind the new chat screen: with `chatLayoutV2` off it answers 404", async () => {
    const w = await world();
    const m = await w.say(w.topic.id, w.b.id, "m");
    await db.organization.update({ where: { id: w.orgId }, data: { settings: { features: { chatLayoutV2: false } } } });
    expect((await hide(w.a.id, m.id)).status).toBe(404);
  });
});

describe("«رد بالاقتباس»: the quote travels with the reply", () => {
  const send = (w: World, who: { id: string }, body: string, extra: Record<string, unknown>) => sendMessage(ctxOf(w.orgId, who.id), w.topic.id, { body, ...extra } as never);

  it("a piece the parent really holds is stored and shown in the reply block; the reader sees it with the reply", async () => {
    const w = await world();
    const parent = await w.say(w.topic.id, w.b.id, "الاجتماع بكرة الساعة عشرة الصبح بالمكتب");
    const reply = await send(w, w.a, "تمام", { replyToId: parent.id, replyQuote: "الساعة عشرة الصبح" });
    expect(reply.replyTo?.quote).toBe("الساعة عشرة الصبح");
    const stored = await db.chatMessage.findUniqueOrThrow({ where: { id: reply.id } });
    expect(stored.replyQuote).toBe("الساعة عشرة الصبح");
    const asB = await pageOf(w, w.b.id);
    expect(asB.messages.find((m) => m.id === reply.id)?.replyTo?.quote).toBe("الساعة عشرة الصبح");
  });

  it("a made-up quote (words the parent never held) is dropped: the reply still goes, as an ordinary reply", async () => {
    const w = await world();
    const parent = await w.say(w.topic.id, w.b.id, "كلام حقيقي");
    const reply = await send(w, w.a, "رد", { replyToId: parent.id, replyQuote: "كلام ما قاله أبدا" });
    expect(reply.replyTo?.quote).toBeUndefined();
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: reply.id } })).replyQuote).toBeNull();
  });

  it("a quote with no reply is ignored, and a long quote is cut to 280 characters", async () => {
    const w = await world();
    const alone = await send(w, w.a, "بدون رد", { replyQuote: "x" });
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: alone.id } })).replyQuote).toBeNull();
    const long = "ك".repeat(600);
    const parent = await w.say(w.topic.id, w.b.id, long);
    const reply = await send(w, w.a, "رد", { replyToId: parent.id, replyQuote: long.slice(0, 400) });
    expect((reply.replyTo?.quote ?? "").length).toBeLessThanOrEqual(280);
    expect((reply.replyTo?.quote ?? "").length).toBeGreaterThan(0);
  });

  it("the quote is formatting-aware (the words as the reader sees them) and never HTML-interpreted by the server", async () => {
    const w = await world();
    await db.organization.update({ where: { id: w.orgId }, data: { settings: { features: { chatLayoutV2: true, chatFormatting: true } } } });
    const parent = await w.say(w.topic.id, w.b.id, "هاد **مهم جدا** اليوم <b>x</b>");
    const reply = await send(w, w.a, "رد", { replyToId: parent.id, replyQuote: "مهم جدا" });
    expect(reply.replyTo?.quote).toBe("مهم جدا");
    const html = await send(w, w.a, "رد 2", { replyToId: parent.id, replyQuote: "<b>x</b>" });
    // stored as plain text: the screen escapes it (React); the server keeps it literal
    expect(html.replyTo?.quote).toBe("<b>x</b>");
  });

  it("when the parent is deleted for everybody, the quote is no longer sent (it is the parent's own words)", async () => {
    const w = await world();
    const parent = await w.say(w.topic.id, w.b.id, "كلام سيحذف لاحقا هنا");
    const reply = await send(w, w.a, "رد", { replyToId: parent.id, replyQuote: "سيحذف لاحقا" });
    await deleteMessage(ctxOf(w.orgId, w.b.id), parent.id);
    for (const viewer of [w.a, w.b, w.admin]) {
      const m = (await pageOf(w, viewer.id)).messages.find((x) => x.id === reply.id) as MessageDto;
      expect(m.replyTo?.deleted, viewer.name).toBe(true);
      expect(m.replyTo?.quote, viewer.name).toBeUndefined();
      expect(JSON.stringify(m), viewer.name).not.toContain("سيحذف لاحقا");
    }
  });

  it("with `chatLayoutV2` off a quote is not stored", async () => {
    const w = await world();
    const parent = await w.say(w.topic.id, w.b.id, "نص أصلي هنا");
    await db.organization.update({ where: { id: w.orgId }, data: { settings: { features: { chatLayoutV2: false } } } });
    const reply = await send(w, w.a, "رد", { replyToId: parent.id, replyQuote: "أصلي" });
    expect(reply.replyTo?.quote).toBeUndefined();
  });
});

describe("the date jump: days with messages, and the first message of a day", () => {
  it("lists the days of a month that hold messages (in the person's zone) and finds the first message of a day", async () => {
    const w = await world();
    // 2026-11-10 22:30Z is already 11-11 in Amman (UTC+3 in winter 2026? Jordan is UTC+3 all year since 2022)
    const lateUtc = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.topic.id, authorId: w.b.id, body: "late", createdAt: new Date("2026-11-10T22:30:00.000Z") } });
    const early = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.topic.id, authorId: w.b.id, body: "early", createdAt: new Date("2026-11-03T09:00:00.000Z") } });
    await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.topic.id, authorId: w.b.id, body: "december", createdAt: new Date("2026-12-02T09:00:00.000Z") } });
    await loginAs(w.a.id);
    const days = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}/messages?days=2026-11&tz=Asia/Amman`, params: { id: w.topic.id } });
    expect(days.status).toBe(200);
    expect(days.json?.["days"]).toEqual([3, 11]);
    // no zone named: the days are cut in the company's own clock (Organization.timezone, Damascus by default: UTC+3)
    const own = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}/messages?days=2026-11`, params: { id: w.topic.id } });
    expect(own.json?.["days"]).toEqual([3, 11]);
    const utc = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}/messages?days=2026-11&tz=UTC`, params: { id: w.topic.id } });
    expect(utc.json?.["days"]).toEqual([3, 10]);
    const day = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}/messages?onDate=2026-11-11&tz=Asia/Amman`, params: { id: w.topic.id } });
    expect(day.json?.["id"]).toBe(lateUtc.id);
    const first = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}/messages?onDate=2026-11-03&tz=Asia/Amman`, params: { id: w.topic.id } });
    expect(first.json?.["id"]).toBe(early.id);
    const none = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${w.topic.id}/messages?onDate=2027-01-01&tz=Asia/Amman`, params: { id: w.topic.id } });
    expect(none.json?.["id"]).toBeNull();
  });

  it("a hidden message's day is not offered to the person who hid it; a bad zone or date is a 422; a conversation the person cannot read is a 404", async () => {
    const w = await world();
    const only = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.topic.id, authorId: w.b.id, body: "only one that day", createdAt: new Date("2026-10-05T09:00:00.000Z") } });
    await hide(w.a.id, only.id);
    const url = (q: string, id = w.topic.id) => ({ url: `http://localhost/api/chat/conversations/${id}/messages?${q}`, params: { id } });
    await loginAs(w.a.id);
    expect((await call(messagesRoute.GET, url("days=2026-10&tz=UTC"))).json?.["days"]).toEqual([]);
    await loginAs(w.b.id);
    expect((await call(messagesRoute.GET, url("days=2026-10&tz=UTC"))).json?.["days"]).toEqual([5]);
    expect((await call(messagesRoute.GET, url("days=2026-13&tz=UTC"))).status).toBe(422);
    expect((await call(messagesRoute.GET, url("days=2026-10&tz=Not/AZone"))).status).toBe(422);
    expect((await call(messagesRoute.GET, url("onDate=2026-02-31&tz=UTC"))).status).toBe(422);
    await loginAs(w.a.id);
    expect((await call(messagesRoute.GET, url("days=2026-10&tz=UTC", w.restricted.id))).status).toBe(404);
  });
});
