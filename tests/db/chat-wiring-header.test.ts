/**
 * C3w.1 — the server half of the chat wiring that the merged packages recorded as «not done here», against a real database.
 *
 *  - `silent` leaves through the ONE presenter (`presentMessage`): the messages window and the sync feed carry `silent: true` for a silent message and nothing for a loud one
 *  - the header carries the company's switches the composer and the bubble read (`chatFormatting`, `chatAlbums`, `silentSend`) and the person's own count of waiting scheduled messages
 *  - a list row carries `postingPolicy`, so a channel whose manager opened it to everybody is not drawn as a channel
 *  - a reply quote and a pinned preview show the words, not the markers (only where the company's formatting switch is on; the old detail and `chatHome` are unchanged)
 *  - the text sent to the embeddings service has no markers
 */
import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as headerRoute from "@/app/api/chat/conversations/[id]/header/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { chatList } from "@/server/chat/list";
import { createScheduled } from "@/server/chat/scheduled";
import { syncFeed } from "@/server/chat/sync";
import { presentMessage, previewOf } from "@/server/chat/redact";
import type { ConversationHeaderDto, MessagesPageDto } from "@/server/chat/dto";
import { messageText } from "@/server/services/search-embeddings";
import { rowChannelWord } from "@/lib/chat/row-preview";
import { withFeature, type FeatureKey } from "@/lib/features";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const sender = t.member;
  const peer = t.admin;
  const ws = await makeWorkspace(orgId, [{ userId: sender.id }, { userId: peer.id, role: "ADMIN" }, { userId: t.guest.id }]);
  const topic = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: ws.id, title: "General" } });
  return { t, orgId, sender, peer, ws, topic: topic.id };
}
type World = Awaited<ReturnType<typeof world>>;
const ctxOf = (w: World, userId: string, orgRole: "MEMBER" | "ADMIN" | "GUEST" = "MEMBER") => ({ orgId: w.orgId, orgRole, userId });

async function setSwitch(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

const header = async (userId: string, id: string) => {
  await loginAs(userId);
  const res = await call(headerRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/header`, params: { id } });
  return { status: res.status, dto: res.json as unknown as ConversationHeaderDto };
};
const window = async (userId: string, id: string) => {
  await loginAs(userId);
  const res = await call(messagesRoute.GET, { url: `http://localhost/api/chat/conversations/${id}/messages?limit=20`, params: { id } });
  return { status: res.status, dto: res.json as unknown as MessagesPageDto };
};

describe("1. `silent` leaves through presentMessage", () => {
  it("presentMessage: a row that is silent gives `silent: true`; a loud row gives no field at all", async () => {
    const w = await world();
    const base = { id: "m1", kind: "TEXT", body: "x", createdAt: new Date(), pinned: false, editedAt: null, deletedAt: null, authorId: w.sender.id };
    const viewer = { userId: w.peer.id, role: "ADMIN", canModerateHere: false };
    expect(presentMessage({ ...base, silent: true }, viewer).silent).toBe(true);
    expect("silent" in presentMessage({ ...base, silent: false }, viewer)).toBe(false);
    expect("silent" in presentMessage(base, viewer)).toBe(false);
  });

  it("the messages window and the sync feed carry it for the recipient (a loud message carries nothing)", async () => {
    const w = await world();
    const cursor = (await syncFeed(ctxOf(w, w.peer.id, "ADMIN"))).cursor;
    const quiet = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.topic, authorId: w.sender.id, body: "هادي", silent: true } });
    const loud = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.topic, authorId: w.sender.id, body: "وهادي" } });
    await db.realtimeEvent.createMany({
      data: [quiet.id, loud.id].map((messageId) => ({ orgId: w.orgId, kind: "message.created", ids: { conversationId: w.topic, messageId, spaceId: w.ws.id } as Prisma.InputJsonValue })),
    });
    const win = await window(w.peer.id, w.topic);
    expect(win.status).toBe(200);
    expect(win.dto.messages.find((m) => m.id === quiet.id)?.silent).toBe(true);
    expect("silent" in win.dto.messages.find((m) => m.id === loud.id)!).toBe(false);
    const feed = await syncFeed(ctxOf(w, w.peer.id, "ADMIN"), { after: BigInt(cursor) });
    expect(feed.messages.find((m) => m.id === quiet.id)?.silent).toBe(true);
    expect("silent" in feed.messages.find((m) => m.id === loud.id)!).toBe(false);
  });
});

