import { afterEach, describe, expect, it } from "vitest";
import * as bulkRoute from "@/app/api/tasks/bulk-assign/route";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * «نقل أو فكّ المهام المفتوحة»: when somebody leaves, their OPEN cards (not archived, not completed, not in a finished column) are listed and handed to another person, or
 * unassigned, in one action. Every card goes through the very route that edits a task (`PATCH /api/tasks/:id`), so the rank rule, the space rule, the team rule and the
 * bell are the ones that already exist; the bulk route only decides WHICH cards and reports what happened to each.
 */
const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;
afterEach(() => jar().delete(SPACE_COOKIE));

async function world() {
  const t = await makeTeam();
  const org = t.org.id;
  const alice = await makeUser({ orgId: org, role: "MEMBER", name: "Alice" });
  const bob = await makeUser({ orgId: org, role: "MEMBER", name: "Bob" });
  const carol = await makeUser({ orgId: org, role: "MEMBER", name: "Carol" });
  const space = await makeWorkspace(org, [{ userId: t.admin.id, role: "ADMIN" }, { userId: alice.id }, { userId: bob.id }, { userId: carol.id }], "الشغل");
  const other = await makeWorkspace(org, [{ userId: alice.id }, { userId: bob.id }], "تانية");
  const a = await makeProject(space.id);
  const b = await makeProject(other.id);
  const task = (p: typeof a, spaceId: string, columnId: string, assigneeId: string | null, title: string, extra: { completedAt?: Date | null } = {}) =>
    makeTask({ orgId: org, workspaceId: spaceId, projectId: p.project.id, boardId: p.board.id, columnId, creatorId: t.owner.id, assigneeId, title, ...extra });

  const open1 = await task(a, space.id, a.todo.id, alice.id, "مفتوحة 1");
  const open2 = await task(a, space.id, a.todo.id, bob.id, "مفتوحة 2 (alice معه)");
  await db.taskCoAssignee.create({ data: { taskId: open2.id, userId: alice.id } });
  const both = await task(a, space.id, a.todo.id, carol.id, "carol و alice");
  await db.taskCoAssignee.create({ data: { taskId: both.id, userId: alice.id } });
  const done = await task(a, space.id, a.done.id, alice.id, "بعمود منتهي");
  const completed = await task(a, space.id, a.todo.id, alice.id, "مكتملة", { completedAt: new Date() });
  const archived = await task(a, space.id, a.todo.id, alice.id, "مؤرشفة");
  await db.task.update({ where: { id: archived.id }, data: { archived: true } });
  const elsewhere = await task(b, other.id, b.todo.id, alice.id, "بمساحة تانية");
  return { ...t, alice, bob, carol, space, other, open1, open2, both, done, completed, archived, elsewhere };
}
type World = Awaited<ReturnType<typeof world>>;

const list = (from: string, extra = "") => call(bulkRoute.GET, { url: `http://localhost/api/tasks/bulk-assign?from=${from}${extra}`, method: "GET" });
const bulk = (body: Record<string, unknown>) => call(bulkRoute.POST, { url: "http://localhost/api/tasks/bulk-assign", body });
const holders = async (taskId: string) => {
  const t = await db.task.findUniqueOrThrow({ where: { id: taskId }, include: { coAssignees: true } });
  return { primary: t.assigneeId, co: t.coAssignees.map((c) => c.userId).sort() };
};
type Result = { moved: string[]; requested: string[]; skipped: Array<{ id: string; reason: string }> };

describe("listing the open cards of a person", () => {
  it("lists exactly the open cards they hold (first or beside), not the finished, completed or archived ones", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const r = await list(w.alice.id);
    expect(r.status, r.text).toBe(200);
    const body = r.json as { count: number; tasks: Array<{ id: string; title: string; workspaceId: string }> };
    expect(body.tasks.map((x) => x.id).sort()).toEqual([w.open1.id, w.open2.id, w.both.id, w.elsewhere.id].sort());
    expect(body.count).toBe(4);
    expect(body.tasks.find((x) => x.id === w.open1.id)?.title).toBe("مفتوحة 1");
  });

  it("a space admin sees only the cards of the spaces they manage; a plain member is refused (403)", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const ids = ((await list(w.alice.id)).json as { tasks: Array<{ id: string }> }).tasks.map((x) => x.id);
    expect(ids).not.toContain(w.elsewhere.id);
    expect(ids).toContain(w.open1.id);
    await loginAs(w.member.id);
    expect((await list(w.alice.id)).status).toBe(403);
  });
});

