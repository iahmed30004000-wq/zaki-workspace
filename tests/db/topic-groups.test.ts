import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as groupsRoute from "@/app/api/groups/route";
import * as groupRoute from "@/app/api/groups/[id]/route";
import * as groupTopicsRoute from "@/app/api/groups/[id]/topics/route";
import * as topicsRoute from "@/app/api/topics/[id]/route";
import * as homeRoute from "@/app/api/chat/home/route";
import * as systemTokensRoute from "@/app/api/system-tokens/route";
import { withFeature } from "@/lib/features";
import { failureLimiter } from "@/server/door/limits";
import { canReadConversation } from "@/server/policy/conversation";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, logout, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «مجموعات المواضيع»: Telegram's folder → group → topic. A group arranges the topics of ONE space; a topic is in exactly one group (or in none: «عام»); a restricted group is
 * visible to the owner and its people only, and its topics are then restricted topics with exactly those people, so «من يقدر يقرأ» stays decided by the rows that already decide it.
 */

beforeEach(() => failureLimiter.reset("unknown"));

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);

async function world() {
  const team = await makeTeam();
  const alice = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Alice" });
  const bob = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Bob" });
  const space = await makeWorkspace(team.org.id, [{ userId: team.admin.id, role: "ADMIN" }, { userId: alice.id }, { userId: bob.id }], "الشغل");
  const other = await makeWorkspace(team.org.id, [{ userId: alice.id }], "تانية");
  const topic = (title: string, position: number, spaceId = space.id) => db.conversation.create({ data: { orgId: team.org.id, kind: "TOPIC", spaceId, title, position } });
  const t1 = await topic("حملات", 0);
  const t2 = await topic("تصاميم", 1);
  const t3 = await topic("تقارير", 2);
  const foreign = await topic("بمساحة تانية", 0, other.id);
  return { ...team, alice, bob, space, other, t1, t2, t3, foreign };
}
type World = Awaited<ReturnType<typeof world>>;

const createGroup = (body: Record<string, unknown>) => call(groupsRoute.POST, { url: "http://localhost/api/groups", body });
const listGroups = (spaceId: string) => call(groupsRoute.GET, { url: `http://localhost/api/groups?spaceId=${spaceId}`, method: "GET" });
const patchGroup = (id: string, body: Record<string, unknown>) => call(groupRoute.PATCH, { method: "PATCH", params: { id }, body });
const moveTopic = (id: string, groupId: string | null) => call(topicsRoute.PATCH, { method: "PATCH", params: { id }, body: { groupId } });

type HomeGroup = { id: string; name: string; unread: number; topicCount: number; restricted: boolean };
type HomeTopic = { id: string; groupId: string | null; unread: number };
async function homeOf(userId: string, spaceId: string) {
  await loginAs(userId);
  enter(spaceId);
  const space = ((await call(homeRoute.GET)).json as { spaces: Array<{ groups?: HomeGroup[]; topics: HomeTopic[] }> }).spaces[0];
  return { groups: space?.groups ?? [], topics: space?.topics ?? [] };
}

