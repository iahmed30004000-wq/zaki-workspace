import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as joinRoute from "@/app/api/chat/conversations/[id]/join/route";
import * as prefsRoute from "@/app/api/me/chat-prefs/route";
import { setPushSenderForTests, pushTo, type PushMessage } from "@/server/calls/push";
import { flushPushesForTests } from "@/server/notify";
import { notifyMessageToAudience } from "@/server/chat/notify";
import { addClient, resetHubForTests } from "@/server/realtime/hub";
import { resetPresenceForTests, touchPresence } from "@/server/realtime/presence";
import { PREVIEW_OFF_TEXT } from "@/lib/chat/prefs";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * C4.1 — «الإشعارات والأصوات»: what a person switched in their own settings (`User.chatPrefs.notifications`) is what `src/server/chat/notify.ts` (the bell and
 * the push) and `src/server/calls/push.ts` (a ring) obey. A kind switched off produces NO push and no bell row; a kind whose preview is off sends «رسالة جديدة»
 * only; the mention rule stays as the person set it (it is its own kind: a person who switched «الخاص» off is still told of a mention); a person who chose
 * nothing is told exactly as before.
 */

const sent: { endpoint: string; message: PushMessage }[] = [];
beforeEach(() => {
  resetHubForTests();
  resetPresenceForTests();
  sent.length = 0;
  setPushSenderForTests(async (sub, payload) => {
    sent.push({ endpoint: sub.endpoint, message: JSON.parse(payload) as PushMessage });
    return { statusCode: 201 };
  });
});
afterAll(() => setPushSenderForTests(null));

async function allow(userId: string) {
  const endpoint = `https://push.test.local/${userId}`;
  await db.pushSubscription.create({ data: { userId, endpoint, p256dh: "p256dh-key", auth: "auth-key" } });
  return endpoint;
}
const savePrefs = async (userId: string, notifications: unknown) => {
  await loginAs(userId);
  const res = await call(prefsRoute.PUT, { method: "PUT", url: "http://localhost/api/me/chat-prefs", body: { notifications } });
  expect(res.status).toBe(200);
};
const bells = (userId: string) => db.notification.count({ where: { userId, type: "chat_message" } });
const pushesTo = (endpoint: string) => sent.filter((s) => s.endpoint === endpoint);

async function world() {
  const t = await makeTeam();
  const a = t.member;
  const b = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "B" });
  const c = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "C" });
  const ws = await makeWorkspace(t.org.id, [{ userId: a.id }, { userId: b.id }, { userId: c.id }]);
  const topic = await db.conversation.create({ data: { orgId: t.org.id, kind: "TOPIC", spaceId: ws.id, title: "General" } });
  for (const who of [b, c]) {
    await loginAs(who.id);
    expect((await call(joinRoute.POST, { url: `http://localhost/api/chat/conversations/${topic.id}`, params: { id: topic.id } })).status).toBe(200);
  }
  const ends = { b: await allow(b.id), c: await allow(c.id) };
  await loginAs(a.id);
  const dm = (await call(dmRoute.POST, { body: { userId: b.id } })).json?.["id"] as string;
  return { t, a, b, c, topic: topic.id, dm, ends };
}
async function say(from: string, conversationId: string, body: string, extra: Record<string, unknown> = {}) {
  await loginAs(from);
  const res = await call(messagesRoute.POST, { params: { id: conversationId }, body: { body, ...extra } });
  expect(res.status).toBe(201);
  await flushPushesForTests();
  return res.json?.["id"] as string;
}

