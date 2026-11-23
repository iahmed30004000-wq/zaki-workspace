import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as route from "@/app/api/me/chat-prefs/route";
import { CHAT_PREFS_MAX_BYTES } from "@/lib/chat/prefs";
import { withFeature } from "@/lib/features";
import { call, db, loginAs, logout, makeOrg, makeTeam, makeWorkspace } from "./helpers";

/**
 * C3a.2 — `GET/PUT /api/me/chat-prefs`: the person's own chat preferences on their account (`User.chatPrefs`, the additive migration
 * 20261123101100_user_chat_prefs). It is the caller's alone (no id in the address, no id in the body), strict on what it stores, capped at 64 KB, and
 * a save is a patch (a section not named stays). The folders live in it, keyed by company id.
 */

const URL = "http://localhost/api/me/chat-prefs";
const get = () => call(route.GET, { method: "GET", url: URL });
const put = (body: unknown) => call(route.PUT, { method: "PUT", url: URL, body });
const stored = async (userId: string) => (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { chatPrefs: true } })).chatPrefs;
const prefsOf = (res: { json: Record<string, unknown> | null }) => res.json?.["prefs"] as Record<string, unknown>;

const FOLDER = { id: "f1", name: "عمل", emoji: "💼", include: { dms: true, conversationIds: ["c1"], spaceIds: [] }, exclude: { archived: true } };

async function setSwitch(orgId: string, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "chatFolders", on) as Prisma.InputJsonValue } });
}

beforeEach(() => logout());

describe("the column", () => {
  it("every account starts with no prefs (NULL): all defaults", async () => {
    const { member, owner } = await makeTeam();
    expect(await stored(member.id)).toBeNull();
    expect(await stored(owner.id)).toBeNull();
  });
});

describe("GET /api/me/chat-prefs", () => {
  it("answers an empty object (all defaults), the company id and the switch for somebody who never saved", async () => {
    const { member, org } = await makeTeam();
    await loginAs(member.id);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ prefs: {}, orgId: org.id, foldersOn: true });
  });

  it("answers what was saved", async () => {
    const { member, org } = await makeTeam();
    await loginAs(member.id);
    expect((await put({ folders: { [org.id]: [FOLDER] }, voiceSpeed: 1.5 })).status).toBe(200);
    const res = await get();
    expect(prefsOf(res)).toEqual({ folders: { [org.id]: [{ ...FOLDER, include: { ...FOLDER.include } }] }, voiceSpeed: 1.5 });
  });

  it("a stored value that is damaged reads as what is still good, never as an error", async () => {
    const { member, org } = await makeTeam();
    await loginAs(member.id);
    await db.user.update({ where: { id: member.id }, data: { chatPrefs: { folders: { [org.id]: [FOLDER, { id: "bad", name: "ا".repeat(50) }] }, voiceSpeed: 9 } } });
    expect(prefsOf(await get())).toEqual({ folders: { [org.id]: [FOLDER] } });
    await db.user.update({ where: { id: member.id }, data: { chatPrefs: "nonsense" } });
    expect(prefsOf(await get())).toEqual({});
  });

  it("an anonymous caller is refused", async () => {
    const res = await get();
    expect(res.status).toBe(401);
  });

  it("does not hand back the folders of a company the person has left", async () => {
    const { member, org } = await makeTeam();
    const other = await makeOrg();
    await loginAs(member.id);
    await db.user.update({ where: { id: member.id }, data: { chatPrefs: { folders: { [org.id]: [FOLDER], [other.id]: [{ ...FOLDER, id: "f2" }] } } } });
    const folders = prefsOf(await get())["folders"] as Record<string, unknown>;
    expect(Object.keys(folders)).toEqual([org.id]);
    // what was stored stays
    expect(Object.keys(((await stored(member.id)) as { folders: object }).folders).sort()).toEqual([org.id, other.id].sort());
  });
});

