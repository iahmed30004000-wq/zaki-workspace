import { beforeEach, describe, expect, it } from "vitest";
import * as logoutEverywhere from "@/app/api/me/logout-everywhere/route";
import * as pushList from "@/app/api/me/push/route";
import * as pushOne from "@/app/api/me/push/[id]/route";
import * as meRoute from "@/app/api/me/route";
import * as prefsRoute from "@/app/api/me/chat-prefs/route";
import { COOKIE_NAME, createSessionToken } from "@/server/session";
import { call, db, loginAs, logout, makeTeam, makeUser } from "./helpers";
import { sessionCookie } from "./login-helpers";

/**
 * C4.1 — the routes «إعداداتي» adds, each with its refusal cases: «اطلع من كل الأجهزة» (`POST /api/me/logout-everywhere`: only the caller's own `tokenVersion`),
 * «افصل» for a browser (`DELETE /api/me/push/[id]`: the caller's own subscription, 404 for anything else) and its list (`GET /api/me/push`), and the typed
 * sections of `User.chatPrefs` that the settings screens save.
 */

beforeEach(() => logout());

const versionOf = async (userId: string) => (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { tokenVersion: true } })).tokenVersion;
const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;

describe("POST /api/me/logout-everywhere", () => {
  it("bumps the caller's own session version once, clears this browser's cookie and leaves one audit row", async () => {
    const { member, admin } = await makeTeam();
    await loginAs(member.id);
    const before = { mine: await versionOf(member.id), other: await versionOf(admin.id) };
    const res = await call(logoutEverywhere.POST, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await versionOf(member.id)).toBe(before.mine + 1);
    expect(await versionOf(admin.id)).toBe(before.other);
    expect(sessionCookie()).toBeUndefined();
    expect(await db.auditLog.count({ where: { action: "auth.logout_everywhere", actorId: member.id } })).toBe(1);
  });

  it("every cookie the person held stops working at its next request (the device that asked included)", async () => {
    const { member } = await makeTeam();
    const tv = await versionOf(member.id);
    await loginAs(member.id);
    expect((await call(meRoute.GET)).status).toBe(200);
    expect((await call(logoutEverywhere.POST, { method: "POST" })).status).toBe(200);
    // the same cookie, kept by another device
    jar().set(COOKIE_NAME, await createSessionToken({ userId: member.id, tv }));
    expect((await call(meRoute.GET)).status).toBe(401);
  });

  it("it also disconnects the person's own browsers and paired phones, and only theirs", async () => {
    const { member, admin } = await makeTeam();
    await db.pushSubscription.create({ data: { userId: member.id, endpoint: `https://push.test.local/${member.id}/1`, p256dh: "p", auth: "a" } });
    await db.pushSubscription.create({ data: { userId: admin.id, endpoint: `https://push.test.local/${admin.id}/1`, p256dh: "p", auth: "a" } });
    await db.appDevice.create({ data: { userId: member.id, tokenHash: `hash-${member.id}`, name: "تلفوني" } });
    await db.appDevice.create({ data: { userId: admin.id, tokenHash: `hash-${admin.id}`, name: "تلفونه" } });
    await loginAs(member.id);
    expect((await call(logoutEverywhere.POST, { method: "POST" })).status).toBe(200);
    expect(await db.pushSubscription.count({ where: { userId: member.id } })).toBe(0);
    expect(await db.appDevice.count({ where: { userId: member.id } })).toBe(0);
    expect(await db.pushSubscription.count({ where: { userId: admin.id } })).toBe(1);
    expect(await db.appDevice.count({ where: { userId: admin.id } })).toBe(1);
  });

  it("an anonymous caller is refused (401) and nothing moves", async () => {
    const { member } = await makeTeam();
    const before = await versionOf(member.id);
    expect((await call(logoutEverywhere.POST, { method: "POST" })).status).toBe(401);
    expect(await versionOf(member.id)).toBe(before);
  });

  it("there is no way to name somebody else: a body with another person's id changes only the caller", async () => {
    const { member, admin, owner } = await makeTeam();
    await loginAs(member.id);
    const before = { admin: await versionOf(admin.id), owner: await versionOf(owner.id), mine: await versionOf(member.id) };
    const res = await call(logoutEverywhere.POST, { method: "POST", body: { userId: admin.id, id: owner.id } });
    expect(res.status).toBe(200);
    expect(await versionOf(admin.id)).toBe(before.admin);
    expect(await versionOf(owner.id)).toBe(before.owner);
    expect(await versionOf(member.id)).toBe(before.mine + 1);
  });
});

async function subscription(userId: string, userAgent: string | null = "Mozilla/5.0 (Windows NT 10.0) Chrome/130") {
  return db.pushSubscription.create({ data: { userId, endpoint: `https://push.test.local/${userId}/${Math.random().toString(36).slice(2)}`, p256dh: "key-p256dh", auth: "key-auth", userAgent } });
}