describe("making and arranging groups", () => {
  it("the owner makes a group in a space; it is listed in order with its emoji; ungrouped topics are untouched", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const a = await createGroup({ spaceId: w.space.id, name: "الإدارة", emoji: "🧭" });
    expect(a.status, a.text).toBe(201);
    const b = await createGroup({ spaceId: w.space.id, name: "التسويق" });
    expect(b.status).toBe(201);
    const listed = (await listGroups(w.space.id)).json as { groups: Array<{ id: string; name: string; emoji: string | null; position: number }> };
    expect(listed.groups.map((g) => g.name)).toEqual(["الإدارة", "التسويق"]);
    expect(listed.groups[0]?.emoji).toBe("🧭");
    // nothing moved: every old topic is still in «عام»
    expect(await db.conversation.count({ where: { spaceId: w.space.id, groupId: { not: null } } })).toBe(0);
    expect(await db.conversation.count({ where: { spaceId: w.space.id } })).toBe(3);
  });

  it("a plain member cannot make, rename or delete a group (403); a space admin can", async () => {
    const w = await world();
    await loginAs(w.alice.id);
    expect((await createGroup({ spaceId: w.space.id, name: "ممنوع" })).status).toBe(403);
    await loginAs(w.admin.id);
    const made = await createGroup({ spaceId: w.space.id, name: "من الأدمن" });
    expect(made.status).toBe(201);
    const id = (made.json as { group: { id: string } }).group.id;
    await loginAs(w.alice.id);
    expect((await patchGroup(id, { name: "x" })).status).toBe(403);
    expect((await call(groupRoute.DELETE, { method: "DELETE", params: { id } })).status).toBe(403);
    await loginAs(w.admin.id);
    expect((await patchGroup(id, { name: "اسم جديد", emoji: "📣", position: 5 })).status).toBe(200);
    const row = await db.topicGroup.findUniqueOrThrow({ where: { id } });
    expect([row.name, row.emoji, row.position]).toEqual(["اسم جديد", "📣", 5]);
  });

  it("a name is required and a group of another company's space is not found", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await createGroup({ spaceId: w.space.id, name: "   " })).status).toBe(422);
    const stranger = await makeTeam();
    const foreignSpace = await makeWorkspace(stranger.org.id, [{ userId: stranger.admin.id, role: "ADMIN" }], "غريبة");
    expect((await createGroup({ spaceId: foreignSpace.id, name: "x" })).status).toBe(404);
  });

  it("a space's groups come back in the order of `position`", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const first = (await createGroup({ spaceId: w.space.id, name: "أول" })).json as { group: { id: string } };
    const second = (await createGroup({ spaceId: w.space.id, name: "ثاني" })).json as { group: { id: string } };
    expect((await patchGroup(second.group.id, { position: -1 })).status).toBe(200);
    const names = ((await listGroups(w.space.id)).json as { groups: Array<{ name: string }> }).groups.map((g) => g.name);
    expect(names).toEqual(["ثاني", "أول"]);
    expect(first.group.id).toBeTruthy();
  });
});