describe("PUT /api/me/chat-prefs", () => {
  it("saves on the caller's own account and answers the whole prefs", async () => {
    const { owner, org } = await makeTeam();
    await loginAs(owner.id);
    const res = await put({ folders: { [org.id]: [FOLDER] } });
    expect(res.status).toBe(200);
    expect(prefsOf(res)).toEqual({ folders: { [org.id]: [FOLDER] } });
    expect(await stored(owner.id)).toEqual({ folders: { [org.id]: [FOLDER] } });
  });

  it("is a patch: a section not named stays, a section named is replaced, null puts one back to its default", async () => {
    const { owner, org } = await makeTeam();
    await loginAs(owner.id);
    await put({ folders: { [org.id]: [FOLDER] }, voiceSpeed: 2, chat: { fontSize: 3 } });
    await put({ voiceSpeed: 1.5 });
    expect(await stored(owner.id)).toEqual({ folders: { [org.id]: [FOLDER] }, voiceSpeed: 1.5, chat: { fontSize: 3 } });
    await put({ chat: null, voiceSpeed: null });
    expect(await stored(owner.id)).toEqual({ folders: { [org.id]: [FOLDER] } });
    await put({ folders: { [org.id]: null } });
    // nothing left but defaults: the column goes back to NULL
    expect(await stored(owner.id)).toBeNull();
  });

  it("changing the wallpaper (and the other settings of the chat screen) keeps the folders and the hidden tabs saved a moment before", async () => {
    const { owner, org } = await makeTeam();
    await loginAs(owner.id);
    expect((await put({ folders: { [org.id]: [FOLDER] }, tabs: { hidden: ["mentions"] } })).status).toBe(200);
    for (const chat of [{ wallpaper: "sea" }, { wallpaper: "sea", fontStep: 3 }, { wallpaper: "plain", fontStep: 3, themeAuto: true }]) {
      expect((await put({ chat })).status).toBe(200);
      expect(prefsOf(await get())).toMatchObject({ folders: { [org.id]: [FOLDER] }, tabs: { hidden: ["mentions"] }, chat });
    }
    expect((await put({ chat: { wallpaper: "dark" }, voiceSpeed: 2 })).status).toBe(200);
    expect(await stored(owner.id)).toEqual({ folders: { [org.id]: [FOLDER] }, tabs: { hidden: ["mentions"] }, chat: { wallpaper: "dark" }, voiceSpeed: 2 });
  });

  it("two saves at once of different sections both stay", async () => {
    const { owner, org } = await makeTeam();
    await loginAs(owner.id);
    const results = await Promise.all([put({ folders: { [org.id]: [FOLDER] } }), put({ voiceSpeed: 2 }), put({ notifications: { dm: { on: false } } })]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await stored(owner.id)).toEqual({ folders: { [org.id]: [FOLDER] }, voiceSpeed: 2, notifications: { dm: { on: false } } });
  });

  it("an external partner (a guest) keeps their own folders too", async () => {
    const { guest, org } = await makeTeam();
    await loginAs(guest.id);
    expect((await put({ folders: { [org.id]: [FOLDER] } })).status).toBe(200);
    expect(await stored(guest.id)).toEqual({ folders: { [org.id]: [FOLDER] } });
  });

  it("an anonymous caller is refused and nothing is written", async () => {
    const res = await put({ voiceSpeed: 2 });
    expect(res.status).toBe(401);
  });
});

