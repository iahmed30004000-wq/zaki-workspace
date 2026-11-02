import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import * as searchRoute from "@/app/api/search/route";
import * as convSearchRoute from "@/app/api/chat/conversations/[id]/search/route";
import { arabicSearch } from "@/lib/search/arabic";
import { idsMatching, sqlIn } from "@/server/search/ranked";
import { queryTasksForView } from "@/server/services/views";
import { loadWorkScope, taskVisibleWhere } from "@/server/services/team-scope";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeTask, makeUser, uid } from "./helpers";
import { makeTeamsWorld } from "./teams-helpers";

/**
 * ARABIC-TOLERANT SEARCH against a real PostgreSQL (the pattern: src/lib/search/arabic.ts; the two-step match:
 * src/server/search/ranked.ts). Two things are proven here and neither is provable in a unit test:
 *   1. the regular expression means in PostgreSQL's `~*` what it means in JavaScript — the spellings, the marks, the
 *      digits, «علي» ≠ «على», and an operator typed by a person is a letter (no SQL error, nothing matched);
 *   2. the access rules did not move: the pool of ids is only a pool, and a person never finds a task, project,
 *      message, topic or file they could not open — however the word is spelled.
 */

const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);

type Body = {
  tasks: { id: string; title: string }[];
  projects: { id: string; name: string }[];
  topics: { id: string; title: string }[];
  messages: { id: string; conversationId: string; snippet: string }[];
  people: { id: string; name: string }[];
  files: { id: string; name: string }[];
};
const search = async (q: string) => {
  const res = await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent(q)}` });
  return { status: res.status, body: res.json as unknown as Body };
};
const EMPTY = { tasks: [], projects: [], topics: [], messages: [], people: [], files: [], documents: [] };

const token = () => `zq${uid().slice(0, 7)}`;

/** The titles of the tasks of one org that match, as the database sees them (rank on, newest first). */
async function titles(orgId: string, q: string, rank = true): Promise<string[]> {
  const search = arabicSearch(q);
  if (!search) return [];
  const ids = await idsMatching({ table: "Task", search, rank, where: [sqlIn("orgId", [orgId])], order: Prisma.sql`"updatedAt" DESC`, limit: 100 });
  const rows = await db.task.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } });
  return ids.map((id) => rows.find((r) => r.id === id)!.title);
}

describe("the pattern means the same in PostgreSQL's ~* as in JavaScript", () => {
  async function world() {
    const w = await makeTeamsWorld();
    const tk = token();
    const make = (title: string) =>
      makeTask({ orgId: w.org.id, workspaceId: w.s.id, projectId: w.p0.project.id, boardId: w.p0.board.id, columnId: w.p0.todo.id, creatorId: w.owner.id, title: `${tk} ${title}` });
    return { ...w, tk, make };
  }

  it("alef: احمد / أحمد / إحمد / آحمد all find every spelling", async () => {
    const w = await world();
    await w.make("أحمد");
    await w.make("اسم");
    for (const typed of ["احمد", "أحمد", "إحمد", "آحمد", "ٱحمد"]) expect(await titles(w.org.id, `${w.tk} ${typed}`), typed).toEqual([`${w.tk} أحمد`]);
    // and a stored bare alef is found by a typed hamza
    expect(await titles(w.org.id, `${w.tk} أسم`)).toEqual([`${w.tk} اسم`]);
  });

  it("ة and ه are one letter, either way", async () => {
    const w = await world();
    await w.make("مدرسة الحي");
    await w.make("شركه النور");
    expect(await titles(w.org.id, `${w.tk} مدرسه`)).toEqual([`${w.tk} مدرسة الحي`]);
    expect(await titles(w.org.id, `${w.tk} مدرسة`)).toEqual([`${w.tk} مدرسة الحي`]);
    expect(await titles(w.org.id, `${w.tk} شركة`)).toEqual([`${w.tk} شركه النور`]);
  });

  it("«علي» and «على» are different words: neither finds the other", async () => {
    const w = await world();
    await w.make("علي هنا");
    await w.make("على الطاولة");
    expect(await titles(w.org.id, `${w.tk} علي`)).toEqual([`${w.tk} علي هنا`]);
    expect(await titles(w.org.id, `${w.tk} على`)).toEqual([`${w.tk} على الطاولة`]);
  });

  it("tashkeel and tatweel in the stored text are optional; in the query they are dropped", async () => {
    const w = await world();
    await w.make("مُحَمَّد");
    await w.make("مـحـمـد");
    await w.make("محمد");
    await w.make("محسن");
    const all = [`${w.tk} مُحَمَّد`, `${w.tk} مـحـمـد`, `${w.tk} محمد`].sort();
    expect((await titles(w.org.id, `${w.tk} محمد`)).sort()).toEqual(all);
    expect((await titles(w.org.id, `${w.tk} مُحَمَّد`)).sort()).toEqual(all);
    expect((await titles(w.org.id, `${w.tk} محـمد`)).sort()).toEqual(all);
  });

  it("Arabic-Indic, Persian and Western digits find each other", async () => {
    const w = await world();
    await w.make("فاتورة 456");
    await w.make("فاتورة ٧٨٩");
    expect(await titles(w.org.id, `${w.tk} فاتورة ٤٥٦`)).toEqual([`${w.tk} فاتورة 456`]);
    expect(await titles(w.org.id, `${w.tk} فاتورة ۴۵۶`)).toEqual([`${w.tk} فاتورة 456`]);
    expect(await titles(w.org.id, `${w.tk} فاتورة 789`)).toEqual([`${w.tk} فاتورة ٧٨٩`]);
    expect(await titles(w.org.id, `${w.tk} فاتورة 457`)).toEqual([]);
  });

  it("Latin is case-insensitive and a plain search finds what it found before", async () => {
    const w = await world();
    await w.make("Weekly REPORT");
    expect(await titles(w.org.id, `${w.tk.toUpperCase()} weekly report`)).toEqual([`${w.tk} Weekly REPORT`]);
    expect(await titles(w.org.id, `${w.tk} weekly rep`)).toEqual([`${w.tk} Weekly REPORT`]);
    expect(await titles(w.org.id, `${w.tk} reportt`)).toEqual([]);
  });

  it("a gap is any run of white space", async () => {
    const w = await world();
    await w.make("اجتماع   الفريق");
    expect(await titles(w.org.id, `${w.tk}   اجتماع الفريق`)).toEqual([`${w.tk} اجتماع   الفريق`]);
    expect(await titles(w.org.id, `${w.tk} اجتماعالفريق`)).toEqual([]);
  });

  it("what is typed is never an operator: no SQL error, nothing matched that was not typed", async () => {
    const w = await world();
    await w.make("50% خصم اليوم");
    await w.make("a_b and a.b and (x) [y] {z} a|b \\ end*");
    await w.make("plain title");
    const probes = [".*", "(", ")", "\\", "[", "]", "{", "}", "|", "^", "$", "+", "?", "a|b", "(?i)PLAIN", "***=x", "\\d+", "[a-z]+", "x{1,3}", "'; DROP TABLE \"Task\"; --", "' OR '1'='1", "%", "_", "\\1", "(a", "a)"];
    for (const q of probes) {
      // both the bare probe and one glued to the token: never an error
      await expect(titles(w.org.id, q), q).resolves.toBeInstanceOf(Array);
      await expect(titles(w.org.id, `${w.tk} ${q}`), `${w.tk} ${q}`).resolves.toBeInstanceOf(Array);
    }
    // a probe that is a wildcard elsewhere is only itself here
    expect(await titles(w.org.id, `${w.tk} .*`)).toEqual([]);
    expect(await titles(w.org.id, `${w.tk} plain|خصم`)).toEqual([]);
    expect(await titles(w.org.id, `${w.tk} (?i)PLAIN`)).toEqual([]);
    expect(await titles(w.org.id, `${w.tk} [a-z]+`)).toEqual([]);
    expect(await titles(w.org.id, `${w.tk} 50%`)).toEqual([`${w.tk} 50% خصم اليوم`]);
    expect(await titles(w.org.id, `${w.tk} 50_`)).toEqual([]);
    expect(await titles(w.org.id, `${w.tk} a_b and a.b and (x) [y] {z} a|b \\ end*`)).toHaveLength(1);
    expect(await titles(w.org.id, `${w.tk} a_b`)).toHaveLength(1);
    expect(await titles(w.org.id, `${w.tk} a.b`)).toEqual([]);
    expect(await titles(w.org.id, `${w.tk} axb`)).toEqual([]);
    // the table is still there
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBeGreaterThan(0);
  });

  it("a NUL, a lone surrogate and a 5000-character query are neither an error nor a scan of everything", async () => {
    const w = await world();
    await w.make("نص عادي");
    expect(await titles(w.org.id, `${w.tk} نص\u0000 عادي`)).toEqual([`${w.tk} نص عادي`]);
    await expect(titles(w.org.id, `${w.tk} \uD800 x`)).resolves.toEqual([]);
    await expect(titles(w.org.id, "أ".repeat(5000))).resolves.toEqual([]);
    expect(await titles(w.org.id, "   ")).toEqual([]);
  });

  it("ranking: a title that STARTS with the words comes before one that contains them, then the usual order", async () => {
    const w = await world();
    const r = token();
    const contains = await w.make("");
    await db.task.update({ where: { id: contains.id }, data: { title: `مهمة ${r} الأخيرة` } });
    const starts = await makeTask({ orgId: w.org.id, workspaceId: w.s.id, projectId: w.p0.project.id, boardId: w.p0.board.id, columnId: w.p0.todo.id, creatorId: w.owner.id, title: `${r} أولى` });
    // the one that merely contains the words is the most recently touched
    await db.task.update({ where: { id: starts.id }, data: { updatedAt: new Date(Date.now() - 3_600_000) } });
    await db.task.update({ where: { id: contains.id }, data: { updatedAt: new Date() } });
    expect(await titles(w.org.id, r, true)).toEqual([`${r} أولى`, `مهمة ${r} الأخيرة`]);
    // without the rank the old order (newest first) would have put it last
    expect(await titles(w.org.id, r, false)).toEqual([`مهمة ${r} الأخيرة`, `${r} أولى`]);
  });
});

/* ------------------------------------------------------------------ the access rules did not move */

async function accessWorld() {
  const w = await makeTeamsWorld();
  const tk = token();
  const q = `${tk} احمد`; // typed bare…
  const stored = (suffix = "") => `${tk} أحمد${suffix}`; // …stored with the hamza
  const task = (project: { project: { id: string }; board: { id: string }; todo: { id: string } }, workspaceId: string, title = stored()) =>
    makeTask({ orgId: w.org.id, workspaceId, projectId: project.project.id, boardId: project.board.id, columnId: project.todo.id, creatorId: w.owner.id, title });
  const tOpen = await task(w.p0, w.s.id);
  const tX = await task(w.px, w.s.id);
  const tY = await task(w.py, w.s.id);
  const tOther = await task(w.pt, w.other.id);
  const topic = (title: string, spaceId: string, extra: Record<string, unknown> = {}) =>
    db.conversation.create({ data: { orgId: w.org.id, kind: "TOPIC", spaceId, title, ...extra } });
  const open = await topic(`${tk} مدرسة عامة`, w.s.id);
  const ty = await topic(`${tk} مدرسة الفريق`, w.s.id, { teamId: w.y.id });
  const restricted = await topic(`${tk} مدرسة مقيّدة`, w.s.id, { restricted: true });
  const elsewhere = await topic(`${tk} مدرسة بعيدة`, w.other.id);
  const say = (conversationId: string, body: string, extra: Record<string, unknown> = {}) =>
    db.chatMessage.create({ data: { orgId: w.org.id, conversationId, authorId: w.spaceAdmin.id, body, ...extra } });
  return { ...w, tk, q, stored, tOpen, tX, tY, tOther, open, ty, restricted, elsewhere, say, topic };
}

describe("search box: the same people find the same rows, however the word is spelled", () => {
  it("tasks: a person finds the tasks they may open and none of another team's or another space's", async () => {
    const w = await accessWorld();
    enter(w.s.id);
    const ids = async (userId: string, q: string) => {
      await loginAs(userId);
      return (await search(q)).body.tasks.map((t) => t.id).sort();
    };
    // carol (no team): the space's own work only
    expect(await ids(w.carol.id, w.q)).toEqual([w.tOpen.id]);
    // alice (team X) and bob (team Y): their team's too
    expect(await ids(w.alice.id, w.q)).toEqual([w.tOpen.id, w.tX.id].sort());
    expect(await ids(w.bob.id, w.q)).toEqual([w.tOpen.id, w.tY.id].sort());
    // the space's admin and the owner manage the space: every team, never another space (each space is its own site)
    expect(await ids(w.spaceAdmin.id, w.q)).toEqual([w.tOpen.id, w.tX.id, w.tY.id].sort());
    expect(await ids(w.owner.id, w.q)).toEqual([w.tOpen.id, w.tX.id, w.tY.id].sort());
    // nobody of those finds the other space's task
    for (const u of [w.carol, w.alice, w.bob, w.spaceAdmin, w.owner]) expect(await ids(u.id, w.q)).not.toContain(w.tOther.id);
    // the exact spelling finds exactly the same rows as the loose one, for everybody
    for (const u of [w.carol, w.alice, w.bob, w.spaceAdmin, w.owner]) expect(await ids(u.id, `${w.tk} أحمد`)).toEqual(await ids(u.id, w.q));
    // somebody of no space finds nothing, however it is spelled
    const loner = await makeUser({ orgId: w.org.id, role: "MEMBER" });
    await loginAs(loner.id);
    expect((await search(w.q)).body).toEqual(EMPTY);
    // bob in the OTHER space: he finds that space's task, not this one's
    enter(w.other.id);
    await loginAs(w.bob.id);
    expect((await search(w.q)).body.tasks.map((t) => t.id)).toEqual([w.tOther.id]);
  });

  it("a pool full of tasks one may not open does not hide the one they may (the pool is read page by page)", async () => {
    const w = await accessWorld();
    // 170 NEWER tasks of team Y that carol cannot see, all matching: more than one page of the pool
    for (let i = 0; i < 170; i++) {
      await makeTask({ orgId: w.org.id, workspaceId: w.s.id, projectId: w.py.project.id, boardId: w.py.board.id, columnId: w.py.todo.id, creatorId: w.owner.id, title: `${w.tk} أحمد ${i}` });
    }
    await db.task.update({ where: { id: w.tOpen.id }, data: { updatedAt: new Date(Date.now() - 86_400_000) } });
    enter(w.s.id);
    await loginAs(w.carol.id);
    const { body } = await search(w.q);
    expect(body.tasks.map((t) => t.id)).toEqual([w.tOpen.id]);
    // …and the task list's text filter reads the same way
    const scope = await loadWorkScope(w.carol.id);
    const rows = await queryTasksForView({ orgId: w.org.id, workspaceIds: [w.s.id], visible: taskVisibleWhere(scope), search: w.q, limit: 50 });
    expect(rows.map((t) => t.id)).toEqual([w.tOpen.id]);
  }, 120_000);

  it("projects: the names are matched loosely, the teams' rule is the same", async () => {
    const w = await accessWorld();
    await db.project.update({ where: { id: w.p0.project.id }, data: { name: `${w.tk} مدرسة ١٢٣` } });
    await db.project.update({ where: { id: w.px.project.id }, data: { name: `${w.tk} مدرسة 123 فريق` } });
    enter(w.s.id);
    await loginAs(w.carol.id);
    expect((await search(`${w.tk} مدرسه 123`)).body.projects.map((p) => p.id)).toEqual([w.p0.project.id]);
    await loginAs(w.alice.id);
    expect((await search(`${w.tk} مدرسه ١٢٣`)).body.projects.map((p) => p.id).sort()).toEqual([w.p0.project.id, w.px.project.id].sort());
  });

  it("topics and messages: only the ones the person may open — another team's, a restricted one, another space's, a deleted one and a system line are never found", async () => {
    const w = await accessWorld();
    const mOpen = await w.say(w.open.id, `قال ${w.tk} أحمد إن الأمر جاهز`);
    await w.say(w.open.id, `محذوفة ${w.tk} أحمد`, { deletedAt: new Date() });
    await w.say(w.open.id, `{"k":"join","x":"${w.tk} أحمد"}`, { kind: "SYSTEM" });
    const mTy = await w.say(w.ty.id, `الفريق ${w.tk} أحمد`);
    const mRestricted = await w.say(w.restricted.id, `سرّي ${w.tk} أحمد`);
    const mElsewhere = await w.say(w.elsewhere.id, `بعيد ${w.tk} أحمد`);
    enter(w.s.id);

    await loginAs(w.carol.id);
    const carol = (await search(w.q)).body;
    expect(carol.messages.map((m) => m.id)).toEqual([mOpen.id]);
    // the snippet is centred on the word however it was typed
    expect(carol.messages[0]!.snippet).toContain("أحمد");
    const carolTopics = (await search(`${w.tk} مدرسه`)).body.topics.map((t) => t.id);
    expect(carolTopics).toEqual([w.open.id]);

    await loginAs(w.bob.id);
    const bob = (await search(w.q)).body;
    expect(bob.messages.map((m) => m.id).sort()).toEqual([mOpen.id, mTy.id].sort());
    expect(bob.messages.map((m) => m.id)).not.toContain(mRestricted.id);
    expect(bob.messages.map((m) => m.id)).not.toContain(mElsewhere.id);
    expect((await search(`${w.tk} مدرسه`)).body.topics.map((t) => t.id)).not.toContain(w.restricted.id);
    expect((await search(`${w.tk} مدرسه`)).body.topics.map((t) => t.id)).not.toContain(w.elsewhere.id);

    // for everybody: what the loose spelling finds is exactly what the exact spelling finds
    for (const u of [w.carol, w.alice, w.bob, w.spaceAdmin, w.owner]) {
      await loginAs(u.id);
      const loose = (await search(w.q)).body;
      const exact = (await search(`${w.tk} أحمد`)).body;
      expect(loose.messages.map((m) => m.id)).toEqual(exact.messages.map((m) => m.id));
      expect((await search(`${w.tk} مدرسه`)).body.topics.map((t) => t.id)).toEqual((await search(`${w.tk} مدرسة`)).body.topics.map((t) => t.id));
    }
  });

  it("an archived topic is not offered by its name, spelled however", async () => {
    const w = await accessWorld();
    await db.conversation.update({ where: { id: w.open.id }, data: { archivedAt: new Date(), closedAt: new Date() } });
    enter(w.s.id);
    await loginAs(w.carol.id);
    expect((await search(`${w.tk} مدرسه`)).body.topics).toEqual([]);
  });

  it("topics: a title that starts with the words comes first", async () => {
    const w = await accessWorld();
    const r = token();
    await w.topic(`عن ${r} مدرسة`, w.s.id, { position: 0 });
    const first = await w.topic(`${r} مدرسة`, w.s.id, { position: 5 });
    enter(w.s.id);
    await loginAs(w.carol.id);
    const topics = (await search(`${r} مدرسه`)).body.topics;
    expect(topics[0]!.id).toBe(first.id);
    expect(topics).toHaveLength(2);
  });

  it("people: the people of this space, found by their spelling; nobody of another space; a guest gets no directory", async () => {
    const w = await accessWorld();
    const mine = await makeUser({ orgId: w.org.id, role: "MEMBER", name: `أحمد ${w.tk}` });
    await db.workspaceMember.create({ data: { workspaceId: w.s.id, userId: mine.id, role: "MEMBER" } });
    const stranger = await makeUser({ orgId: w.org.id, role: "MEMBER", name: `احمد ${w.tk} غريب` });
    const suspended = await makeUser({ orgId: w.org.id, role: "MEMBER", name: `أحمد ${w.tk} موقوف` });
    await db.workspaceMember.create({ data: { workspaceId: w.s.id, userId: suspended.id, role: "MEMBER" } });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: suspended.id } }, data: { status: "SUSPENDED" } });
    enter(w.s.id);
    await loginAs(w.carol.id);
    const found = (await search(`احمد ${w.tk}`)).body.people.map((p) => p.id);
    expect(found).toEqual([mine.id]);
    expect(found).not.toContain(stranger.id);
    expect(found).not.toContain(suspended.id);

    const guest = await makeUser({ orgId: w.org.id, role: "GUEST", name: `Guest ${uid()}` });
    await db.workspaceMember.create({ data: { workspaceId: w.s.id, userId: guest.id, role: "GUEST" } });
    await loginAs(guest.id);
    expect((await search(`احمد ${w.tk}`)).body.people).toEqual([]);
  });

  it("files: this space's library by the spelling of the name; a guest, another space and a half-written row are never found", async () => {
    const w = await accessWorld();
    const file = (name: string, workspaceId: string | null, extra: Record<string, unknown> = {}) =>
      db.storedFile.create({
        data: { orgId: w.org.id, uploaderId: w.spaceAdmin.id, familyId: `f_${uid()}`, name, mimeType: "text/plain", size: 1, path: `p_${uid()}`, purpose: "LIBRARY", workspaceId, ...extra },
      });
    const here = await file(`${w.tk} فاتورة المدرسة ١٢٣.txt`, w.s.id);
    await file(`${w.tk} فاتورة المدرسة 123 بعيدة.txt`, w.other.id);
    await file(`${w.tk} فاتورة المدرسة 123 محذوفة.txt`, w.s.id, { deletedAt: new Date() });
    await file(`${w.tk} فاتورة المدرسة 123 نصف مكتوبة.txt`, w.s.id, { path: "pending" });
    await file(`${w.tk} فاتورة المدرسة 123 مرفق.txt`, w.s.id, { purpose: "CHAT" });
    enter(w.s.id);
    await loginAs(w.carol.id);
    expect((await search(`${w.tk} فاتوره المدرسه 123`)).body.files.map((f) => f.id)).toEqual([here.id]);

    const guest = await makeUser({ orgId: w.org.id, role: "GUEST", name: `Guest ${uid()}` });
    await db.workspaceMember.create({ data: { workspaceId: w.s.id, userId: guest.id, role: "GUEST" } });
    await loginAs(guest.id);
    expect((await search(`${w.tk} فاتوره المدرسه 123`)).body.files).toEqual([]);
  });

  it("injection strings, one character, spaces and a very long query: a clean answer, never an error, never another space's row", async () => {
    const w = await accessWorld();
    enter(w.s.id);
    await loginAs(w.carol.id);
    for (const q of [".*", "(", ")", "\\", "%", "_", "[", "]", "a|b", "(?i)أحمد", "' OR 1=1 --", "'; DROP TABLE \"Task\"; --", "\u0000\u0000", "أ", "  ", "ـ", "%%", "x".repeat(500), "أ".repeat(500)]) {
      const r = await search(q);
      expect(r.status, q).toBe(200);
      expect(r.body, q).toEqual(EMPTY);
    }
    // a 500-character query that BEGINS like a real one is cut at 100 characters, not rejected
    expect((await search(`${w.tk} احمد`)).body.tasks).toHaveLength(1);
    expect((await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent(`${w.tk} احمد ${"س".repeat(500)}`)}` })).status).toBe(200);
    // the data is all still there
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBeGreaterThan(3);
  });
});