describe("a kind switched off produces no push and no bell row", () => {
  it("«الخاص» off: a private message reaches nobody it was for; the person who chose nothing still gets the same one", async () => {
    const w = await world();
    await savePrefs(w.b.id, { private: { on: false } });
    await say(w.a.id, w.dm, "رسالة خاصة");
    expect(await bells(w.b.id)).toBe(0);
    expect(pushesTo(w.ends.b)).toEqual([]);

    // C chose nothing: a private chat with A is told as before
    await loginAs(w.a.id);
    const dmC = (await call(dmRoute.POST, { body: { userId: w.c.id } })).json?.["id"] as string;
    await say(w.a.id, dmC, "رسالة خاصة");
    expect(await bells(w.c.id)).toBe(1);
    expect(pushesTo(w.ends.c).map((p) => p.message.body)).toEqual(["رسالة خاصة"]);
  });

  it("switched on again (the reset puts the section back to its defaults): the push is back", async () => {
    const w = await world();
    await savePrefs(w.b.id, { private: { on: false } });
    await say(w.a.id, w.dm, "واحد");
    expect(pushesTo(w.ends.b)).toEqual([]);
    await loginAs(w.b.id);
    expect((await call(prefsRoute.PUT, { method: "PUT", url: "http://localhost/api/me/chat-prefs", body: { notifications: null } })).status).toBe(200);
    await say(w.a.id, w.dm, "اتنين");
    expect(pushesTo(w.ends.b).map((p) => p.message.body)).toEqual(["اتنين"]);
  });

  it("«الإشارات» off: a mention in a topic tells nobody it was for; «@الكل» too", async () => {
    const w = await world();
    await savePrefs(w.b.id, { mentions: { on: false } });
    await say(w.a.id, w.topic, "يا B شوف هاد", { mentions: [w.b.id, w.c.id] });
    expect(await bells(w.b.id)).toBe(0);
    expect(pushesTo(w.ends.b)).toEqual([]);
    // C chose nothing and is told
    expect(await bells(w.c.id)).toBe(1);
    expect(pushesTo(w.ends.c)).toHaveLength(1);

    // «@الكل» goes through the same kind
    await notifyMessageToAudience({ conversationId: w.topic, authorId: w.a.id, audienceIds: [w.b.id, w.c.id], kind: "TOPIC", title: "General", preview: "للكل", messageId: "m-all", allIds: [w.b.id, w.c.id] });
    await flushPushesForTests();
    expect(await bells(w.b.id)).toBe(0);
    expect(pushesTo(w.ends.b)).toEqual([]);
    expect(pushesTo(w.ends.c)).toHaveLength(2);
  });

  it("the mention rule stays as the person set it: with «الخاص» and «المواضيع» off a mention still reaches them, even while they look at the app", async () => {
    const w = await world();
    await savePrefs(w.b.id, { private: { on: false }, topics: { on: false }, replies: { on: false } });
    // B has a visible tab: a plain message is held back anyway, a mention is told (as before this step)
    addClient({ userId: w.b.id, orgId: w.t.org.id, tabId: "tab-1", send: () => undefined, close: () => undefined });
    touchPresence(w.b.id, undefined, w.t.org.id);
    await say(w.a.id, w.topic, "يا B", { mentions: [w.b.id] });
    expect(await bells(w.b.id)).toBe(1);
    expect(pushesTo(w.ends.b)).toHaveLength(1);
    expect(pushesTo(w.ends.b)[0]!.message.title).toContain("ذكرك");
  });

  it("a private chat is told by «الخاص» alone: with «الإشارات» off a message that names the person in a private chat still reaches them", async () => {
    const w = await world();
    await savePrefs(w.b.id, { mentions: { on: false } });
    await say(w.a.id, w.dm, "يا B", { mentions: [w.b.id] });
    expect(await bells(w.b.id)).toBe(1);
    expect(pushesTo(w.ends.b)).toHaveLength(1);
  });

  it("«الردود عليّ» off: a reply to my message is not told; a mention in the same topic still is", async () => {
    const w = await world();
    const mine = await say(w.b.id, w.topic, "رسالتي");
    await savePrefs(w.b.id, { replies: { on: false } });
    await say(w.a.id, w.topic, "رد عليك", { replyToId: mine });
    expect(await bells(w.b.id)).toBe(0);
    expect(pushesTo(w.ends.b)).toEqual([]);
    await say(w.a.id, w.topic, "وإشارة", { mentions: [w.b.id] });
    expect(await bells(w.b.id)).toBe(1);

    // with it on (the default) the same reply is told
    await savePrefs(w.b.id, { replies: { on: true } });
    await say(w.a.id, w.topic, "رد تاني", { replyToId: mine });
    expect(await bells(w.b.id)).toBe(2);
  });

  it("«المكالمات» off: a ring and a missed call send no push; on: they do", async () => {
    const w = await world();
    await savePrefs(w.b.id, { calls: { on: false } });
    await pushTo([w.b.id, w.c.id], { kind: "ring", title: "A عم يرن", body: "", url: "/calls/x", tag: "call:x" });
    expect(pushesTo(w.ends.b)).toEqual([]);
    expect(pushesTo(w.ends.c)).toHaveLength(1);
    await pushTo([w.b.id], { kind: "missed", title: "مكالمة فائتة", body: "", url: "/calls/x", tag: "missed:x" });
    expect(pushesTo(w.ends.b)).toEqual([]);
    // a note (anything else the bell sends) is not a call: it still goes out
    await pushTo([w.b.id], { kind: "note", title: "مهمة", body: "", url: "/tasks/1", tag: "task:1" });
    expect(pushesTo(w.ends.b)).toHaveLength(1);
    await savePrefs(w.b.id, { calls: { on: true } });
    await pushTo([w.b.id], { kind: "ring", title: "A عم يرن", body: "", url: "/calls/x", tag: "call:y" });
    expect(pushesTo(w.ends.b)).toHaveLength(2);
  });
});

describe("the preview", () => {
  it("off for a kind: the push says «رسالة جديدة» only and carries none of the words; the bell keeps the words; the title stays the chat's", async () => {
    const w = await world();
    await savePrefs(w.b.id, { private: { preview: false } });
    await say(w.a.id, w.dm, "كلمة سرية جدا");
    const pushes = pushesTo(w.ends.b);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.message.body).toBe(PREVIEW_OFF_TEXT);
    expect(JSON.stringify(pushes[0]!.message)).not.toContain("سرية");
    const row = await db.notification.findFirstOrThrow({ where: { userId: w.b.id, type: "chat_message" } });
    expect(row.body).toContain("كلمة سرية جدا");
  });

  it("is per kind: preview off for «الخاص» leaves a mention's words, and a person who chose nothing sees the words", async () => {
    const w = await world();
    await savePrefs(w.b.id, { private: { preview: false } });
    await say(w.a.id, w.topic, "يا B كلمة", { mentions: [w.b.id, w.c.id] });
    expect(pushesTo(w.ends.b)[0]!.message.body).toContain("كلمة");
    expect(pushesTo(w.ends.c)[0]!.message.body).toContain("كلمة");
  });
});

describe("nothing chosen = as before", () => {
  it("a person with no prefs (NULL) or with prefs that do not name notifications is told as ever", async () => {
    const w = await world();
    await db.user.update({ where: { id: w.b.id }, data: { chatPrefs: { voiceSpeed: 2 } } });
    await say(w.a.id, w.dm, "عادي");
    expect(await bells(w.b.id)).toBe(1);
    expect(pushesTo(w.ends.b).map((p) => p.message.body)).toEqual(["عادي"]);
  });
});
