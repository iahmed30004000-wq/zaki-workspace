import { describe, expect, it } from "vitest";
import { getWorkTasks } from "@/server/services/my-work";
import { DEFAULT_MY_TASKS_PARAMS, parseMyTasksParams, type MyTasksParams } from "@/lib/work/my-tasks";
import * as filtersRoute from "@/app/api/me/task-filters/route";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeWorkspace } from "./helpers";

/**
 * «مهامي» filters (the owner, 2026-11-25): by project, «فوري», status, due, and by person for those who manage. They combine, they show counts, one tap clears
 * them, and each person's choice is kept.
 */
const NOW = new Date("2026-11-25T09:00:00Z"); // 12:00 in Damascus

async function world() {
  const team = await makeTeam();
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }, { userId: team.admin.id, role: "ADMIN" }], "العمل");
  const alpha = await makeProject(ws.id, "ألفا");
  const beta = await makeProject(ws.id, "بيتا");
  const put = (p: typeof alpha, title: string, over: Partial<Parameters<typeof makeTask>[0]> = {}) =>
    makeTask({ orgId: team.org.id, workspaceId: ws.id, projectId: p.project.id, boardId: p.board.id, columnId: p.todo.id, creatorId: team.owner.id, assigneeId: team.member.id, title, ...over });
  const a1 = await put(alpha, "ألفا فورية متأخرة", { priority: "URGENT", dueDate: new Date("2026-11-20T09:00:00Z") });
  const a2 = await put(alpha, "ألفا عادية", { dueDate: null });
  const b1 = await put(beta, "بيتا فورية", { priority: "URGENT", dueDate: null });
  const boss = await put(beta, "للمشرف", { assigneeId: team.admin.id, dueDate: null });
  const read = (userId: string, over: Partial<MyTasksParams> = {}) =>
    getWorkTasks(userId, { ...DEFAULT_MY_TASKS_PARAMS, ...over }, { now: NOW, current: { id: ws.id, kind: "STANDARD" } });
  const ids = (r: Awaited<ReturnType<typeof read>>) => r.tasks.map((t) => t.id).sort();
  return { team, ws, alpha, beta, a1, a2, b1, boss, read, ids };
}

describe("the filters combine and say their numbers", () => {
  it("project, «فوري» and a due chip narrow together; every number is the length of the list its press would give", async () => {
    const w = await world();
    const me = w.team.member.id;
    expect(w.ids(await w.read(me, { inProject: w.alpha.project.id }))).toEqual([w.a1.id, w.a2.id].sort());
    expect(w.ids(await w.read(me, { urgent: true }))).toEqual([w.a1.id, w.b1.id].sort());
    expect(w.ids(await w.read(me, { urgent: true, inProject: w.alpha.project.id, chip: "overdue" }))).toEqual([w.a1.id]);
    expect(w.ids(await w.read(me, { urgent: true, inProject: w.beta.project.id, chip: "overdue" }))).toEqual([]);

    const narrowed = await w.read(me, { inProject: w.alpha.project.id });
    // the chips are counted INSIDE the other filters
    expect(narrowed.counts.overdue).toBe(1);
    expect(narrowed.counts.nodate).toBe(1);
    expect(narrowed.filters.urgent).toBe(1);
    // a project's number ignores the project filter itself, so another one can be picked
    expect(Object.fromEntries(narrowed.filters.projects.map((p) => [p.id, p.count]))).toEqual({ [w.alpha.project.id]: 2, [w.beta.project.id]: 1 });
    // a column's stage is «قيد الشغل» unless the board says otherwise
    expect(narrowed.filters.stages.DOING).toBe(2);
    expect(narrowed.filters.stages.TODO).toBe(0);
  });

  it("by person: the space's manager narrows «المساحة» to one person; a plain member is offered no such filter and sending it changes nothing", async () => {
    const w = await world();
    const admin = await w.read(w.team.admin.id, { scope: "space", who: w.team.member.id });
    expect(w.ids(admin)).toEqual([w.a1.id, w.a2.id, w.b1.id].sort());
    const people = Object.fromEntries((admin.filters.people ?? []).map((p) => [p.id, p.count]));
    expect(people[w.team.member.id]).toBe(3);
    expect(people[w.team.admin.id]).toBe(1);

    const member = await w.read(w.team.member.id, { scope: "space", who: w.team.admin.id });
    expect(member.filters.people).toBeNull();
    expect(w.ids(member)).toEqual([w.a1.id, w.a2.id, w.b1.id, w.boss.id].sort());
  });

  it("the address carries them and reads them back", () => {
    const params = parseMyTasksParams(new URLSearchParams("in=p1&urgent=1&who=u1&stage=DOING&chip=overdue"));
    expect(params).toMatchObject({ inProject: "p1", urgent: true, who: "u1", stage: "DOING", chip: "overdue" });
    expect(parseMyTasksParams(new URLSearchParams("urgent=yes")).urgent).toBe(false);
  });
});

describe("each person's choice is kept", () => {
  it("saves only the filter words, for the one who asks; a broken body is refused", async () => {
    const w = await world();
    await loginAs(w.team.member.id);
    const saved = await call(filtersRoute.PUT, { method: "PUT", body: { chip: "overdue", stage: null, inProject: w.alpha.project.id, urgent: true, who: null, sort: "priority" } });
    expect(saved.status).toBe(200);
    const mine = await db.user.findUniqueOrThrow({ where: { id: w.team.member.id }, select: { taskFilters: true } });
    expect(mine.taskFilters).toEqual({ chip: "overdue", stage: null, inProject: w.alpha.project.id, urgent: true, who: null, sort: "priority" });
    const other = await db.user.findUniqueOrThrow({ where: { id: w.team.admin.id }, select: { taskFilters: true } });
    expect(other.taskFilters).toBeNull();

    const bad = await call(filtersRoute.PUT, { method: "PUT", body: { chip: "everything", urgent: "yes" } });
    expect(bad.status).toBe(422);
    const extra = await call(filtersRoute.PUT, { method: "PUT", body: { urgent: false, taskId: "x" } });
    expect(extra.status).toBe(422);
  });
});