describe("unassigning", () => {
  it("`to: null` takes the person off every open card (first and beside) and touches nothing else", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const r = await bulk({ from: w.alice.id, to: null });
    expect(r.status, r.text).toBe(200);
    const out = r.json as Result;
    expect(out.moved.sort()).toEqual([w.open1.id, w.open2.id, w.both.id, w.elsewhere.id].sort());
    expect(await holders(w.open1.id)).toEqual({ primary: null, co: [] });
    expect(await holders(w.open2.id)).toEqual({ primary: w.bob.id, co: [] });
    expect(await holders(w.both.id)).toEqual({ primary: w.carol.id, co: [] });
    // the ones that are not open keep their person
    for (const t of [w.done, w.completed, w.archived]) expect((await holders(t.id)).primary).toBe(w.alice.id);
  });
});

describe("reassigning", () => {
  it("hands each open card to the other person: first stays first, beside stays beside, nobody is listed twice", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const r = await bulk({ from: w.alice.id, to: w.carol.id });
    expect(r.status, r.text).toBe(200);
    // a person of another space cannot take a card of that space: «بمساحة تانية» is skipped, the rest move
    const out = r.json as Result;
    expect(out.skipped.map((s) => s.id)).toEqual([w.elsewhere.id]);
    expect(out.skipped[0]?.reason).toBe("assign.target_not_in_space");
    expect(await holders(w.open1.id)).toEqual({ primary: w.carol.id, co: [] });
    expect(await holders(w.open2.id)).toEqual({ primary: w.bob.id, co: [w.carol.id] });
    expect(await holders(w.both.id)).toEqual({ primary: w.carol.id, co: [] });
    // the skipped card is exactly as it was
    expect((await holders(w.elsewhere.id)).primary).toBe(w.alice.id);
    expect(await db.notification.count({ where: { userId: w.carol.id, type: "task_assigned" } })).toBeGreaterThan(0);
  });

  it("`taskIds` narrows it to the cards named (and only open ones of the person)", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const r = await bulk({ from: w.alice.id, to: w.bob.id, taskIds: [w.open1.id, w.done.id] });
    expect(r.status, r.text).toBe(200);
    expect((r.json as Result).moved).toEqual([w.open1.id]);
    expect((await holders(w.open1.id)).primary).toBe(w.bob.id);
    expect((await holders(w.done.id)).primary).toBe(w.alice.id);
    expect((await holders(w.open2.id)).co).toEqual([w.alice.id]);
  });

  it("a higher rank is ASKED, not given: the card keeps its person and the answer says `requested`", async () => {
    const w = await world();
    await loginAs(w.admin.id); // a space ADMIN gives to the OWNER: a request, by the rank rule
    const r = await bulk({ from: w.alice.id, to: w.owner.id });
    expect(r.status, r.text).toBe(200);
    const out = r.json as Result;
    expect(out.requested).toContain(w.open1.id);
    expect((await holders(w.open1.id)).primary).toBe(w.alice.id);
    expect(await db.taskAssignRequest.count({ where: { taskId: w.open1.id } })).toBe(1);
  });
});

describe("who may, and what is refused", () => {
  it("a plain member cannot (403) and nothing changes", async () => {
    const w = await world();
    await loginAs(w.member.id);
    expect((await bulk({ from: w.alice.id, to: null })).status).toBe(403);
    expect((await holders(w.open1.id)).primary).toBe(w.alice.id);
  });

  it("a space admin moves only the cards of their own spaces: the other space's card is skipped as forbidden", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    const r = await bulk({ from: w.alice.id, to: null });
    expect(r.status, r.text).toBe(200);
    const out = r.json as Result;
    expect(out.moved).not.toContain(w.elsewhere.id);
    expect(out.skipped.find((s) => s.id === w.elsewhere.id)).toBeUndefined(); // never even listed to them
    expect((await holders(w.elsewhere.id)).primary).toBe(w.alice.id);
    expect((await holders(w.open1.id)).primary).toBeNull();
  });

  it("`from` and `to` the same person, or a missing `from`, are 422; a person of another company is not found", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await bulk({ from: w.alice.id, to: w.alice.id })).status).toBe(422);
    expect((await bulk({ to: null })).status).toBe(422);
    const stranger = await makeTeam();
    expect((await bulk({ from: stranger.member.id, to: null })).status).toBe(404);
  });

  it("writes one audit row with the counts, under the person who did it", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    await bulk({ from: w.alice.id, to: null });
    const row = await db.auditLog.findFirst({ where: { action: "task.bulk_assign", orgId: w.org.id } });
    expect(row?.actorId).toBe(w.owner.id);
    expect(row?.target).toBe(w.alice.id);
    expect((row?.meta as { moved: number }).moved).toBe(4);
  });
});

export type { World };