describe("a topic belongs to exactly one group", () => {
  it("moving a topic in, to another group and back to «عام» changes only its groupId", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const g1 = ((await createGroup({ spaceId: w.space.id, name: "الإدارة" })).json as { group: { id: string } }).group.id;
    const g2 = ((await createGroup({ spaceId: w.space.id, name: "التسويق" })).json as { group: { id: string } }).group.id;
    await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.t1.id, authorId: w.alice.id, body: "رسالة قديمة", kind: "TEXT" } });
    await db.conversation.update({ where: { id: w.t1.id }, data: { pinnedAt: new Date() } });

    expect((await moveTopic(w.t1.id, g1)).status).toBe(200);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: w.t1.id } })).groupId).toBe(g1);
    expect((await moveTopic(w.t1.id, g2)).status).toBe(200);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: w.t1.id } })).groupId).toBe(g2);
    expect((await moveTopic(w.t1.id, null)).status).toBe(200);
    const back = await db.conversation.findUniqueOrThrow({ where: { id: w.t1.id } });
    expect(back.groupId).toBeNull();
    // nothing else changed: the message, the pin, the title, the position
    expect(back.pinnedAt).not.toBeNull();
    expect([back.title, back.position]).toEqual(["حملات", 0]);
    expect(await db.chatMessage.count({ where: { conversationId: w.t1.id } })).toBe(1);
  });

  it("a group of another space is not found; a plain member cannot move a topic (403)", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const foreignGroup = await db.topicGroup.create({ data: { orgId: w.org.id, spaceId: w.other.id, name: "غريبة" } });
    expect((await moveTopic(w.t1.id, foreignGroup.id)).status).toBe(404);
    expect((await moveTopic(w.t1.id, "no-such-group")).status).toBe(404);
    const mine = ((await createGroup({ spaceId: w.space.id, name: "الإدارة" })).json as { group: { id: string } }).group.id;
    await loginAs(w.alice.id);
    expect((await moveTopic(w.t1.id, mine)).status).toBe(403);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: w.t1.id } })).groupId).toBeNull();
  });

  it("the old route of the topic settings takes `groupId` too, and a topic made inside a group is born in it", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const g = ((await createGroup({ spaceId: w.space.id, name: "الإدارة" })).json as { group: { id: string } }).group.id;
    const viaOld = await call((await import("@/app/api/chat/topics/[id]/route")).PATCH, { method: "PATCH", params: { id: w.t2.id }, body: { groupId: g } });
    expect(viaOld.status, viaOld.text).toBe(200);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: w.t2.id } })).groupId).toBe(g);
    const born = await call(groupTopicsRoute.POST, { params: { id: g }, body: { title: "اجتماعات" } });
    expect(born.status, born.text).toBe(201);
    const bornId = (born.json as { id: string }).id;
    const row = await db.conversation.findUniqueOrThrow({ where: { id: bornId } });
    expect([row.groupId, row.spaceId, row.kind]).toEqual([g, w.space.id, "TOPIC"]);
  });

  it("deleting a group deletes no topic: they fall back to «عام» with their messages", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const g = ((await createGroup({ spaceId: w.space.id, name: "مؤقتة" })).json as { group: { id: string } }).group.id;
    await moveTopic(w.t1.id, g);
    await moveTopic(w.t2.id, g);
    await db.chatMessage.create({ data: { orgId: w.org.id, conversationId: w.t1.id, authorId: w.alice.id, body: "باقية", kind: "TEXT" } });
    expect((await call(groupRoute.DELETE, { method: "DELETE", params: { id: g } })).status).toBe(200);
    expect(await db.topicGroup.count({ where: { id: g } })).toBe(0);
    expect(await db.conversation.count({ where: { spaceId: w.space.id, groupId: null } })).toBe(3);
    expect(await db.chatMessage.count({ where: { conversationId: w.t1.id } })).toBe(1);
  });
});

describe("the chat home: groups, and the unread rolled up from topic to group", () => {
  it("each topic carries its groupId; a group carries the unread of its topics; «عام» topics stay in no group", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const g = ((await createGroup({ spaceId: w.space.id, name: "الإدارة", emoji: "🧭" })).json as { group: { id: string } }).group.id;
    await moveTopic(w.t1.id, g);
    await moveTopic(w.t2.id, g);
    // alice writes 2 in t1 and 1 in t2 and 4 in t3 (outside the group): bob reads them as unread
    const say = (conversationId: string, n: number) =>
      db.chatMessage.createMany({ data: Array.from({ length: n }, (_, i) => ({ orgId: w.org.id, conversationId, authorId: w.alice.id, body: `م${i}`, kind: "TEXT" as const })) });
    for (const t of [w.t1, w.t2, w.t3]) await db.conversationMember.upsert({ where: { conversationId_userId: { conversationId: t.id, userId: w.bob.id } }, create: { conversationId: t.id, userId: w.bob.id, lastReadAt: new Date(Date.now() - 60_000) }, update: {} });
    await say(w.t1.id, 2);
    await say(w.t2.id, 1);
    await say(w.t3.id, 4);

    const home = await homeOf(w.bob.id, w.space.id);
    expect(home.topics.find((t) => t.id === w.t1.id)?.groupId).toBe(g);
    expect(home.topics.find((t) => t.id === w.t3.id)?.groupId).toBeNull();
    const group = home.groups.find((x) => x.id === g);
    expect(group?.unread).toBe(3);
    expect(group?.topicCount).toBe(2);
    // the space's total is still all of it
    expect(home.topics.reduce((n, t) => n + t.unread, 0)).toBe(7);
  });
});