describe("search inside one conversation", () => {
  it("finds the messages by their spelling, never a deleted one, a system line or another conversation's; an unreadable one is «not found»", async () => {
    const w = await accessWorld();
    const hit = await w.say(w.open.id, `قال ${w.tk} أحمد`);
    await w.say(w.open.id, `محذوفة ${w.tk} أحمد`, { deletedAt: new Date() });
    await w.say(w.open.id, `{"k":"join","x":"${w.tk} أحمد"}`, { kind: "SYSTEM" });
    await w.say(w.ty.id, `الفريق ${w.tk} أحمد`);
    await loginAs(w.carol.id);
    const mine = await call(convSearchRoute.GET, { url: `http://localhost/x?q=${encodeURIComponent(w.q)}`, params: { id: w.open.id } });
    expect(mine.status).toBe(200);
    expect((mine.json as { hits: { id: string; snippet: string }[] }).hits.map((h) => h.id)).toEqual([hit.id]);
    expect((mine.json as { hits: { snippet: string }[] }).hits[0]!.snippet).toContain("أحمد");
    // team Y's topic: carol cannot open it, so the search says «not found» whatever she types
    for (const q of [w.q, `${w.tk} أحمد`]) {
      expect((await call(convSearchRoute.GET, { url: `http://localhost/x?q=${encodeURIComponent(q)}`, params: { id: w.ty.id } })).status).toBe(404);
    }
    expect((await call(convSearchRoute.GET, { url: `http://localhost/x?q=${encodeURIComponent(w.q)}`, params: { id: w.restricted.id } })).status).toBe(404);
    // operators typed in a conversation are letters
    for (const q of [".*", "(", "\\", "%", "_", "["]) {
      const r = await call(convSearchRoute.GET, { url: `http://localhost/x?q=${encodeURIComponent(q)}`, params: { id: w.open.id } });
      expect(r.status, q).toBe(200);
      expect((r.json as { hits: unknown[] }).hits).toEqual([]);
    }
  });
});