describe("it is the caller's row and nobody else's", () => {
  it("one person's save never reaches another person's account, and each reads only their own", async () => {
    const { owner, member, admin, org } = await makeTeam();
    await loginAs(member.id);
    await put({ folders: { [org.id]: [FOLDER] }, voiceSpeed: 2 });
    await loginAs(admin.id);
    expect(prefsOf(await get())).toEqual({});
    await put({ voiceSpeed: 1.5 });
    await loginAs(member.id);
    expect(prefsOf(await get())).toEqual({ folders: { [org.id]: [FOLDER] }, voiceSpeed: 2 });
    expect(await stored(owner.id)).toBeNull();
    expect(await stored(admin.id)).toEqual({ voiceSpeed: 1.5 });
  });

  it("REFUSED: a body that names another person (userId, id, target) is a 422 and nothing is written to either account", async () => {
    const { member, admin } = await makeTeam();
    await loginAs(member.id);
    for (const body of [{ userId: admin.id, voiceSpeed: 2 }, { id: admin.id, voiceSpeed: 2 }, { user: admin.id }]) {
      const res = await put(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    expect(await stored(member.id)).toBeNull();
    expect(await stored(admin.id)).toBeNull();
  });

  it("REFUSED: folders keyed by a company the person does not belong to are a 403 and nothing is stored (not even the other sections of that save)", async () => {
    const { member, org } = await makeTeam();
    const stranger = await makeOrg();
    await loginAs(member.id);
    const res = await put({ voiceSpeed: 2, folders: { [org.id]: [FOLDER], [stranger.id]: [FOLDER] } });
    expect(res.status).toBe(403);
    expect(await stored(member.id)).toBeNull();
  });

  it("a company the person left: its folders can still be dropped (a delete is never refused), and a list for it is still refused", async () => {
    const { member, org } = await makeTeam();
    const left = await makeOrg();
    await loginAs(member.id);
    await db.user.update({ where: { id: member.id }, data: { chatPrefs: { folders: { [org.id]: [FOLDER], [left.id]: [{ ...FOLDER, id: "old" }] } } } });
    expect((await put({ folders: { [left.id]: [{ ...FOLDER, id: "new" }] } })).status).toBe(403);
    const res = await put({ folders: { [left.id]: null } });
    expect(res.status).toBe(200);
    expect(await stored(member.id)).toEqual({ folders: { [org.id]: [FOLDER] } });
  });

  it("an empty list for a company is a delete, in the answer and in the column alike", async () => {
    const { member, org } = await makeTeam();
    await loginAs(member.id);
    await put({ folders: { [org.id]: [FOLDER] }, voiceSpeed: 2 });
    const res = await put({ folders: { [org.id]: [] } });
    expect(prefsOf(res)).toEqual({ voiceSpeed: 2 });
    expect(await stored(member.id)).toEqual({ voiceSpeed: 2 });
  });

  it("REFUSED: a company where the person's seat is suspended is not theirs either", async () => {
    const { member } = await makeTeam();
    const other = await makeOrg();
    await db.organizationMember.create({ data: { organizationId: other.id, userId: member.id, role: "MEMBER", status: "SUSPENDED" } });
    await loginAs(member.id);
    expect((await put({ folders: { [other.id]: [FOLDER] } })).status).toBe(403);
    expect(await stored(member.id)).toBeNull();
  });
});

describe("what a save may carry", () => {
  it("REFUSED: bad shapes are a 422 and leave the stored prefs as they were", async () => {
    const { member, org } = await makeTeam();
    await loginAs(member.id);
    await put({ voiceSpeed: 2 });
    const many = Array.from({ length: 11 }, (_, i) => ({ id: `f${i}`, name: `م${i}` }));
    const bad: unknown[] = [
      { folders: { [org.id]: [{ id: "a", name: "ا".repeat(13) }] } },
      { folders: { [org.id]: many } },
      { folders: { [org.id]: [{ id: "a", name: "x", include: { conversationIds: Array.from({ length: 101 }, (_, i) => `c${i}`) } }] } },
      { folders: { [org.id]: [{ id: "a", name: "x", include: { spaceIds: Array.from({ length: 51 }, (_, i) => `s${i}`) } }] } },
      { folders: { [org.id]: [{ id: "a", name: "x", emoji: "abc" }] } },
      { voiceSpeed: 3 },
      { tabs: { hidden: ["company"] } },
      { chat: "loud" },
      [],
      "text",
    ];
    for (const body of bad) expect((await put(body)).status, JSON.stringify(body).slice(0, 60)).toBe(422);
    expect(await stored(member.id)).toEqual({ voiceSpeed: 2 });
  });

  it("REFUSED: a body that is not JSON is a 422", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const res = await route.PUT(new Request(URL, { method: "PUT", headers: { "content-type": "application/json" }, body: "{not json" }));
    expect(res.status).toBe(422);
  });

  it("REFUSED: more than 64 KB is a 422 (read with a ceiling), and a save whose result would pass 64 KB is refused too", async () => {
    const { member } = await makeTeam();
    await loginAs(member.id);
    const huge = await put({ chat: { blob: "x".repeat(CHAT_PREFS_MAX_BYTES) } });
    expect(huge.status).toBe(422);
    // two sections that fit alone but not together
    const half = "y".repeat(Math.floor(CHAT_PREFS_MAX_BYTES * 0.6));
    expect((await put({ chat: { blob: half } })).status).toBe(200);
    expect((await put({ notifications: { blob: half } })).status).toBe(422);
    expect(await stored(member.id)).toEqual({ chat: { blob: half } });
  });

  it("a folder's chat ids are kept as ids and never come back with a title", async () => {
    const { member, org } = await makeTeam();
    await loginAs(member.id);
    const res = await put({ folders: { [org.id]: [{ ...FOLDER, include: { conversationIds: ["some-chat-i-cannot-read"], spaceIds: [] } }] } });
    expect(res.status).toBe(200);
    expect(res.text).toContain("some-chat-i-cannot-read");
    expect(JSON.stringify(res.json)).not.toMatch(/title|name":"(?!عمل)/);
  });
});

describe("S5.3 — a folder keeps the id of ONE topic", () => {
  it("a real topic id sits in include.conversationIds like any chat id, comes back unchanged, and the answer carries no title of it", async () => {
    const { member, org } = await makeTeam();
    const space = await makeWorkspace(org.id, [{ userId: member.id }], "Alpha");
    const topic = await db.conversation.create({ data: { orgId: org.id, kind: "TOPIC", spaceId: space.id, title: "TopicTitleNeverEchoed" } });
    await loginAs(member.id);
    const folder = { id: "f-topic", name: "طلبات", include: { conversationIds: [topic.id], spaceIds: [] }, exclude: { archived: true } };
    const res = await put({ folders: { [org.id]: [folder] } });
    expect(res.status).toBe(200);
    expect((await get()).json?.["prefs"]).toEqual({ folders: { [org.id]: [folder] } });
    expect(JSON.stringify(res.json)).not.toContain("TopicTitleNeverEchoed");
  });
});

describe("the switch chatFolders (ON by default)", () => {
  it("off: the folders are not answered and cannot be saved (404), the other prefs still work, what was stored stays", async () => {
    const { member, org } = await makeTeam();
    await loginAs(member.id);
    await put({ folders: { [org.id]: [FOLDER] }, tabs: { hidden: ["unread"] }, voiceSpeed: 2 });
    await setSwitch(org.id, false);
    const res = await get();
    expect(res.json).toEqual({ prefs: { voiceSpeed: 2 }, orgId: org.id, foldersOn: false });
    expect((await put({ folders: { [org.id]: [{ ...FOLDER, id: "f9" }] } })).status).toBe(404);
    expect((await put({ tabs: { hidden: [] } })).status).toBe(404);
    expect((await put({ voiceSpeed: 1.5 })).status).toBe(200);
    expect(await stored(member.id)).toEqual({ folders: { [org.id]: [FOLDER] }, tabs: { hidden: ["unread"] }, voiceSpeed: 1.5 });
    await setSwitch(org.id, true);
    expect((prefsOf(await get())["folders"] as object)[org.id as never]).toBeDefined();
  });
});