describe("a restricted group", () => {
  async function restrictedWorld() {
    const w = await world();
    await loginAs(w.owner.id);
    const made = await createGroup({ spaceId: w.space.id, name: "الإدارة", restricted: true, memberIds: [w.alice.id] });
    expect(made.status, made.text).toBe(201);
    const id = (made.json as { group: { id: string } }).group.id;
    return { ...w, id };
  }

  it("is listed for the owner and its people only", async () => {
    const w = await restrictedWorld();
    await loginAs(w.owner.id);
    expect(((await listGroups(w.space.id)).json as { groups: unknown[] }).groups).toHaveLength(1);
    await loginAs(w.alice.id);
    expect(((await listGroups(w.space.id)).json as { groups: unknown[] }).groups).toHaveLength(1);
    await loginAs(w.bob.id);
    expect(((await listGroups(w.space.id)).json as { groups: unknown[] }).groups).toHaveLength(0);
    // and not in bob's chat home either (a group with nothing in it for the viewer is not drawn, so a topic goes in first)
    await loginAs(w.owner.id);
    expect((await moveTopic(w.t1.id, w.id)).status).toBe(200);
    expect((await homeOf(w.bob.id, w.space.id)).groups.map((g) => g.id)).not.toContain(w.id);
    expect((await homeOf(w.alice.id, w.space.id)).groups.map((g) => g.id)).toContain(w.id);
  });

  it("makes the topics moved into it restricted to its people: the others cannot read them", async () => {
    const w = await restrictedWorld();
    await loginAs(w.owner.id);
    expect((await moveTopic(w.t1.id, w.id)).status).toBe(200);
    const row = await db.conversation.findUniqueOrThrow({ where: { id: w.t1.id }, include: { members: true } });
    expect(row.restricted).toBe(true);
    expect(row.members.map((m) => m.userId).sort()).toEqual([w.alice.id, w.owner.id].sort());
    expect(await canReadConversation(w.alice.id, w.t1.id)).toBe(true);
    expect(await canReadConversation(w.bob.id, w.t1.id)).toBe(false);
    expect((await homeOf(w.bob.id, w.space.id)).topics.map((t) => t.id)).not.toContain(w.t1.id);
  });

  it("changing its people follows into its topics; a topic made inside it is born for them", async () => {
    const w = await restrictedWorld();
    await loginAs(w.owner.id);
    await moveTopic(w.t1.id, w.id);
    expect((await patchGroup(w.id, { memberIds: [w.bob.id] })).status).toBe(200);
    expect(await canReadConversation(w.bob.id, w.t1.id)).toBe(true);
    expect(await canReadConversation(w.alice.id, w.t1.id)).toBe(false);
    const born = await call(groupTopicsRoute.POST, { params: { id: w.id }, body: { title: "سرّي" } });
    expect(born.status, born.text).toBe(201);
    const bornId = (born.json as { id: string }).id;
    expect(await canReadConversation(w.bob.id, bornId)).toBe(true);
    expect(await canReadConversation(w.alice.id, bornId)).toBe(false);
  });

  it("a person outside it cannot move a topic into it, and does not even learn it exists (404)", async () => {
    const w = await restrictedWorld();
    await loginAs(w.admin.id); // a space ADMIN who is not on the list
    expect((await moveTopic(w.t2.id, w.id)).status).toBe(404);
    expect((await patchGroup(w.id, { name: "x" })).status).toBe(404);
  });

  it("moving a topic OUT of a restricted group leaves it as private as it was (nothing is opened by an arrangement)", async () => {
    const w = await restrictedWorld();
    await loginAs(w.owner.id);
    await moveTopic(w.t1.id, w.id);
    expect((await moveTopic(w.t1.id, null)).status).toBe(200);
    expect(await canReadConversation(w.bob.id, w.t1.id)).toBe(false);
  });
});