describe("the task list's text filter", () => {
  it("is spelling-tolerant, keeps the list's own order (due date, then newest) and every access rule", async () => {
    const w = await accessWorld();
    const mk = (title: string, dueDate: Date | null) =>
      makeTask({ orgId: w.org.id, workspaceId: w.s.id, projectId: w.p0.project.id, boardId: w.p0.board.id, columnId: w.p0.todo.id, creatorId: w.owner.id, title, dueDate });
    const day = (n: number) => new Date(Date.UTC(2031, 0, n, 12));
    const late = await mk(`${w.tk} مدرسة متأخرة`, day(20));
    const soon = await mk(`${w.tk} مدرسة قريبة`, day(2));
    const none = await mk(`${w.tk} مدرسة بلا موعد`, null);
    await mk(`${w.tk} شيء آخر`, day(1));
    const scope = await loadWorkScope(w.carol.id);
    const rows = await queryTasksForView({ orgId: w.org.id, workspaceIds: [w.s.id], visible: taskVisibleWhere(scope), search: `${w.tk} مدرسه` });
    expect(rows.map((t) => t.id)).toEqual([soon.id, late.id, none.id]);
    // a plain Latin search is what it was
    const latin = await queryTasksForView({ orgId: w.org.id, workspaceIds: [w.s.id], visible: taskVisibleWhere(scope), search: w.tk.toUpperCase() });
    expect(latin.length).toBeGreaterThanOrEqual(4);
    // the workspace allow-list still wins: another space's allow-list finds none of this space's tasks
    const elsewhere = await queryTasksForView({ orgId: w.org.id, workspaceIds: [w.other.id], visible: taskVisibleWhere(scope), search: w.tk });
    expect(elsewhere).toEqual([]);
    // team Y's task is not carol's even though it matches; it is bob's
    const bobScope = await loadWorkScope(w.bob.id);
    expect((await queryTasksForView({ orgId: w.org.id, workspaceIds: [w.s.id], visible: taskVisibleWhere(scope), search: w.q })).map((t) => t.id)).toEqual([w.tOpen.id]);
    expect((await queryTasksForView({ orgId: w.org.id, workspaceIds: [w.s.id], visible: taskVisibleWhere(bobScope), search: w.q })).map((t) => t.id).sort()).toEqual([w.tOpen.id, w.tY.id].sort());
    // nothing typed, or only operators: no error
    await expect(queryTasksForView({ orgId: w.org.id, workspaceIds: [w.s.id], visible: taskVisibleWhere(scope), search: ".*(" })).resolves.toEqual([]);
    await expect(queryTasksForView({ orgId: w.org.id, workspaceIds: [w.s.id], visible: taskVisibleWhere(scope), search: "   " })).resolves.toBeInstanceOf(Array);
  });
});