describe("2. the header carries the switches and the scheduled count; the list row carries postingPolicy", () => {
  it("chatFormatting, chatAlbums and silentSend: on by default, false when the company turned them off", async () => {
    const w = await world();
    const on = await header(w.sender.id, w.topic);
    expect(on.dto).toMatchObject({ chatFormatting: true, chatAlbums: true, silentSend: true });
    await setSwitch(w.orgId, "chatFormatting", false);
    await setSwitch(w.orgId, "chatAlbums", false);
    await setSwitch(w.orgId, "chatSilentSend", false);
    const off = await header(w.sender.id, w.topic);
    expect(off.dto).toMatchObject({ chatFormatting: false, chatAlbums: false, silentSend: false });
  });

  it("`scheduled` is the person's OWN count of waiting messages here: 0, then 1; nobody else's, and absent with the switch off", async () => {
    const w = await world();
    expect((await header(w.sender.id, w.topic)).dto.scheduled).toBe(0);
    await createScheduled(ctxOf(w, w.sender.id), w.topic, { body: "لاحقًا", sendAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect((await header(w.sender.id, w.topic)).dto.scheduled).toBe(1);
    // somebody else's header does not count it
    expect((await header(w.peer.id, w.topic)).dto.scheduled).toBe(0);
    await setSwitch(w.orgId, "chatScheduled", false);
    expect((await header(w.sender.id, w.topic)).dto.scheduled).toBeUndefined();
  });

  it("`scheduled` is absent for somebody who may not write here (an announcements topic opened to admins only)", async () => {
    const w = await world();
    const news = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.ws.id, title: "News", topicType: "ANNOUNCEMENTS", postingPolicy: "ADMINS" } });
    expect((await header(w.sender.id, news.id)).dto.scheduled).toBeUndefined();
    expect((await header(w.peer.id, news.id)).dto.scheduled).toBe(0);
  });

  it("a list row carries `postingPolicy` of a topic: an announcements topic opened to everybody is not a channel; one left to the admins is", async () => {
    const w = await world();
    const open = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.ws.id, title: "Open news", topicType: "ANNOUNCEMENTS", postingPolicy: "ALL" } });
    const channel = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.ws.id, title: "Channel", topicType: "ANNOUNCEMENTS", postingPolicy: "ADMINS" } });
    const list = await chatList(ctxOf(w, w.sender.id), { spaceId: w.ws.id });
    const rowOpen = list.rows.find((r) => r.id === open.id)!;
    const rowChannel = list.rows.find((r) => r.id === channel.id)!;
    expect(rowOpen.postingPolicy).toBe("ALL");
    expect(rowChannel.postingPolicy).toBe("ADMINS");
    expect(rowChannelWord(rowOpen)).toBeNull();
    expect(rowChannelWord(rowChannel)).not.toBeNull();
    // a private chat or a space row has no policy
    expect(list.rows.filter((r) => r.kind !== "TOPIC").every((r) => r.postingPolicy === undefined)).toBe(true);
  });
});

describe("3. a reply quote and a pinned preview show the words, not the markers", () => {
  const MARKED = "**مهم** و ||سر|| و [الرابط](https://example.com/x)";

  it("previewOf strips only when asked (chatHome and the list keep the raw cut they always had)", () => {
    expect(previewOf(MARKED, null)).toBe(MARKED);
    expect(previewOf(MARKED, null, { format: true })).toBe("مهم و ••• و الرابط");
    expect(previewOf(MARKED, new Date(), { format: true })).toBeNull();
    // the whole body is stripped BEFORE the cut: a long bold run is not cut inside its markers
    expect(previewOf(`**${"a".repeat(200)}**`, null, { format: true })).toBe("a".repeat(140));
  });

  it("the quote of the message replied to, in the messages window: stripped with the switch on, raw with it off, null for a deleted parent", async () => {
    const w = await world();
    const parent = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.topic, authorId: w.peer.id, body: MARKED } });
    const gone = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.topic, authorId: w.peer.id, body: "**سري**", deletedAt: new Date() } });
    const reply = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.topic, authorId: w.sender.id, body: "رد", replyToId: parent.id } });
    const replyGone = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.topic, authorId: w.sender.id, body: "رد٢", replyToId: gone.id } });
    const on = await window(w.sender.id, w.topic);
    expect(on.dto.messages.find((m) => m.id === reply.id)?.replyTo?.preview).toBe("مهم و ••• و الرابط");
    expect(on.dto.messages.find((m) => m.id === replyGone.id)?.replyTo?.preview).toBeNull();
    await setSwitch(w.orgId, "chatFormatting", false);
    const off = await window(w.sender.id, w.topic);
    expect(off.dto.messages.find((m) => m.id === reply.id)?.replyTo?.preview).toBe(MARKED);
  });

  it("the header's pinned bar: stripped with the switch on, raw with it off", async () => {
    const w = await world();
    await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: w.topic, authorId: w.peer.id, body: MARKED, pinned: true } });
    expect((await header(w.sender.id, w.topic)).dto.pinnedMessages?.[0]?.preview).toBe("مهم و ••• و الرابط");
    await setSwitch(w.orgId, "chatFormatting", false);
    expect((await header(w.sender.id, w.topic)).dto.pinnedMessages?.[0]?.preview).toBe(MARKED);
  });
});

describe("4. the text sent to the embeddings service has no markers", () => {
  it("messageText strips bold, a spoiler's bars and a link's address, and still keeps the words", () => {
    const text = messageText("هاي **كلمة مهمة** مع ||سر صغير|| وبعدها [رابط الموقع](https://example.com/page) انتهى")!;
    expect(text).not.toMatch(/\*\*|\|\||\]\(/);
    expect(text).toContain("كلمة مهمة");
    expect(text).toContain("رابط الموقع");
  });
});