describe("agents: a system token makes a group and moves three topics by the API alone", () => {
  async function setFeature(orgId: string, on: boolean) {
    const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
    await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "apiDoor", on) as Prisma.InputJsonValue } });
  }
  async function mint(w: World, system = "muse") {
    await setFeature(w.org.id, true);
    await loginAs(w.owner.id);
    const r = await call(systemTokensRoute.POST, { url: "http://localhost/api/system-tokens", body: { system, workspaceId: w.space.id } });
    expect(r.status, r.text).toBe(201);
    logout();
    return { token: r.json!["token"] as string, permissions: (r.json!["item"] as { permissions: string[] }).permissions };
  }
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  it("the system «ميوز» holds exactly chat.structure", async () => {
    const w = await world();
    expect((await mint(w)).permissions).toEqual(["chat.structure"]);
  });

  it("creates the group, moves 3 topics into it and lists it, without any cookie", async () => {
    const w = await world();
    const { token } = await mint(w);
    const made = await call(groupsRoute.POST, { url: "http://localhost/api/groups", body: { spaceId: w.space.id, name: "الإدارة", emoji: "🧭" }, headers: bearer(token) });
    expect(made.status, made.text).toBe(201);
    const id = (made.json as { group: { id: string } }).group.id;
    for (const t of [w.t1, w.t2, w.t3]) {
      const moved = await call(topicsRoute.PATCH, { method: "PATCH", params: { id: t.id }, body: { groupId: id }, headers: bearer(token) });
      expect(moved.status, moved.text).toBe(200);
    }
    expect(await db.conversation.count({ where: { groupId: id } })).toBe(3);
    const listed = await call(groupsRoute.GET, { url: `http://localhost/api/groups?spaceId=${w.space.id}`, method: "GET", headers: bearer(token) });
    expect((listed.json as { groups: Array<{ id: string }> }).groups.map((g) => g.id)).toEqual([id]);
    const creator = await db.auditLog.findFirst({ where: { action: "chat.group.create", target: id } });
    expect(creator?.actorId).toBe(w.owner.id);
  });

  it("through a token the topic route changes the group and NOTHING else (no title, no archive, no delete)", async () => {
    const w = await world();
    const { token } = await mint(w);
    const bad = await call(topicsRoute.PATCH, { method: "PATCH", params: { id: w.t1.id }, body: { archived: true }, headers: bearer(token) });
    expect(bad.status).toBe(422);
    expect((await db.conversation.findUniqueOrThrow({ where: { id: w.t1.id } })).archivedAt).toBeNull();
    expect(topicsRoute).not.toHaveProperty("DELETE");
  });

  it("a token of another system, a wrong token and no token at all are refused (403 / 401 / 401)", async () => {
    const w = await world();
    const { token: tasksToken } = await mint(w, "claude-mcp");
    expect((await call(groupsRoute.POST, { url: "http://localhost/api/groups", body: { spaceId: w.space.id, name: "x" }, headers: bearer(tasksToken) })).status).toBe(403);
    failureLimiter.reset("unknown");
    expect((await call(groupsRoute.POST, { url: "http://localhost/api/groups", body: { spaceId: w.space.id, name: "x" }, headers: bearer("zws_000000000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA") })).status).toBe(401);
    failureLimiter.reset("unknown");
    logout();
    expect((await call(groupsRoute.POST, { url: "http://localhost/api/groups", body: { spaceId: w.space.id, name: "x" } })).status).toBe(401);
    expect(await db.topicGroup.count({ where: { spaceId: w.space.id } })).toBe(0);
  });

  it("with the company's switch «باب الربط» off the token opens nothing", async () => {
    const w = await world();
    const { token } = await mint(w);
    await setFeature(w.org.id, false);
    expect((await call(groupsRoute.POST, { url: "http://localhost/api/groups", body: { spaceId: w.space.id, name: "x" }, headers: bearer(token) })).status).toBe(404);
  });

  it("a cookie session from another origin is still refused (the check the middleware does for other API paths)", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const res = await call(groupsRoute.POST, { url: "http://localhost/api/groups", body: { spaceId: w.space.id, name: "x" }, headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site", host: "localhost" } });
    expect(res.status).toBe(403);
    expect(await db.topicGroup.count({ where: { spaceId: w.space.id } })).toBe(0);
  });
});
