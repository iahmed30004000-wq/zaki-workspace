/**
 * C3c.2 — «ابعت بدون صوت», against a real database.
 *
 *  - a silent message makes NO bell row (and so no push: `pushNotification` writes the row and sends the push) for anybody: not the DM's other person,
 *    not a person who is @mentioned (the sender chose silence), not the author of the message replied to
 *  - it is still a message: the unread count (the badge) counts it, and the mention stays among the person's unread mentions
 *  - a retry of the same `clientId` is the same silent message: it is never made twice and never turns loud
 *  - the switch `chatSilentSend` off: the flag is ignored, the message is an ordinary one (bell and all)
 *  - the sender's own answer carries `silent`, so the optimistic bubble and the recipient's arrival rule can read it
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import { unreadMentionIds } from "@/server/chat/mentions";
import { unreadTotal } from "@/server/chat/unread";
import { withFeature } from "@/lib/features";
import { resetPresenceForTests } from "@/server/realtime/presence";
import { call, db, loginAs, makeTeam, makeWorkspace } from "./helpers";

async function world() {
  const t = await makeTeam();
  const sender = t.member;
  const peer = t.admin;
  const ws = await makeWorkspace(t.org.id, [{ userId: sender.id }, { userId: peer.id, role: "ADMIN" }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
  // the peer has read the topic once (a row with a read mark), so the topic counts for them
  await db.conversationMember.create({ data: { conversationId: topic.id, userId: peer.id, lastReadAt: new Date(Date.now() - 60_000) } });
  const dm = await db.conversation.create({
    data: { orgId: t.org.id, kind: "DM", members: { create: [{ userId: sender.id }, { userId: peer.id }] } },
  });
  const dm2 = await db.conversation.create({
    data: { orgId: t.org.id, kind: "DM", members: { create: [{ userId: sender.id }, { userId: peer.id }] } },
  });
  return { t, sender, peer, ws, topic: topic.id, dm: dm.id, dm2: dm2.id };
}
type World = Awaited<ReturnType<typeof world>>;

async function send(w: World, conversationId: string, body: Record<string, unknown>) {
  await loginAs(w.sender.id);
  return call(messagesRoute.POST, { method: "POST", params: { id: conversationId }, body });
}
const bells = (userId: string) => db.notification.count({ where: { userId, type: "chat_message" } });
const ctxOf = (w: World, userId: string) => ({ orgId: w.t.org.id, orgRole: userId === w.peer.id ? ("ADMIN" as const) : ("MEMBER" as const), userId });

async function setSwitch(orgId: string, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "chatSilentSend", on) as Prisma.InputJsonValue } });
}

beforeEach(() => {
  resetPresenceForTests(); // nobody has a live stream: everybody counts as offline, so a bell WOULD be made for a loud message
});

describe("a silent message makes no bell and no push", () => {
  it("a DM: the other person gets no notification row, yet the message counts as unread (the badge)", async () => {
    const w = await world();
    const res = await send(w, w.dm, { body: "بدون صوت", silent: true, clientId: "s-1" });
    expect(res.status).toBe(201);
    expect(res.json?.["silent"]).toBe(true);
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: res.json?.["id"] as string } })).silent).toBe(true);
    expect(await bells(w.peer.id)).toBe(0);
    expect(await unreadTotal(ctxOf(w, w.peer.id))).toBe(1);
  });

  it("the control: the same message without the flag makes a bell", async () => {
    const w = await world();
    const res = await send(w, w.dm, { body: "بصوت", clientId: "l-1" });
    expect(res.status).toBe(201);
    expect(res.json?.["silent"]).toBeUndefined();
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: res.json?.["id"] as string } })).silent).toBe(false);
    expect(await bells(w.peer.id)).toBe(1);
  });

  it("a person who is @mentioned is not told either, but the mention stays among their unread mentions", async () => {
    const w = await world();
    const res = await send(w, w.topic, { body: "شوف هاد", mentions: [w.peer.id], silent: true, clientId: "s-2" });
    expect(res.status).toBe(201);
    const row = await db.chatMessage.findUniqueOrThrow({ where: { id: res.json?.["id"] as string } });
    expect(row.mentions).toEqual([w.peer.id]);
    expect(await bells(w.peer.id)).toBe(0);
    expect((await unreadMentionIds(ctxOf(w, w.peer.id), w.topic)).ids).toEqual([row.id]);
    expect(await unreadTotal(ctxOf(w, w.peer.id))).toBe(1);
  });

  it("the control: the same mention without the flag makes a bell", async () => {
    const w = await world();
    expect((await send(w, w.topic, { body: "شوف هاد", mentions: [w.peer.id], clientId: "l-2" })).status).toBe(201);
    expect(await bells(w.peer.id)).toBe(1);
  });

  it("a reply to somebody's message does not tell its author when it is silent", async () => {
    const w = await world();
    await loginAs(w.peer.id);
    const original = await call(messagesRoute.POST, { method: "POST", params: { id: w.topic }, body: { body: "سؤال", clientId: "q-1" } });
    const res = await send(w, w.topic, { body: "جواب", replyToId: original.json?.["id"], silent: true, clientId: "s-3" });
    expect(res.status).toBe(201);
    expect(await bells(w.peer.id)).toBe(0);
  });
});

describe("a retry keeps it silent", () => {
  it("the same clientId answers with the same silent message, makes no second one and no bell", async () => {
    const w = await world();
    const first = await send(w, w.dm, { body: "مرة وحدة", silent: true, clientId: "s-retry" });
    expect(first.status).toBe(201);
    // the outbox re-sends the same payload (and a copy that lost the flag must still find the silent message, not make a loud one)
    const again = await send(w, w.dm, { body: "مرة وحدة", silent: true, clientId: "s-retry" });
    const lost = await send(w, w.dm, { body: "مرة وحدة", clientId: "s-retry" });
    for (const r of [again, lost]) {
      expect(r.status).toBeLessThan(300);
      expect(r.json?.["id"]).toBe(first.json?.["id"]);
      expect(r.json?.["silent"]).toBe(true);
    }
    expect(await db.chatMessage.count({ where: { conversationId: w.dm } })).toBe(1);
    expect(await bells(w.peer.id)).toBe(0);
  });
});

describe("the switch chatSilentSend", () => {
  it("off: the route ignores the flag, the message is an ordinary one", async () => {
    const w = await world();
    await setSwitch(w.t.org.id, false);
    const res = await send(w, w.dm2, { body: "بصوت رغم الطلب", silent: true, clientId: "off-1" });
    expect(res.status).toBe(201);
    expect(res.json?.["silent"]).toBeUndefined();
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: res.json?.["id"] as string } })).silent).toBe(false);
    expect(await bells(w.peer.id)).toBe(1);
  });

  it("on (the default): a flag that is not a boolean is refused", async () => {
    const w = await world();
    expect((await send(w, w.dm, { body: "x", silent: "yes", clientId: "bad-1" })).status).toBe(422);
  });
});
