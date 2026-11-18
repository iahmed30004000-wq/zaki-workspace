/**
 * C1.2 — `chatList` / `GET /api/chat/list`: the chat list in ONE query, in both shapes of D-N2 (the one list, and one space like the old home).
 * It must not change who may see what: the rules are the old home's plus P0.1 (the matrix has the same rows). The numbers (unread, mentions) are the old
 * home's, row for row.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as listRoute from "@/app/api/chat/list/route";
import { chatHome } from "@/server/chat/home";
import { chatList } from "@/server/chat/list";
import { dmKeyOf, openDm } from "@/server/chat/dm";
import type { ChatRowDto } from "@/server/chat/dto";
import { call, db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";

type Ctx = { orgId: string; userId: string; orgRole: "OWNER" | "ADMIN" | "LEAD" | "MEMBER" | "GUEST" };

// every call of the database is counted, so "no loop" is a number
const calls: string[] = [];
let counting = false;
(db as unknown as { $use: (fn: (p: { model?: string; action: string }, next: (p: unknown) => Promise<unknown>) => Promise<unknown>) => void }).$use(async (params, next) => {
  if (counting) calls.push(`${params.model ?? "raw"}.${params.action}`);
  return next(params);
});
const counted = async <T>(fn: () => Promise<T>): Promise<{ result: T; calls: string[] }> => {
  calls.length = 0;
  counting = true;
  try {
    return { result: await fn(), calls: [...calls] };
  } finally {
    counting = false;
  }
};

const SECRET = "نصسريمحذوف";
let at = Date.parse("2026-11-17T10:00:00.000Z");
const nextAt = () => new Date((at += 60_000));

async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const b = await makeUser({ orgId, role: "MEMBER", name: "Bee" });
  const spaceAdmin = await makeUser({ orgId, role: "MEMBER", name: "SpaceAdmin" });
  const s1 = await makeWorkspace(orgId, [{ userId: spaceAdmin.id, role: "ADMIN" }, { userId: t.member.id }, { userId: b.id }, { userId: t.guest.id }], "Alpha");
  const s2 = await makeWorkspace(orgId, [{ userId: t.member.id }], "Beta");
  const topic = (spaceId: string, title: string, extra: Record<string, unknown> = {}) => db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId, title, ...extra } });
  const open1 = await topic(s1.id, "OpenOne");
  const restricted1 = await topic(s1.id, "Restricted", { restricted: true, members: { create: [{ userId: t.member.id }, { userId: spaceAdmin.id }] } });
  const open2 = await topic(s2.id, "OpenTwo");
  const ctx = (u: { id: string }, orgRole: Ctx["orgRole"]): Ctx => ({ orgId, userId: u.id, orgRole });
  const memberCtx = ctx(t.member, "MEMBER");
  const dm = await openDm(memberCtx, b.id, s1.id);
  const say = (conversationId: string, authorId: string, body: string, extra: Record<string, unknown> = {}) =>
    db.chatMessage.create({ data: { orgId, conversationId, authorId, body, createdAt: nextAt(), ...extra } });
  return { t, b, spaceAdmin, s1, s2, open1, restricted1, open2, dm: dm.id, ctx, memberCtx, say };
}
type World = Awaited<ReturnType<typeof world>>;
let cached: Promise<World> | null = null;
const getWorld = () => (cached ??= world());

let goneDm = "";
const rowOf = (rows: ChatRowDto[], kind: ChatRowDto["kind"], id: string) => rows.find((r) => r.kind === kind && r.id === id);

beforeAll(async () => {
  const w = await getWorld();
  // member's view: 2 from Bee in the open topic, 1 mention, one from himself; the restricted topic has a message from the space admin
  await w.say(w.open1.id, w.b.id, "one");
  await w.say(w.open1.id, w.b.id, `two @${w.t.member.id}`, { mentions: [w.t.member.id] });
  await w.say(w.open1.id, w.t.member.id, "mine");
  await w.say(w.restricted1.id, w.spaceAdmin.id, "private words");
  await w.say(w.open2.id, w.b.id, "in beta");
  await w.say(w.dm, w.b.id, "dm one");
  await w.say(w.dm, w.b.id, "dm two");
  // the member has a read mark in the open topic too (the old home counts mentions only for a topic the person has a mark in)
  await db.conversationMember.create({ data: { conversationId: w.open1.id, userId: w.t.member.id } });
  // rows born now: move every read mark back so the unread numbers are real
  await db.conversationMember.updateMany({ where: { userId: w.t.member.id }, data: { lastReadAt: new Date("2026-11-17T09:00:00.000Z") } });
});

describe("the one list (D-N2 «قائمة وحدة»): no spaceId", () => {
  it("one forum row per space the person reads, and the private chat with its space chip", async () => {
    const w = await getWorld();
    const { rows, scope, canOversee } = await chatList(w.memberCtx);
    expect(scope).toBe("all");
    expect(canOversee).toBe(false);
    const alpha = rowOf(rows, "SPACE", w.s1.id)!;
    const beta = rowOf(rows, "SPACE", w.s2.id)!;
    expect(alpha.title).toBe("Alpha");
    expect(beta.title).toBe("Beta");
    // Alpha: «OpenOne» (2 from Bee) + «Restricted» (1) — the member is in both; the number is the sum
    expect(alpha.unread).toBe(3);
    expect(alpha.mentionsUnread).toBe(1);
    expect(alpha.topicCount).toBe(2);
    expect(alpha.topicChips?.map((c) => c.title).sort()).toEqual(["OpenOne", "Restricted"]);
    expect(beta.unread).toBe(1);
    const dm = rowOf(rows, "DM", w.dm)!;
    expect(dm.title).toBe("Bee");
    expect(dm.unread).toBe(2);
    expect(dm.space).toEqual({ id: w.s1.id, name: "Alpha" });
    expect(dm.lastMessage?.preview).toBe("dm two");
    expect(dm.lastMessage?.mine).toBe(false);
    // topics are folded into their space: no separate TOPIC rows in this shape
    expect(rows.some((r) => r.kind === "TOPIC")).toBe(false);
    // newest activity first
    const times = rows.map((r) => Date.parse(r.lastMessage?.at ?? "1970-01-01T00:00:00Z"));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("a restricted topic is in the row of the people in it only; the others neither see it nor count it", async () => {
    const w = await getWorld();
    const { rows } = await chatList(w.ctx(w.b, "MEMBER"));
    const alpha = rowOf(rows, "SPACE", w.s1.id)!;
    expect(alpha.topicChips?.map((c) => c.title)).toEqual(["OpenOne"]);
    expect(alpha.topicCount).toBe(1);
    expect(JSON.stringify(rows)).not.toContain("private words");
    expect(JSON.stringify(rows)).not.toContain(w.restricted1.id);
    // Bee is in Alpha only: Beta is not on his list
    expect(rowOf(rows, "SPACE", w.s2.id)).toBeUndefined();
  });

  it("a guest reads topics only: no private chat, no space he is not in, no one else's restricted topic", async () => {
    const w = await getWorld();
    const { rows } = await chatList(w.ctx(w.t.guest, "GUEST"));
    expect(rows.map((r) => `${r.kind}:${r.id}`)).toEqual([`SPACE:${w.s1.id}`]);
    expect(rows[0]!.hasExternal).toBe(false); // an external partner is never told who else is outside
    expect(JSON.stringify(rows)).not.toContain(w.dm);
    expect(JSON.stringify(rows)).not.toContain("private words");
  });

  it("the silent eye reads every topic in the list, but another person's private chat only through the oversight list", async () => {
    const w = await getWorld();
    const { rows, canOversee } = await chatList(w.ctx(w.t.owner, "OWNER"));
    expect(canOversee).toBe(true);
    expect(rowOf(rows, "SPACE", w.s1.id)!.topicChips?.map((c) => c.title).sort()).toEqual(["OpenOne", "Restricted"]);
    expect(rowOf(rows, "SPACE", w.s2.id)).toBeDefined();
    expect(rows.some((r) => r.kind === "DM")).toBe(false);
    // and his reading counts nothing: no row of his own, so nothing is «unread» for him
    expect(rows.reduce((n, r) => n + r.unread, 0)).toBe(0);
  });

  it("a private chat whose other person left the company is not listed for the one who stays", async () => {
    const w = await getWorld();
    const gone = await makeUser({ orgId: w.t.org.id, role: "MEMBER", name: "Gone" });
    await db.workspaceMember.create({ data: { workspaceId: w.s1.id, userId: gone.id } });
    const made = await openDm(w.memberCtx, gone.id, w.s1.id);
    goneDm = made.id;
    await w.say(made.id, gone.id, "bye");
    expect(rowOf((await chatList(w.memberCtx)).rows, "DM", made.id)).toBeDefined();
    await db.organizationMember.updateMany({ where: { organizationId: w.t.org.id, userId: gone.id }, data: { status: "OFFBOARDED" } });
    expect(rowOf((await chatList(w.memberCtx)).rows, "DM", made.id)).toBeUndefined();
  });

  it("a deleted last message is a tombstone: no preview, and its text never left the database", async () => {
    const w = await getWorld();
    const topic = await db.conversation.create({ data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.s2.id, title: "Tomb" } });
    await w.say(topic.id, w.b.id, SECRET, { deletedAt: new Date(), deletedById: w.b.id });
    const { rows } = await chatList(w.memberCtx);
    const beta = rowOf(rows, "SPACE", w.s2.id)!;
    expect(beta.topicChips?.map((c) => c.title)).toContain("Tomb");
    expect(JSON.stringify(rows)).not.toContain(SECRET);
    const per = (await chatList(w.memberCtx, { spaceId: w.s2.id })).rows.find((r) => r.id === topic.id)!;
    expect(per.lastMessage?.preview).toBeNull();
    expect(per.lastMessage?.authorName).toBe("Bee");
    expect(per.unread).toBe(0); // a deleted message never counts
  });
});

describe("one space (D-N2 «كل مساحة حساب»): with spaceId", () => {
  it("that space's topics, then its private chats — nothing of any other space", async () => {
    const w = await getWorld();
    const { rows, scope, spaceId } = await chatList(w.memberCtx, { spaceId: w.s1.id });
    expect(scope).toBe("space");
    expect(spaceId).toBe(w.s1.id);
    expect(rows.filter((r) => r.kind === "TOPIC").map((r) => r.title).sort()).toEqual(["OpenOne", "Restricted"]);
    expect(rows.find((r) => r.kind === "DM")?.id).toBe(w.dm);
    expect(rows.some((r) => r.kind === "SPACE")).toBe(false);
    expect(JSON.stringify(rows)).not.toContain("OpenTwo");
    // topics come before private chats
    expect(rows.findIndex((r) => r.kind === "DM")).toBeGreaterThan(rows.map((r) => r.kind).lastIndexOf("TOPIC"));
    const other = (await chatList(w.memberCtx, { spaceId: w.s2.id })).rows;
    expect(other.some((r) => r.kind === "DM")).toBe(false);
  });

  it("a space that is not the person's lists nothing (the same as a space that does not exist)", async () => {
    const w = await getWorld();
    expect((await chatList(w.ctx(w.b, "MEMBER"), { spaceId: w.s2.id })).rows).toEqual([]);
    expect((await chatList(w.ctx(w.b, "MEMBER"), { spaceId: "no-such-space" })).rows).toEqual([]);
  });

  it("the numbers are the old home's, topic for topic and chat for chat", async () => {
    const w = await getWorld();
    const home = await chatHome(w.memberCtx, { spaceId: w.s1.id });
    const list = await chatList(w.memberCtx, { spaceId: w.s1.id });
    for (const t of home.spaces[0]!.topics) {
      const row = list.rows.find((r) => r.id === t.id)!;
      expect(row, t.title).toBeDefined();
      expect({ unread: row.unread, mentions: row.mentionsUnread, preview: row.lastMessage?.preview ?? null }).toEqual({ unread: t.unread, mentions: t.mentions, preview: t.lastMessage?.preview ?? null });
    }
    for (const d of home.dms) {
      // the old home still lists the chat of a person who left the company (its door answers «not found»); the list does not
      if (d.id === goneDm) {
        expect(list.rows.some((r) => r.id === d.id)).toBe(false);
        continue;
      }
      const row = list.rows.find((r) => r.id === d.id)!;
      expect({ unread: row.unread, preview: row.lastMessage?.preview ?? null }).toEqual({ unread: d.unread, preview: d.lastMessage?.preview ?? null });
    }
  });

  it("the old days: a private chat with no space belongs to «الشركة» and shows there", async () => {
    const w = await getWorld();
    const hq = await db.workspace.create({ data: { organizationId: w.t.org.id, name: "Company", slug: `hq-${w.t.org.id}`, systemKey: "hq", kind: "HQ", members: { create: [{ userId: w.t.member.id }] } } });
    const old = await db.conversation.create({ data: { orgId: w.t.org.id, kind: "DM", dmKey: dmKeyOf(w.t.member.id, w.b.id), members: { create: [{ userId: w.t.member.id }, { userId: w.b.id }] } } });
    await w.say(old.id, w.b.id, "from before spaces");
    const here = (await chatList(w.memberCtx, { spaceId: hq.id })).rows.find((r) => r.id === old.id);
    expect(here?.space).toEqual({ id: hq.id, name: "Company" });
    expect((await chatList(w.memberCtx, { spaceId: w.s1.id })).rows.some((r) => r.id === old.id)).toBe(false);
    expect(rowOf((await chatList(w.memberCtx)).rows, "DM", old.id)?.space?.name).toBe("Company");
  });
});

describe("ONE query: nothing loops over the conversations", () => {
  it("the calls do not grow with the number of conversations", async () => {
    const w = await getWorld();
    const small = await counted(() => chatList({ ...w.memberCtx }));
    // eight more topics and four more chats
    for (let i = 0; i < 8; i++) {
      const c = await db.conversation.create({ data: { orgId: w.t.org.id, kind: "TOPIC", spaceId: w.s1.id, title: `Extra ${i}` } });
      await w.say(c.id, w.b.id, `hello ${i}`);
    }
    for (let i = 0; i < 4; i++) {
      const p = await makeUser({ orgId: w.t.org.id, role: "MEMBER" });
      await db.workspaceMember.create({ data: { workspaceId: w.s1.id, userId: p.id } });
      const d = await openDm(w.memberCtx, p.id, w.s1.id);
      await w.say(d.id, p.id, "hi");
    }
    const big = await counted(() => chatList({ ...w.memberCtx }));
    expect(big.result.rows.length).toBeGreaterThan(small.result.rows.length);
    expect(big.calls).toEqual(small.calls);
    expect(big.calls.length).toBeLessThanOrEqual(3);
    const perSpace = await counted(() => chatList({ ...w.memberCtx }, { spaceId: w.s1.id }));
    expect(perSpace.calls.length).toBeLessThanOrEqual(3);
  });
});

describe("GET /api/chat/list and the switch chatOneList", () => {
  const get = (query = "") => call(listRoute.GET, { url: `http://localhost/api/chat/list${query}` });
  const setSwitch = async (orgId: string, on: boolean | null) => {
    await db.organization.update({ where: { id: orgId }, data: { settings: on === null ? {} : { features: { chatOneList: on } } } });
  };
  const cookieJar = () => (globalThis as unknown as { __zkCookieJar: Map<string, string> }).__zkCookieJar;

  it("ON (the default, pending D-N2): the one list; OFF: the space the person is in, like the old home; ?spaceId= always wins", async () => {
    const w = await getWorld();
    await loginAs(w.t.member.id);
    cookieJar().set("zk-space", w.s2.id);
    try {
      await setSwitch(w.t.org.id, null);
      const on = (await get()).json as { scope: string; rows: ChatRowDto[] };
      expect(on.scope).toBe("all");
      expect(on.rows.some((r) => r.kind === "SPACE" && r.id === w.s1.id)).toBe(true);

      await setSwitch(w.t.org.id, false);
      const off = (await get()).json as { scope: string; spaceId: string; rows: ChatRowDto[] };
      expect(off.scope).toBe("space");
      expect(off.spaceId).toBe(w.s2.id);
      expect(off.rows.every((r) => r.kind !== "SPACE")).toBe(true);
      expect(JSON.stringify(off.rows)).not.toContain("OpenOne");

      const named = (await get(`?spaceId=${w.s1.id}`)).json as { scope: string; spaceId: string; rows: ChatRowDto[] };
      expect(named.scope).toBe("space");
      expect(named.spaceId).toBe(w.s1.id);
      expect(named.rows.some((r) => r.title === "OpenOne")).toBe(true);
    } finally {
      cookieJar().delete("zk-space");
      await setSwitch(w.t.org.id, null);
    }
  });

  it("the company's settings are read once for the request (the switch and the rest share one read)", async () => {
    const w = await getWorld();
    await loginAs(w.t.member.id);
    const run = await counted(() => get());
    expect(run.calls.filter((c) => c === "Organization.findUnique")).toHaveLength(1);
  });

  it("asking for another person's space writes nothing and lists nothing; the door needs a signed-in person", async () => {
    const w = await getWorld();
    const other = await makeTeam();
    const foreign = await makeWorkspace(other.org.id, [{ userId: other.member.id }]);
    await loginAs(w.t.member.id);
    const res = await get(`?spaceId=${foreign.id}`);
    expect(res.status).toBe(200);
    expect((res.json as { rows: unknown[] }).rows).toEqual([]);
    // no starter topic was written into the other company's space on this person's behalf
    expect(await db.conversation.count({ where: { spaceId: foreign.id } })).toBe(0);
    const { logout } = await import("./helpers");
    logout();
    expect((await get()).status).toBe(401);
  });

  it("a space with no topic gets its starter topics when the person opens the list (the old home did the same for the current space)", async () => {
    const w = await getWorld();
    const bare = await makeWorkspace(w.t.org.id, [{ userId: w.t.member.id }], "Bare");
    await loginAs(w.t.member.id);
    const res = (await get()).json as { rows: ChatRowDto[] };
    expect(res.rows.find((r) => r.kind === "SPACE" && r.id === bare.id)?.topicCount).toBe(2);
  });
});
