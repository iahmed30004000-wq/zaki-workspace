import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as prefsRoute from "@/app/api/me/chat-prefs/route";
import { setPushSenderForTests, type PushMessage } from "@/server/calls/push";
import { flushPushesForTests } from "@/server/notify";
import { flushChatPushesForTests } from "@/server/push-chat";
import { addClient, resetHubForTests } from "@/server/realtime/hub";
import { resetPresenceForTests, touchPresence } from "@/server/realtime/presence";
import { PREVIEW_OFF_TEXT } from "@/lib/chat/prefs";
import { conversationOfUrl } from "@/lib/pwa/notifications";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * M1a — notifications of the installed app. A private chat pushes EVERY message (it used to push only the first of an unread run, and the rest of the run
 * reached a phone whose app was closed as nothing at all); the bell still keeps one row per unread chat. The push carries the sender's name and the words with
 * their markers stripped, goes through the same kind switches, the mute and the viewing filter as before, respects «بدون معاينة», and never carries what looks like
 * a customer's data. Its address is the conversation's, so the service worker groups the notifications by it (`tag` = the conversation id: tests/pwa-sw.test.ts).
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

async function world() {
  const t = await makeTeam();
  const a = t.member;
  const b = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "بسام" });
  await makeWorkspace(t.org.id, [{ userId: a.id }, { userId: b.id }]);
  const endpoint = `https://push.test.local/${b.id}`;
  await db.pushSubscription.create({ data: { userId: b.id, endpoint, p256dh: "p256dh-key", auth: "auth-key" } });
  await loginAs(a.id);
  const dm = (await call(dmRoute.POST, { body: { userId: b.id } })).json?.["id"] as string;
  return { t, a, b, dm, endpoint };
}
async function say(from: string, conversationId: string, body: string, extra: Record<string, unknown> = {}) {
  await loginAs(from);
  const res = await call(messagesRoute.POST, { params: { id: conversationId }, body: { body, ...extra } });
  expect(res.status).toBe(201);
  await flushPushesForTests();
  await flushChatPushesForTests();
  return res.json?.["id"] as string;
}
const bells = (userId: string) => db.notification.count({ where: { userId, type: "chat_message" } });
/** The page a push opens: a space's notification goes through /go, its `next` is the page. */
const pageOf = (url: string): string => {
  const parsed = new URL(url, "http://localhost");
  return parsed.pathname === "/go" ? (parsed.searchParams.get("next") ?? "") : `${parsed.pathname}${parsed.search}`;
};
const pushesTo = (endpoint: string) => sent.filter((s) => s.endpoint === endpoint).map((s) => s.message);
const savePrefs = async (userId: string, notifications: unknown) => {
  await loginAs(userId);
  expect((await call(prefsRoute.PUT, { method: "PUT", url: "http://localhost/api/me/chat-prefs", body: { notifications } })).status).toBe(200);
};

describe("a private chat pushes each message, not only the first of an unread run", () => {
  it("three messages in a row: three pushes, each with its own message in the address, and ONE bell row", async () => {
    const w = await world();
    const ids = [await say(w.a.id, w.dm, "واحد"), await say(w.a.id, w.dm, "اتنين"), await say(w.a.id, w.dm, "تلاتة")];
    const pushes = pushesTo(w.endpoint);
    expect(pushes.map((p) => p.body)).toEqual(["واحد", "اتنين", "تلاتة"]);
    expect(pushes.map((p) => pageOf(p.url))).toEqual(ids.map((id) => `/chat/${w.dm}?m=${id}`));
    // the bell does not stack (the old rule, kept): one row for the unread chat
    expect(await bells(w.b.id)).toBe(1);
  });

  it("every push is a note whose address is the conversation, so the worker groups them: the sender's name is the title", async () => {
    const w = await world();
    await say(w.a.id, w.dm, "صباح الخير");
    await say(w.a.id, w.dm, "كيفك؟");
    const pushes = pushesTo(w.endpoint);
    expect(pushes).toHaveLength(2);
    for (const push of pushes) {
      expect(push.kind).toBe("note");
      expect(push.title).toBe(w.t.member.name);
      expect(conversationOfUrl(push.url)).toBe(w.dm);
    }
  });

  it("a notification of a space goes through /go and still names the conversation", async () => {
    const w = await world();
    await say(w.a.id, w.dm, "هاي");
    await say(w.a.id, w.dm, "كمان");
    for (const push of pushesTo(w.endpoint)) {
      expect(conversationOfUrl(push.url)).toBe(w.dm);
      expect(push.tag.startsWith("chat_message:/chat/")).toBe(true);
    }
  });
});

