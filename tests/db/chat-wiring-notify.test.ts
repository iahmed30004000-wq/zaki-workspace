/**
 * C3w.1 — notifications and the list's time, the leftovers of C3a.1, C3b.1, C1.1 and C1.8, against a real database.
 *
 *  - `ConversationMember.mutedUntil` («كتم الإشعارات»): a muted chat makes no bell row and no push for that person (a mention and «@الكل» included: «كتم» is كتم;
 *    the mention still counts in the list and stays among the person's unread mentions); another chat and another person are told as before; a mute that ended tells again
 *  - the WHOLE body reaches the bell and the push: the markers are stripped first and the words are cut after, so a bold run longer than the preview is not cut inside its markers
 *  - the assistant's answer and the ticket «✅ انحلّت» reply move `Conversation.lastMessageAt`
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as messageRoute from "@/app/api/chat/messages/[id]/route";
import { unreadMentionIds } from "@/server/chat/mentions";
import { announceTicketChange } from "@/server/services/ticket-chat";
import { settleChatAssistantForTests } from "@/server/services/chat-assistant";
import { saveKey } from "@/server/services/owner-assistant-settings";
import { ASSISTANT_MENTION_ID } from "@/lib/chat/conversation/mentions";
import { setProviderFactoryForTests } from "@/server/ai/registry";
import { withFeature, type FeatureKey } from "@/lib/features";
import { resetPresenceForTests } from "@/server/realtime/presence";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

async function world() {
  const t = await makeTeam();
  const sender = t.member;
  const peer = t.admin;
  const ws = await makeWorkspace(t.org.id, [{ userId: sender.id }, { userId: peer.id, role: "ADMIN" }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
  await db.conversationMember.create({ data: { conversationId: topic.id, userId: peer.id, lastReadAt: new Date(Date.now() - 60_000) } });
  const dm = await db.conversation.create({ data: { orgId: t.org.id, kind: "DM", members: { create: [{ userId: sender.id }, { userId: peer.id }] } } });
  const dm2 = await db.conversation.create({ data: { orgId: t.org.id, kind: "DM", members: { create: [{ userId: sender.id }, { userId: peer.id }] } } });
  return { t, sender, peer, ws, topic: topic.id, dm: dm.id, dm2: dm2.id };
}
type World = Awaited<ReturnType<typeof world>>;

async function send(w: World, conversationId: string, body: Record<string, unknown>) {
  await loginAs(w.sender.id);
  return call(messagesRoute.POST, { method: "POST", params: { id: conversationId }, body });
}
const bellsOf = (userId: string) => db.notification.findMany({ where: { userId, type: "chat_message" }, orderBy: { createdAt: "asc" } });
const mute = (conversationId: string, userId: string, until: Date | null) =>
  db.conversationMember.update({ where: { conversationId_userId: { conversationId, userId } }, data: { mutedUntil: until } });
const HOUR = 3_600_000;
const rawAt = async (conversationId: string) => (await db.$queryRaw<{ lastMessageAt: Date | null }[]>`SELECT "lastMessageAt" FROM "Conversation" WHERE "id" = ${conversationId}`)[0]!.lastMessageAt;
const setOld = (conversationId: string) => db.$executeRaw`UPDATE "Conversation" SET "lastMessageAt" = ${new Date(Date.now() - 86_400_000)} WHERE "id" = ${conversationId}`;


beforeEach(() => {
  resetPresenceForTests(); // nobody has a live stream: everybody counts as offline, so a bell WOULD be made for a loud message
});

describe("the personal mute stops the bell and the push", () => {
  it("a muted private chat: no notification row for the one who muted; the control (not muted) is told", async () => {
    const w = await world();
    await mute(w.dm, w.peer.id, new Date(Date.now() + HOUR));
    expect((await send(w, w.dm, { body: "ما بدي ازعجك", clientId: "m-1" })).status).toBe(201);
    expect(await bellsOf(w.peer.id)).toHaveLength(0);
    // the control: the same words in the chat that is NOT muted
    expect((await send(w, w.dm2, { body: "وهاي لإلك", clientId: "m-2" })).status).toBe(201);
    expect(await bellsOf(w.peer.id)).toHaveLength(1);
  });

  it("a muted topic: a mention and «@الكل» are not told either, yet the mention stays among the unread mentions", async () => {
    const w = await world();
    await mute(w.topic, w.peer.id, new Date(Date.now() + HOUR));
    const res = await send(w, w.topic, { body: "شوف هاد", mentions: [w.peer.id], clientId: "m-3" });
    expect(res.status).toBe(201);
    expect(await bellsOf(w.peer.id)).toHaveLength(0);
    const { ids } = await unreadMentionIds({ orgId: w.t.org.id, orgRole: "ADMIN", userId: w.peer.id }, w.topic);
    expect(ids).toEqual([res.json?.["id"]]);
  });

  it("a mute that has ended, a mute of somebody else, and a lifted mute tell as before", async () => {
    const w = await world();
    await mute(w.dm, w.peer.id, new Date(Date.now() - 1000));
    await send(w, w.dm, { body: "بعد الكتم", clientId: "m-4" });
    expect(await bellsOf(w.peer.id)).toHaveLength(1);
    // the sender's own mute never silences the peer's bell (a mute is the person's own)
    await db.notification.deleteMany({ where: { userId: w.peer.id } });
    await mute(w.dm2, w.sender.id, new Date(Date.now() + HOUR));
    await send(w, w.dm2, { body: "كتمي أنا", clientId: "m-5" });
    expect(await bellsOf(w.peer.id)).toHaveLength(1);
  });

  it("a muted person still has the message counted as unread (the badge comes from the message rows, not the bell)", async () => {
    const w = await world();
    await mute(w.dm, w.peer.id, new Date(Date.now() + HOUR));
    await send(w, w.dm, { body: "يعدّ", clientId: "m-6" });
    const row = await db.conversationMember.findUniqueOrThrow({ where: { conversationId_userId: { conversationId: w.dm, userId: w.peer.id } } });
    expect(row.mutedUntil).not.toBeNull();
    expect(await db.chatMessage.count({ where: { conversationId: w.dm, createdAt: { gt: row.lastReadAt }, authorId: w.sender.id } })).toBe(1);
  });
});

describe("the whole body reaches the bell: stripped first, cut after", () => {
  it("a bold run longer than the preview gives 140 words, not the half-cut `**` run", async () => {
    const w = await world();
    const long = `**${"ا".repeat(200)}**`;
    await send(w, w.dm, { body: long, clientId: "w-1" });
    const [bell] = await bellsOf(w.peer.id);
    expect(bell?.body).toBe("ا".repeat(140));
  });

  it("a link whose label comes before the cut keeps the label only", async () => {
    const w = await world();
    await send(w, w.dm2, { body: `${"ب".repeat(100)} [اضغط هنا](https://example.com/${"p".repeat(100)}) وبعدين`, clientId: "w-2" });
    const [bell] = await bellsOf(w.peer.id);
    expect(bell?.body).toBe(`${"ب".repeat(100)} اضغط هنا وبعدين`);
  });

  it("an edit rewrites the bell with the same rule (whole body stripped, then cut)", async () => {
    const w = await world();
    const sent = await send(w, w.dm, { body: "أول", clientId: "w-3" });
    await loginAs(w.sender.id);
    const edited = await call(messageRoute.PATCH, { method: "PATCH", params: { id: sent.json?.["id"] as string }, body: { body: `**${"ج".repeat(200)}**` } });
    expect(edited.status).toBe(200);
    const [bell] = await bellsOf(w.peer.id);
    expect(bell?.body).toBe("ج".repeat(140));
  });
});

describe("a message that is not sent through the route moves the list's time too", () => {
  it("the ticket «✅ انحلّت» reply moves lastMessageAt to the reply's own time", async () => {
    const w = await world();
    await db.organization.update({ where: { id: w.t.org.id }, data: { settings: withFeature({}, "autoTickets", true) as Prisma.InputJsonValue } });
    const source = await db.chatMessage.create({ data: { orgId: w.t.org.id, conversationId: w.topic, authorId: w.peer.id, body: "المشكلة" } });
    const ticket = await db.ticket.create({ data: { orgId: w.t.org.id, number: 1, title: "t", creatorId: w.sender.id, sourceMessageId: source.id, kindKey: "other" } });
    await setOld(w.topic);
    await announceTicketChange({ orgId: w.t.org.id, orgRole: "MEMBER", userId: w.sender.id }, ticket.id, { resolved: true, note: "تمّ" });
    const reply = await db.chatMessage.findFirstOrThrow({ where: { conversationId: w.topic, replyToId: source.id } });
    expect(reply.body).toBe("✅ انحلّت: تمّ");
    expect(await rawAt(w.topic)).toEqual(reply.createdAt);
  });
});

describe("the assistant's answer moves lastMessageAt", () => {
  afterEach(() => setProviderFactoryForTests(null));

  it("the answer line is a message of the conversation: the column moves to its time", async () => {
    setProviderFactoryForTests(() => ({ async complete() { return { text: "الخلاصة", toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 } }; } }));
    const w = await world();
    for (const key of ["chatAssistant", "ownerAssistant"] as FeatureKey[]) {
      const org = await db.organization.findUniqueOrThrow({ where: { id: w.t.org.id } });
      await db.organization.update({ where: { id: w.t.org.id }, data: { settings: withFeature(org.settings, key, true) as Prisma.InputJsonValue } });
    }
    await saveKey({ orgId: w.t.org.id, userId: w.t.owner.id }, "sk-ant-api03-WIRING-TESTKEY-never-appears-1234567890-ABCD"); // scan-secrets:ignore
    const other = await makeUser({ orgId: w.t.org.id, role: "MEMBER", name: "عمر" });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: other.id } });
    await db.chatMessage.create({ data: { orgId: w.t.org.id, conversationId: w.topic, authorId: other.id, body: "حكي قبل" } });
    await loginAs(w.sender.id);
    const asked = await call(messagesRoute.POST, { params: { id: w.topic }, body: { body: "@المساعد لخّص", mentions: [ASSISTANT_MENTION_ID] } });
    expect(asked.status).toBe(201);
    await settleChatAssistantForTests();
    const line = await db.chatMessage.findFirstOrThrow({ where: { conversationId: w.topic, kind: "SYSTEM", body: { startsWith: '{"k":"assistant"' } } });
    expect(await rawAt(w.topic)).toEqual(line.createdAt);
  });
});