describe("GET /api/me/push", () => {
  it("lists the caller's own browsers only, without the push address or the keys", async () => {
    const { member, admin } = await makeTeam();
    const mine = await subscription(member.id);
    await subscription(admin.id);
    await loginAs(member.id);
    const res = await call(pushList.GET);
    expect(res.status).toBe(200);
    const list = res.json?.["subscriptions"] as { id: string }[];
    expect(list.map((s) => s.id)).toEqual([mine.id]);
    expect(res.text).not.toContain("push.test.local");
    expect(res.text).not.toContain("key-p256dh");
    expect(res.text).not.toContain("key-auth");
  });

  it("an anonymous caller gets 401", async () => {
    expect((await call(pushList.GET)).status).toBe(401);
  });
});

describe("DELETE /api/me/push/[id]", () => {
  const del = (id: string) => call(pushOne.DELETE, { method: "DELETE", params: { id } });

  it("removes the caller's own subscription", async () => {
    const { member } = await makeTeam();
    const mine = await subscription(member.id);
    await loginAs(member.id);
    expect((await del(mine.id)).status).toBe(200);
    expect(await db.pushSubscription.count({ where: { id: mine.id } })).toBe(0);
    // gone: the same call again is «not found»
    expect((await del(mine.id)).status).toBe(404);
  });

  it("another person's subscription is 404 and stays (the same answer as one that never existed)", async () => {
    const { member, admin } = await makeTeam();
    const theirs = await subscription(admin.id);
    await loginAs(member.id);
    const res = await del(theirs.id);
    expect(res.status).toBe(404);
    expect(await db.pushSubscription.count({ where: { id: theirs.id } })).toBe(1);
    const unknown = await del("never-existed");
    expect(unknown.status).toBe(404);
    expect(unknown.json).toEqual(res.json);
  });

  it("an anonymous caller gets 401 and nothing is removed", async () => {
    const { member } = await makeTeam();
    const mine = await subscription(member.id);
    expect((await del(mine.id)).status).toBe(401);
    expect(await db.pushSubscription.count({ where: { id: mine.id } })).toBe(1);
  });
});

describe("the typed sections of User.chatPrefs", () => {
  const URL = "http://localhost/api/me/chat-prefs";
  const put = (body: unknown) => call(prefsRoute.PUT, { method: "PUT", url: URL, body });
  const stored = async (userId: string) => (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { chatPrefs: true } })).chatPrefs;

  it("keeps what the settings screens save, in the caller's own row", async () => {
    const { member, admin } = await makeTeam();
    await loginAs(member.id);
    const chat = { fontStep: 3, wallpaper: "stars", sendKey: "ctrl", quickReactions: ["👍", "❤️", "😂", "🎉", "🔥", "👀"], doubleTap: "❤️", themeAuto: true };
    const notifications = { private: { on: false }, mentions: { preview: false }, calls: { on: true } };
    expect((await put({ chat, notifications })).status).toBe(200);
    expect(await stored(member.id)).toEqual({ chat, notifications });
    expect(await stored(admin.id)).toBeNull();
  });

  it("refuses a wrong shape with 422 and writes nothing", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const bad: unknown[] = [
      { notifications: { private: { on: "no" } } },
      { notifications: { private: { loud: true } } },
      { notifications: { calls: { on: null } } },
      { chat: { fontStep: 7 } },
      { chat: { fontStep: 1.5 } },
      { chat: { wallpaper: "gone" } },
      { chat: { sendKey: "tab" } },
      { chat: { quickReactions: ["👍", "❤️", "😂", "🎉", "🔥"] } },
      { chat: { quickReactions: ["👍", "👍", "😂", "🎉", "🔥", "👀"] } },
      { chat: { quickReactions: ["a", "❤️", "😂", "🎉", "🔥", "👀"] } },
      { chat: { doubleTap: "hello" } },
      { chat: { themeAuto: "yes" } },
    ];
    for (const body of bad) expect((await put(body)).status, JSON.stringify(body)).toBe(422);
    expect(await stored(member.id)).toBeNull();
  });

  it("reading is forgiving: a damaged key is dropped, the rest of the section stays", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    await db.user.update({ where: { id: member.id }, data: { chatPrefs: { chat: { fontStep: 99, wallpaper: "leaves", sendKey: "ctrl" }, notifications: { private: { on: 5 }, topics: { on: false } } } } });
    const res = await call(prefsRoute.GET, { method: "GET", url: URL });
    expect(res.json?.["prefs"]).toEqual({ chat: { wallpaper: "leaves", sendKey: "ctrl" }, notifications: { topics: { on: false } } });
  });

  it("the company's own users are never reached by a save: another person's prefs do not change", async () => {
    const { org, member } = await makeTeam();
    const other = await makeUser({ orgId: org.id, name: "Other" });
    await db.user.update({ where: { id: other.id }, data: { chatPrefs: { chat: { wallpaper: "coins" } } } });
    await loginAs(member.id);
    expect((await put({ chat: { wallpaper: "boxes" } })).status).toBe(200);
    expect(await stored(other.id)).toEqual({ chat: { wallpaper: "coins" } });
  });
});
