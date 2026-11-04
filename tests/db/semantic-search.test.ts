import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as searchRoute from "@/app/api/search/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as messageRoute from "@/app/api/chat/messages/[id]/route";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { withFeature, type FeatureKey } from "@/lib/features";
import { setLocalTransportForTests } from "@/server/ai/local-transport";
import { runDueJobs } from "@/server/jobs/run";
import { backfillOrg, clearBackfillStateForTests, settleSyncsForTests, syncItems } from "@/server/services/search-embed-index";
import { embedServer, setEmbedderForTests } from "@/server/services/search-embeddings";
import { clearQuestionCacheForTests, resetSemanticLimiterForTests } from "@/server/services/search-semantic";
import { call, db, loginAs, makeProject, makeTask, makeUser, makeWorkspace, uid } from "./helpers";
import { makeTeamsWorld } from "./teams-helpers";

/**
 * «بحث بالمعنى»: the search finds a message or task by meaning, only what the person can read, never what a guest can reach, and never
 * without the switch. The embeddings service is FAKE and deterministic: a text is a vector of the ideas it mentions.
 */

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);

const IDEAS: [RegExp, number[]][] = [
  [/كراتين|علب|تغليف/, [1, 0, 0, 0]],
  [/فواتير|محاسبة/, [0, 1, 0, 0]],
  [/سيارة|شحن/, [0, 0, 1, 0]],
];
function fakeVector(text: string): number[] {
  const v = [0, 0, 0, 0];
  for (const [re, idea] of IDEAS) if (re.test(text)) idea.forEach((x, i) => (v[i] = (v[i] as number) + x));
  return v.every((x) => x === 0) ? [0, 0, 0, 1] : v;
}

let sent: string[][] = [];
const saved: Record<string, string | undefined> = {};
const KEYS = ["EMBED_URL", "EMBED_MODEL", "EMBED_API_KEY", "EMBED_MIN_SCORE"];