describe("what stays as it was", () => {
  it("a person looking at the app (a visible tab) is told of no follow-up either", async () => {
    const w = await world();
    addClient({ userId: w.b.id, orgId: w.t.org.id, tabId: "tab-1", send: () => undefined, close: () => undefined });
    touchPresence(w.b.id, undefined, w.t.org.id);
    await say(w.a.id, w.dm, "واحد");
    await say(w.a.id, w.dm, "اتنين");
    expect(pushesTo(w.endpoint)).toEqual([]);
    expect(await bells(w.b.id)).toBe(0);
  });

  it("a conversation the person muted for themselves (C3w.1) pushes nothing, the first message or the tenth", async () => {
    const w = await world();
    await db.conversationMember.updateMany({ where: { conversationId: w.dm, userId: w.b.id }, data: { mutedUntil: new Date(Date.now() + 3_600_000) } });
    await say(w.a.id, w.dm, "واحد");
    await say(w.a.id, w.dm, "اتنين");
    expect(pushesTo(w.endpoint)).toEqual([]);
    expect(await bells(w.b.id)).toBe(0);
  });

  it("«الخاص» switched off: nothing, follow-ups included", async () => {
    const w = await world();
    await savePrefs(w.b.id, { private: { on: false } });
    await say(w.a.id, w.dm, "واحد");
    await say(w.a.id, w.dm, "اتنين");
    expect(pushesTo(w.endpoint)).toEqual([]);
  });

  it("a silent message (C3c.2) pushes nothing", async () => {
    const w = await world();
    await say(w.a.id, w.dm, "واحد");
    await say(w.a.id, w.dm, "بدون صوت", { silent: true });
    expect(pushesTo(w.endpoint).map((p) => p.body)).toEqual(["واحد"]);
  });

  it("the company's switch «إشعارات على التلفون واللابتوب» off: no push at all, follow-ups included", async () => {
    const w = await world();
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.t.org.id }, select: { settings: true } });
    await db.organization.update({ where: { id: w.t.org.id }, data: { settings: { ...((org.settings as object | null) ?? {}), features: { pushEverything: false } } } });
    await say(w.a.id, w.dm, "واحد");
    await say(w.a.id, w.dm, "اتنين");
    expect(pushesTo(w.endpoint)).toEqual([]);
    expect(await bells(w.b.id)).toBe(1);
  });
});

describe("what the push says", () => {
  it("«بدون معاينة»: every message of the run is «رسالة جديدة» and nothing of the words", async () => {
    const w = await world();
    await savePrefs(w.b.id, { private: { preview: false } });
    await say(w.a.id, w.dm, "كلام سري");
    await say(w.a.id, w.dm, "كلام سري كمان");
    expect(pushesTo(w.endpoint).map((p) => p.body)).toEqual([PREVIEW_OFF_TEXT, PREVIEW_OFF_TEXT]);
    // the bell keeps its words
    expect((await db.notification.findFirstOrThrow({ where: { userId: w.b.id, type: "chat_message" } })).body).toBe("كلام سري");
  });

  it("the words, not the markers (C3b.1): bold and a link's label, in the first push and in the follow-ups", async () => {
    const w = await world();
    await say(w.a.id, w.dm, "**مهم** جداً");
    await say(w.a.id, w.dm, "شوف [الموقع](https://example.com/page)");
    const bodies = pushesTo(w.endpoint).map((p) => p.body);
    expect(bodies[0]).toBe("مهم جداً");
    expect(bodies[1]).toBe("شوف الموقع");
    for (const body of bodies) expect(body).not.toMatch(/\*\*|\]\(/);
  });

  it("a message shaped like a customer's data (the order template, or a phone number) is «رسالة جديدة» in the push, in the first and in the follow-ups; the bell keeps the words", async () => {
    const w = await world();
    await say(w.a.id, w.dm, "الاسم: أحمد\nرقم الهاتف: 0791234567\nالمحافظة: عمان\nالعنوان: شارع الجامعة");
    await say(w.a.id, w.dm, "كلمه على 0791234567");
    await say(w.a.id, w.dm, "تمام");
    expect(pushesTo(w.endpoint).map((p) => p.body)).toEqual([PREVIEW_OFF_TEXT, PREVIEW_OFF_TEXT, "تمام"]);
    expect((await db.notification.findFirstOrThrow({ where: { userId: w.b.id, type: "chat_message" } })).body).toContain("0791234567");
  });

  it("an attachment-only message says «أرسل مرفقًا», never a file name", async () => {
    const w = await world();
    await say(w.a.id, w.dm, "واحد");
    const { notifyMessageToAudience } = await import("@/server/chat/notify");
    await notifyMessageToAudience({ conversationId: w.dm, authorId: w.a.id, audienceIds: [w.b.id], kind: "DM", title: w.t.member.name, preview: "أرسل مرفقًا", messageId: "m-att" });
    await flushPushesForTests();
    await flushChatPushesForTests();
    expect(pushesTo(w.endpoint).map((p) => p.body)).toEqual(["واحد", "أرسل مرفقًا"]);
  });
});