beforeAll(() => {
  for (const k of KEYS) saved[k] = process.env[k];
});
beforeEach(() => {
  process.env["EMBED_URL"] = "http://embed:8080";
  process.env["EMBED_MODEL"] = "fake-model";
  delete process.env["EMBED_API_KEY"];
  delete process.env["EMBED_MIN_SCORE"];
  sent = [];
  setLocalTransportForTests(null);
  setEmbedderForTests(async (texts) => {
    sent.push(texts);
    return texts.map(fakeVector);
  });
  clearBackfillStateForTests();
  clearQuestionCacheForTests();
});
afterAll(() => {
  setEmbedderForTests(null);
  setLocalTransportForTests(null);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function setSwitch(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

const sentCount = () => sent.reduce((n, b) => n + b.length, 0);

type Body = { tasks: { id: string; semantic?: boolean }[]; messages: { id: string; semantic?: boolean; conversationId: string }[] };
const search = async (q: string) => (await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent(q)}` })).json as unknown as Body;

async function world() {
  const w = await makeTeamsWorld();
  await setSwitch(w.org.id, "semanticSearch", true);
  const topic = (title: string, spaceId: string, extra: Partial<{ teamId: string | null; restricted: boolean }> = {}) =>
    db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId, title, ...extra } });
  const open = await topic(`Open ${uid()}`, w.s.id);
  const teamY = await topic(`Y ${uid()}`, w.s.id, { teamId: w.y.id });
  const restricted = await topic(`R ${uid()}`, w.s.id, { restricted: true });
  const say = (conversationId: string, body: string, extra: Record<string, unknown> = {}) =>
    db.chatMessage.create({ data: { orgId: w.org.id, conversationId, authorId: w.spaceAdmin.id, body, ...extra } });
  const index = async () => {
    clearBackfillStateForTests();
    return backfillOrg(w.org.id, Date.now(), embedServer()!);
  };
  // the teams world brings five tasks of its own; tests that count what is indexed start from none
  const noTasks = () => db.task.deleteMany({ where: { orgId: w.org.id } });
  return { ...w, open, teamY, restricted, topic, say, index, noTasks };
}

const rowsOf = (kind: string, refIds: string[]) => db.searchEmbedding.findMany({ where: { kind, refId: { in: refIds } } });

describe("finding by meaning", () => {
  it("«علب التغليف» finds the message about «الكراتين» and the task «شراء كراتين», marked, after the words' own hits", async () => {
    const w = await world();
    const msg = await w.say(w.open.id, "طلبنا الكراتين الجديدة من المورد");
    const noise = await w.say(w.open.id, "اجتماع الفريق يوم الخميس الساعة عشرة");
    const task = await makeTask({ orgId: w.org.id, workspaceId: w.s.id, projectId: w.p0.project.id, boardId: w.p0.board.id, columnId: w.p0.todo.id, creatorId: w.owner.id, title: "شراء كراتين للمستودع" });
    const wordHit = await w.say(w.open.id, "عندنا علب التغليف جاهزة للشحن اليوم");
    await w.index();
    await loginAs(w.carol.id);
    enter(w.s.id);
    const body = await search("علب التغليف");
    const ids = body.messages.map((m) => m.id);
    // the words found one (it has «علب» and «التغليف»); the meaning adds the other after it; the noise stays out
    expect(ids[0]).toBe(wordHit.id);
    expect(ids).toContain(msg.id);
    expect(ids).not.toContain(noise.id);
    expect(body.messages.find((m) => m.id === msg.id)?.semantic).toBe(true);
    expect(body.messages.find((m) => m.id === wordHit.id)?.semantic).not.toBe(true);
    expect(body.tasks.map((t) => t.id)).toContain(task.id);
    expect(body.tasks.find((t) => t.id === task.id)?.semantic).toBe(true);
    // no vector in the answer
    expect(JSON.stringify(body)).not.toMatch(/vector|embedding/i);
  });

  it("switch off (the default): the word search exactly, nothing is sent, nothing indexed, nothing queried", async () => {
    const w = await world();
    await setSwitch(w.org.id, "semanticSearch", false);
    const msg = await w.say(w.open.id, "طلبنا الكراتين الجديدة من المورد");
    const r = await w.index();
    expect(r).toEqual({ embedded: 0, failed: 0 });
    expect((await syncItems(w.org.id, "message", [msg.id])).embedded).toBe(0);
    expect(await rowsOf("message", [msg.id])).toHaveLength(0);
    await loginAs(w.carol.id);
    enter(w.s.id);
    expect((await search("علب التغليف")).messages).toEqual([]);
    expect(sentCount()).toBe(0);
    // a vector made while it was on is not used while it is off
    await setSwitch(w.org.id, "semanticSearch", true);
    await w.index();
    expect(await rowsOf("message", [msg.id])).toHaveLength(1);
    await setSwitch(w.org.id, "semanticSearch", false);
    const before = sentCount();
    clearQuestionCacheForTests();
    expect((await search("علب التغليف")).messages).toEqual([]);
    expect(sentCount()).toBe(before);
  });

  it("no service set up: the word search alone, nothing fails", async () => {
    const w = await world();
    const msg = await w.say(w.open.id, "طلبنا الكراتين الجديدة من المورد");
    await w.index();
    delete process.env["EMBED_URL"];
    await loginAs(w.carol.id);
    enter(w.s.id);
    const res = await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent("علب التغليف")}` });
    expect(res.status).toBe(200);
    expect((res.json as unknown as Body).messages.map((m) => m.id)).not.toContain(msg.id);
  });

  it("a service that is down is not an error: the words answer", async () => {
    const w = await world();
    const word = await w.say(w.open.id, "عندنا علب التغليف جاهزة للشحن اليوم");
    await w.index();
    setEmbedderForTests(async () => {
      throw new Error("ECONNREFUSED");
    });
    await loginAs(w.carol.id);
    enter(w.s.id);
    const res = await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent("علب التغليف")}` });
    expect(res.status).toBe(200);
    expect((res.json as unknown as Body).messages.map((m) => m.id)).toEqual([word.id]);
  });
});

describe("a person never gets a result from what they cannot read", () => {
  it("a «مقطع» topic, a restricted topic and a task of another team are found only by the people who may open them", async () => {
    const w = await world();
    const inY = await w.say(w.teamY.id, "كراتين خاصة بفريق Y فقط");
    const inR = await w.say(w.restricted.id, "كراتين في موضوع مقيّد");
    const inOpen = await w.say(w.open.id, "كراتين مفتوحة للجميع هنا");
    const ty = await makeTask({ orgId: w.org.id, workspaceId: w.s.id, projectId: w.py.project.id, boardId: w.py.board.id, columnId: w.py.todo.id, creatorId: w.owner.id, title: "كراتين مشروع فريق Y" });
    const t0 = await makeTask({ orgId: w.org.id, workspaceId: w.s.id, projectId: w.p0.project.id, boardId: w.p0.board.id, columnId: w.p0.todo.id, creatorId: w.owner.id, title: "كراتين مشروع الفضاء" });
    await w.index();

    await loginAs(w.carol.id);
    enter(w.s.id);
    const carol = await search("علب التغليف");
    expect(carol.messages.map((m) => m.id)).toEqual([inOpen.id]);
    expect(carol.tasks.map((t) => t.id)).toEqual([t0.id]);

    await loginAs(w.bob.id);
    enter(w.s.id);
    const bob = await search("علب التغليف");
    expect(bob.messages.map((m) => m.id).sort()).toEqual([inOpen.id, inY.id].sort());
    expect(bob.messages.map((m) => m.id)).not.toContain(inR.id);
    expect(bob.tasks.map((t) => t.id).sort()).toEqual([t0.id, ty.id].sort());

    // the owner reads everything silently: the same rule as opening it
    await loginAs(w.owner.id);
    enter(w.s.id);
    const owner = await search("علب التغليف");
    expect(owner.messages.map((m) => m.id).sort()).toEqual([inOpen.id, inY.id, inR.id].sort());
  });

  it("another space's talk and tasks, and a person outside the company, are never found", async () => {
    const w = await world();
    const elsewhere = await w.topic(`E ${uid()}`, w.other.id);
    const there = await w.say(elsewhere.id, "كراتين في فضاء ثاني تمامًا");
    const tt = await makeTask({ orgId: w.org.id, workspaceId: w.other.id, projectId: w.pt.project.id, boardId: w.pt.board.id, columnId: w.pt.todo.id, creatorId: w.owner.id, title: "كراتين الفضاء الثاني" });
    await w.index();
    await loginAs(w.carol.id);
    enter(w.s.id);
    const carol = await search("علب التغليف");
    expect(carol.messages.map((m) => m.id)).not.toContain(there.id);
    expect(carol.tasks.map((t) => t.id)).not.toContain(tt.id);
    // a person of ANOTHER company who is handed the vectors' ids by accident: their own org holds none
    const other = await makeUser({ role: "MEMBER" });
    const org2 = await db.organization.create({ data: { name: `O ${uid()}`, slug: `o-${uid()}`, keyPrefix: `K${uid()}`.toUpperCase(), joinCode: `J${uid()}`.toUpperCase() } });
    await db.organizationMember.create({ data: { organizationId: org2.id, userId: other.id, role: "MEMBER" } });
    await setSwitch(org2.id, "semanticSearch", true);
    const space2 = await makeWorkspace(org2.id, [{ userId: other.id }]);
    await loginAs(other.id);
    enter(space2.id);
    const out = await search("علب التغليف");
    expect(out.messages).toEqual([]);
    expect(out.tasks).toEqual([]);
  });

  it("a message deleted or an task archived after it was indexed is dropped at the answer, whatever its vector says", async () => {
    const w = await world();
    const msg = await w.say(w.open.id, "طلبنا الكراتين الجديدة من المورد");
    const task = await makeTask({ orgId: w.org.id, workspaceId: w.s.id, projectId: w.p0.project.id, boardId: w.p0.board.id, columnId: w.p0.todo.id, creatorId: w.owner.id, title: "شراء كراتين للمستودع" });
    await w.index();
    await db.chatMessage.update({ where: { id: msg.id }, data: { deletedAt: new Date() } });
    await db.task.update({ where: { id: task.id }, data: { archived: true } });
    await loginAs(w.carol.id);
    enter(w.s.id);
    const body = await search("علب التغليف");
    expect(body.messages).toEqual([]);
    expect(body.tasks).toEqual([]);
  });

  it("a guest (or one who is a guest of a space) never asks the service and gets the word search only", async () => {
    const w = await world();
    await w.say(w.open.id, "طلبنا الكراتين الجديدة من المورد");
    await w.index();
    const guest = await makeUser({ orgId: w.org.id, role: "GUEST", name: `G ${uid()}` });
    await db.workspaceMember.create({ data: { workspaceId: w.s.id, userId: guest.id, role: "GUEST" } });
    await loginAs(guest.id);
    enter(w.s.id);
    const before = sentCount();
    expect((await search("علب التغليف")).messages).toEqual([]);
    expect(sentCount()).toBe(before);
    // a staff member who is «ضيف» in one space is kept away from the service too
    const part = await makeUser({ orgId: w.org.id, role: "MEMBER", name: `P ${uid()}` });
    await db.workspaceMember.createMany({ data: [{ workspaceId: w.s.id, userId: part.id, role: "MEMBER" }, { workspaceId: w.plain.id, userId: part.id, role: "GUEST" }] });
    await loginAs(part.id);
    enter(w.s.id);
    expect((await search("علب التغليف")).messages).toEqual([]);
    expect(sentCount()).toBe(before);
  });
});

describe("what is indexed", () => {
  it("never a guest-reachable conversation or space, never a direct chat, a group, a short, system, voice or deleted line", async () => {
    const w = await world();
    const guest = await makeUser({ orgId: w.org.id, role: "GUEST", name: `G ${uid()}` });
    const withGuest = await makeWorkspace(w.org.id, [{ userId: w.carol.id }, { userId: guest.id, role: "GUEST" }], `WG ${uid()}`);
    const guestTopic = await w.topic(`GT ${uid()}`, withGuest.id);
    const gMsg = await w.say(guestTopic.id, "كراتين داخل فضاء فيه ضيف");
    const pg = await makeProject(withGuest.id);
    const gTask = await makeTask({ orgId: w.org.id, workspaceId: withGuest.id, projectId: pg.project.id, boardId: pg.board.id, columnId: pg.todo.id, creatorId: w.owner.id, title: "كراتين لفضاء فيه ضيف" });
    // a restricted topic of a clean space that a guest was added to as a member of the conversation
    const orgGuestTopic = await w.topic(`OG ${uid()}`, w.s.id, { restricted: true });
    await db.conversationMember.createMany({ data: [{ conversationId: orgGuestTopic.id, userId: w.carol.id }, { conversationId: orgGuestTopic.id, userId: guest.id }] });
    const ogMsg = await w.say(orgGuestTopic.id, "كراتين في موضوع فيه ضيف عضو");
    const dm = await db.conversation.create({ data: { orgId: w.org.id, kind: "DM", dmKey: `${w.alice.id}|${w.bob.id}` } });
    const dmMsg = await w.say(dm.id, "كراتين في محادثة خاصة بين اثنين");
    const group = await db.conversation.create({ data: { orgId: w.org.id, kind: "GROUP", title: "g" } });
    const groupMsg = await w.say(group.id, "كراتين في مجموعة قديمة");
    const short = await w.say(w.open.id, "كراتين");
    const system = await w.say(w.open.id, `{"k":"join","x":"كراتين كراتين كراتين"}`, { kind: "SYSTEM" });
    const voice = await w.say(w.open.id, "كراتين رسالة صوتية طويلة", { kind: "VOICE" });
    const deleted = await w.say(w.open.id, "كراتين رسالة محذوفة طويلة", { deletedAt: new Date() });
    const good = await w.say(w.open.id, "كراتين رسالة عادية وطويلة");
    await w.index();
    // the job's own pick AND the direct door both refuse
    const all = [gMsg, ogMsg, dmMsg, groupMsg, short, system, voice, deleted, good];
    await syncItems(w.org.id, "message", all.map((m) => m.id));
    await syncItems(w.org.id, "task", [gTask.id]);
    const rows = await rowsOf("message", all.map((m) => m.id));
    expect(rows.map((r) => r.refId)).toEqual([good.id]);
    expect(await rowsOf("task", [gTask.id])).toHaveLength(0);
    // the text that was sent never carried the refused lines
    expect(sent.flat().join(" ")).not.toContain("ضيف");
    expect(sent.flat().join(" ")).not.toContain("خاصة بين اثنين");
  });

  it("a vector made before a guest arrived is not returned afterwards, and a direct sync removes it", async () => {
    const w = await world();
    const msg = await w.say(w.open.id, "طلبنا الكراتين الجديدة من المورد");
    const task = await makeTask({ orgId: w.org.id, workspaceId: w.s.id, projectId: w.p0.project.id, boardId: w.p0.board.id, columnId: w.p0.todo.id, creatorId: w.owner.id, title: "شراء كراتين للمستودع" });
    await w.index();
    expect(await rowsOf("message", [msg.id])).toHaveLength(1);
    const guest = await makeUser({ orgId: w.org.id, role: "GUEST", name: `G ${uid()}` });
    await db.workspaceMember.create({ data: { workspaceId: w.s.id, userId: guest.id, role: "GUEST" } });
    await loginAs(w.carol.id);
    enter(w.s.id);
    const body = await search("علب التغليف");
    expect(body.messages).toEqual([]);
    expect(body.tasks).toEqual([]);
    await syncItems(w.org.id, "message", [msg.id]);
    await syncItems(w.org.id, "task", [task.id]);
    expect(await rowsOf("message", [msg.id])).toHaveLength(0);
    expect(await rowsOf("task", [task.id])).toHaveLength(0);
  });

  it("the text that leaves is filtered: a phone number or an e-mail never reaches the service, and the question is filtered too", async () => {
    const w = await world();
    await w.say(w.open.id, "كلمني على 0791234567 أو ahmad@example.com بخصوص الكراتين");
    await w.index();
    expect(sent.flat().join(" ")).not.toContain("0791234567");
    expect(sent.flat().join(" ")).not.toContain("ahmad@example.com");
    expect(sent.flat().join(" ")).toContain("الكراتين");
    await loginAs(w.carol.id);
    enter(w.s.id);
    await search("علب التغليف 0799999999");
    expect(sent.flat().join(" ")).not.toContain("0799999999");
  });
});

describe("the backfill and the hooks", () => {
  it("is idempotent: a second run sends nothing, a changed text is sent again, an unchanged one is not", async () => {
    const w = await world();
    await w.noTasks();
    const a = await w.say(w.open.id, "طلبنا الكراتين الجديدة من المورد");
    const b = await w.say(w.open.id, "فواتير الشهر الماضي جاهزة للمراجعة");
    const task = await makeTask({ orgId: w.org.id, workspaceId: w.s.id, projectId: w.p0.project.id, boardId: w.p0.board.id, columnId: w.p0.todo.id, creatorId: w.owner.id, title: "شراء كراتين للمستودع" });
    const first = await w.index();
    expect(first.embedded).toBe(3);
    const calls = sentCount();
    const count = await db.searchEmbedding.count({ where: { orgId: w.org.id } });
    expect(count).toBe(3);
    expect((await w.index()).embedded).toBe(0);
    expect(sentCount()).toBe(calls);
    expect(await db.searchEmbedding.count({ where: { orgId: w.org.id } })).toBe(count);
    // the same text again: skipped; a new text: sent once
    expect((await syncItems(w.org.id, "message", [a.id])).skipped).toBe(1);
    expect(sentCount()).toBe(calls);
    await db.chatMessage.update({ where: { id: b.id }, data: { body: "سيارة الشحن وصلت إلى المستودع" } });
    expect((await syncItems(w.org.id, "message", [b.id])).embedded).toBe(1);
    expect(sentCount()).toBe(calls + 1);
    expect(await db.searchEmbedding.count({ where: { orgId: w.org.id } })).toBe(count);
    expect(task.id).toBeTruthy();
  });

  it("goes a small batch at a time, newest first", async () => {
    const w = await world();
    await w.noTasks();
    const base = Date.now() - 100_000_000;
    const made = [];
    for (let i = 0; i < 40; i++) made.push(await w.say(w.open.id, `رسالة رقم ${i} عن الكراتين الجديدة`, { createdAt: new Date(base + i * 60_000) }));
    const first = await w.index();
    expect(first.embedded).toBe(32);
    const done = new Set((await db.searchEmbedding.findMany({ where: { orgId: w.org.id }, select: { refId: true } })).map((r) => r.refId));
    expect(made.slice(8).every((m) => done.has(m.id))).toBe(true);
    expect(made.slice(0, 8).some((m) => done.has(m.id))).toBe(false);
    expect((await w.index()).embedded).toBe(8);
    expect((await w.index()).embedded).toBe(0);
  });

  it("a vector of another model is not used and is made again", async () => {
    const w = await world();
    await w.noTasks();
    const msg = await w.say(w.open.id, "طلبنا الكراتين الجديدة من المورد");
    await w.index();
    process.env["EMBED_MODEL"] = "other-model";
    await loginAs(w.carol.id);
    enter(w.s.id);
    expect((await search("علب التغليف")).messages).toEqual([]);
    expect((await w.index()).embedded).toBe(1);
    expect((await rowsOf("message", [msg.id]))[0]?.model).toBe("other-model");
    clearQuestionCacheForTests();
    expect((await search("علب التغليف")).messages.map((m) => m.id)).toEqual([msg.id]);
  });

  it("the job runner runs it for the companies that switched it on", async () => {
    const w = await world();
    const msg = await w.say(w.open.id, "طلبنا الكراتين الجديدة من المورد");
    const run = await runDueJobs(new Date());
    expect(run.failed).not.toContain("searchEmbed");
    expect(run.searchEmbed?.embedded).toBeGreaterThanOrEqual(1);
    expect(await rowsOf("message", [msg.id])).toHaveLength(1);
    delete process.env["EMBED_URL"];
    expect((await runDueJobs(new Date())).searchEmbed).toBeNull();
  });

  it("a message sent, edited and deleted keeps its vector in step, in the background", async () => {
    const w = await world();
    await loginAs(w.carol.id);
    const sentRes = await call(messagesRoute.POST, { params: { id: w.open.id }, body: { body: "طلبنا الكراتين الجديدة من المورد" } });
    expect(sentRes.status).toBeLessThan(300);
    const id = sentRes.json?.["id"] as string;
    await settleSyncsForTests();
    expect(await rowsOf("message", [id])).toHaveLength(1);
    const edited = await call(messageRoute.PATCH, { params: { id }, body: { body: "فواتير الشهر الماضي جاهزة للمراجعة" } });
    expect(edited.status).toBeLessThan(300);
    await settleSyncsForTests();
    const row = (await rowsOf("message", [id]))[0]!;
    expect(row.vector).toEqual(fakeVector("فواتير"));
    const deleted = await call(messageRoute.DELETE, { params: { id } });
    expect(deleted.status).toBeLessThan(300);
    await settleSyncsForTests();
    expect(await rowsOf("message", [id])).toHaveLength(0);
  });

  it("with the switch off a send makes no vector and calls nothing; a failing service never fails a send", async () => {
    const w = await world();
    await setSwitch(w.org.id, "semanticSearch", false);
    await loginAs(w.carol.id);
    const a = await call(messagesRoute.POST, { params: { id: w.open.id }, body: { body: "طلبنا الكراتين الجديدة من المورد" } });
    await settleSyncsForTests();
    expect(a.status).toBeLessThan(300);
    expect(sentCount()).toBe(0);
    expect(await db.searchEmbedding.count({ where: { orgId: w.org.id } })).toBe(0);
    await setSwitch(w.org.id, "semanticSearch", true);
    setEmbedderForTests(async () => {
      throw new Error("down");
    });
    const b = await call(messagesRoute.POST, { params: { id: w.open.id }, body: { body: "فواتير الشهر الماضي جاهزة للمراجعة" } });
    await settleSyncsForTests();
    expect(b.status).toBeLessThan(300);
    expect(await db.searchEmbedding.count({ where: { orgId: w.org.id } })).toBe(0);
  });
});

describe("the key", () => {
  it("goes only in the Authorization header to the service: never in a body, an answer, a row or an error", async () => {
    process.env["EMBED_API_KEY"] = "sk-test-embed-key-987654";
    setEmbedderForTests(null);
    const requests: { url: string; body?: string; headers: Record<string, string> }[] = [];
    setLocalTransportForTests(async (request) => {
      requests.push({ url: request.url, ...(request.body !== undefined ? { body: request.body } : {}), headers: request.headers });
      const input = (JSON.parse(request.body as string) as { input: string[] }).input;
      return { status: 200, text: JSON.stringify({ data: input.map((t, index) => ({ index, embedding: fakeVector(t) })) }) };
    });
    const w = await world();
    const msg = await w.say(w.open.id, "طلبنا الكراتين الجديدة من المورد");
    await w.index();
    await loginAs(w.carol.id);
    enter(w.s.id);
    const res = await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent("علب التغليف")}` });
    expect((res.json as unknown as Body).messages.map((m) => m.id)).toEqual([msg.id]);
    expect(requests.length).toBeGreaterThanOrEqual(2);
    for (const r of requests) {
      expect(r.url).toBe("http://embed:8080/v1/embeddings");
      expect(r.headers["authorization"]).toBe("Bearer sk-test-embed-key-987654");
      expect(r.url).not.toContain("sk-test");
      expect(r.body ?? "").not.toContain("sk-test");
    }
    expect(res.text).not.toContain("sk-test");
    const rows = await db.searchEmbedding.findMany({ where: { orgId: w.org.id } });
    expect(JSON.stringify(rows)).not.toContain("sk-test");
    resetSemanticLimiterForTests(w.carol.id);
  });
});
