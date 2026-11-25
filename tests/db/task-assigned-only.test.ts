/**
 * «كل واحد بيشوف مهامه بس» (`assignedTasksOnly`) — ask 4 of the owner's tasks prompt (2026-11-25). His choice: a task is seen by
 * the people it is ASSIGNED to and by the company's owner and admins, nobody else: not whoever made it, not the space's
 * supervisor. And the projects a person sees are the ones where they hold a task. Enforced by the API: 403.
 * OFF (the default) nothing changes.
 */
import { describe, expect, it } from "vitest";
import * as inboxRoute from "@/app/api/instant/inbox/route";
import * as boardRoute from "@/app/api/boards/[id]/route";
import * as projectBoardsRoute from "@/app/api/projects/[id]/boards/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as searchRoute from "@/app/api/search/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as taskCommentsRoute from "@/app/api/tasks/[id]/comments/route";
import * as taskCompleteRoute from "@/app/api/tasks/[id]/complete/route";
import * as tasksRoute from "@/app/api/tasks/route";
import { DEFAULT_MY_TASKS_PARAMS } from "@/lib/work/my-tasks";
import { listOpenTasks } from "@/server/services/bulk-assign";
import { getWorkTasks } from "@/server/services/my-work";
import { userCanReadTask } from "@/server/services/reminders";
import { loadWorkScope, taskVisibleSql } from "@/server/services/team-scope";
import { answerAssignRequest } from "@/server/services/task-assign";
import { createTask } from "@/server/services/tasks";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

async function world(opts: { on?: boolean } = {}) {
  const team = await makeTeam();
  const orgId = team.org.id;
  if (opts.on ?? true) await db.organization.update({ where: { id: orgId }, data: { settings: { features: { assignedTasksOnly: true } } } });
  const mk = (name: string, role: "MEMBER" | "LEAD" = "MEMBER") => makeUser({ orgId, role, name });
  const [worker, other, supervisor, lead] = await Promise.all([mk("Worker"), mk("Other"), mk("Supervisor"), mk("Lead", "LEAD")]);
  const space = await makeWorkspace(orgId, [{ userId: worker.id }, { userId: other.id }, { userId: lead.id }, { userId: supervisor.id, role: "ADMIN" }, { userId: team.admin.id, role: "MEMBER" }], "العمل");
  const alpha = await makeProject(space.id, "ألفا");
  const beta = await makeProject(space.id, "بيتا");
  const put = (p: typeof alpha, title: string, over: Partial<Parameters<typeof makeTask>[0]> = {}) =>
    makeTask({ orgId, workspaceId: space.id, projectId: p.project.id, boardId: p.board.id, columnId: p.todo.id, creatorId: supervisor.id, assigneeId: other.id, title, ...over });
  const mine = await put(alpha, "كرتون إلي", { assigneeId: worker.id });
  const beside = await put(alpha, "كرتون مشترك");
  await db.taskCoAssignee.create({ data: { taskId: beside.id, userId: worker.id } });
  // made by the worker for somebody else: the owner chose that making it is not enough
  const made = await put(alpha, "كرتون عملتها لغيري", { creatorId: worker.id });
  const nobody = await put(alpha, "كرتون بلا مسؤول", { assigneeId: null });
  const elsewhere = await put(beta, "كرتون بمشروع تاني");
  const secret = await put(alpha, "كرتون خاصة");
  await db.task.update({ where: { id: secret.id }, data: { visibility: "PARTICIPANTS" } });
  const all = [mine, beside, made, nobody, elsewhere, secret].map((t) => t.id).sort();
  return { ...team, orgId, worker, other, supervisor, lead, space, alpha, beta, mine, beside, made, nobody, elsewhere, secret, all };
}
type World = Awaited<ReturnType<typeof world>>;

const status = async (id: string) => (await call(taskRoute.GET, { params: { id } })).status;
const listIds = async (w: World) =>
  (((await call(tasksRoute.GET, { url: `http://localhost/api/tasks?workspaceId=${w.space.id}` })).json?.["tasks"] as Array<{ id: string }> | undefined) ?? []).map((t) => t.id).sort();
const projectIds = async (w: World) =>
  (((await call(projectsRoute.GET, { url: `http://localhost/api/projects?workspaceId=${w.space.id}` })).json?.["projects"] as Array<{ id: string }> | undefined) ?? []).map((p) => p.id).sort();
const myWork = (userId: string, w: World) => getWorkTasks(userId, { ...DEFAULT_MY_TASKS_PARAMS, scope: "space" }, { current: { id: w.space.id, kind: "STANDARD" } });

describe("the switch is off: nothing changes", () => {
  it("a member of the space still reads every public task and project", async () => {
    const w = await world({ on: false });
    await loginAs(w.worker.id);
    expect(await status(w.elsewhere.id)).toBe(200);
    expect(await listIds(w)).toEqual(w.all.filter((id) => id !== w.secret.id));
    expect(await projectIds(w)).toEqual([w.alpha.project.id, w.beta.project.id].sort());
  });
});

describe("the switch is on", () => {
  it("a member reads only what is assigned to them: another person's task answers 403, even one they made", async () => {
    const w = await world();
    await loginAs(w.worker.id);
    expect(await status(w.mine.id)).toBe(200);
    expect(await status(w.beside.id)).toBe(200);
    for (const t of [w.made, w.nobody, w.elsewhere]) {
      expect(await status(t.id), t.title).toBe(403);
      expect((await call(taskCommentsRoute.GET, { params: { id: t.id } })).status, "comments").toBe(403);
      expect((await call(taskCommentsRoute.POST, { method: "POST", params: { id: t.id }, body: { body: "تطفّل" } })).status, "write a comment").toBe(403);
      expect((await call(taskCompleteRoute.POST, { method: "POST", params: { id: t.id }, body: { complete: true } })).status, "finish").toBe(403);
      expect((await call(taskRoute.PATCH, { method: "PATCH", params: { id: t.id }, body: { title: "غيّرتها" } })).status, "edit").toBe(403);
    }
    // a private task stays what it was: it does not exist
    expect(await status(w.secret.id)).toBe(404);
    expect(await db.taskComment.count({ where: { taskId: { in: [w.made.id, w.nobody.id, w.elsewhere.id] } } })).toBe(0);
    expect((await db.task.findUniqueOrThrow({ where: { id: w.made.id } })).title).toBe("كرتون عملتها لغيري");
  });

  it("every list and number holds only their own: the space's list, the board, «مهامي», the search and a raw query", async () => {
    const w = await world();
    await loginAs(w.worker.id);
    const own = [w.mine.id, w.beside.id].sort();
    expect(await listIds(w)).toEqual(own);
    const board = await call(boardRoute.GET, { params: { id: w.alpha.board.id } });
    expect((board.json?.["tasks"] as Array<{ id: string }>).map((t) => t.id).sort()).toEqual(own);
    const work = await myWork(w.worker.id, w);
    expect(work.tasks.map((t) => t.id).sort()).toEqual(own);
    const found = await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent("كرتون")}` });
    for (const t of [w.made, w.nobody, w.elsewhere, w.secret]) expect(found.text, t.title).not.toContain(t.title);
    expect(found.text).toContain(w.mine.title);
    const scope = await loadWorkScope(w.worker.id);
    const rows = await db.$queryRaw<{ id: string }[]>`SELECT t."id" FROM "Task" t WHERE t."workspaceId" = ${w.space.id} AND ${taskVisibleSql(scope, "t")}`;
    expect(rows.map((r) => r.id).sort()).toEqual(own);
    expect(await userCanReadTask(w.worker.id, w.orgId, w.made.id)).toBe(false);
  });

  it("the space's supervisor is not the administration: only their own; nor is a list of a person's open work open to them", async () => {
    const w = await world();
    await loginAs(w.supervisor.id);
    expect(await status(w.mine.id)).toBe(403);
    expect(await listIds(w)).toEqual([]);
    const work = await myWork(w.supervisor.id, w);
    expect(work.tasks).toEqual([]);
    expect(work.filters.people).toBeNull();
    const held = await listOpenTasks({ orgId: w.orgId, userId: w.supervisor.id, orgRole: "MEMBER" }, w.other.id);
    expect(held).toEqual([]);
  });

  it("the company's owner and admins see everything, as before", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    for (const id of [w.mine.id, w.made.id, w.nobody.id, w.elsewhere.id]) expect(await status(id)).toBe(200);
    // an admin of the company who is in the space manages it: the private one too, as before this switch
    expect(await listIds(w)).toEqual(w.all);
    expect(await projectIds(w)).toEqual([w.alpha.project.id, w.beta.project.id].sort());
    await loginAs(w.owner.id);
    expect(await status(w.elsewhere.id)).toBe(200);
    expect(await projectIds(w)).toEqual([w.alpha.project.id, w.beta.project.id].sort());
  });

  it("projects: only those where they hold a task, and the others refuse by their address too", async () => {
    const w = await world();
    await loginAs(w.worker.id);
    expect(await projectIds(w)).toEqual([w.alpha.project.id]);
    expect((await call(projectBoardsRoute.GET, { params: { id: w.beta.project.id } })).status).toBe(403);
    expect((await call(boardRoute.GET, { params: { id: w.beta.board.id } })).status).toBe(403);
    expect((await call(projectBoardsRoute.GET, { params: { id: w.alpha.project.id } })).status).toBe(200);
    const work = await myWork(w.worker.id, w);
    expect(work.filters.projects.map((p) => p.id)).toEqual([w.alpha.project.id]);
  });

  it("the person asked to take a task opens it to answer, and keeps it once they accept", async () => {
    const w = await world();
    // a member gives a task to somebody ABOVE them: it waits for that person's answer
    const made = await createTask({ userId: w.worker.id, orgId: w.orgId }, { workspaceId: w.space.id, projectId: w.alpha.project.id, boardId: w.alpha.board.id, title: "طلب للقائد", assigneeId: w.lead.id });
    expect(made.assignRequest?.toUserId).toBe(w.lead.id);
    await loginAs(w.lead.id);
    expect(await status(made.id)).toBe(200);
    expect(await listIds(w)).toEqual([made.id]);
    await answerAssignRequest({ userId: w.lead.id, orgId: w.orgId }, made.id, { accept: true });
    expect(await status(made.id)).toBe(200);
  });

  it("a task a member makes with nobody named is theirs, so it does not vanish from under them; an admin's stays unassigned", async () => {
    const w = await world();
    const base = { workspaceId: w.space.id, projectId: w.alpha.project.id, boardId: w.alpha.board.id };
    const mine = await createTask({ userId: w.worker.id, orgId: w.orgId }, { ...base, title: "إلي أنا" });
    expect(mine.assigneeId).toBe(w.worker.id);
    const theirs = await createTask({ userId: w.admin.id, orgId: w.orgId }, { ...base, title: "للإدارة" });
    expect(theirs.assigneeId).toBeNull();
  });

  it("somebody new, who holds nothing and so sees no project, can still add a quick task and keeps it", async () => {
    const w = await world();
    await db.organization.update({ where: { id: w.orgId }, data: { settings: { features: { assignedTasksOnly: true, workInbox: true } } } });
    const fresh = await makeUser({ orgId: w.orgId, role: "MEMBER", name: "Fresh" });
    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: fresh.id, role: "MEMBER" } });
    await loginAs(fresh.id);
    expect(await projectIds(w)).toEqual([]);
    const added = await call(inboxRoute.POST, { method: "POST", body: { title: "أول مهمة إلي", spaceId: w.space.id } });
    expect(added.status).toBe(201);
    const id = (added.json?.["task"] as { id: string }).id;
    expect(await status(id)).toBe(200);
    expect(await listIds(w)).toEqual([id]);
    expect((await projectIds(w)).length).toBe(1);
  });

  it("a comment's words are not sent to somebody who may not open the task (its maker included)", async () => {
    const w = await world();
    await loginAs(w.other.id);
    expect((await call(taskCommentsRoute.POST, { method: "POST", params: { id: w.made.id }, body: { body: "سر التعليق" } })).status).toBe(201);
    expect(await db.notification.count({ where: { userId: w.worker.id, taskId: w.made.id } })).toBe(0);
    // the assignee still hears about a colleague's comment
    await loginAs(w.admin.id);
    await call(taskCommentsRoute.POST, { method: "POST", params: { id: w.made.id }, body: { body: "من الإدارة" } });
    expect(await db.notification.count({ where: { userId: w.other.id, taskId: w.made.id } })).toBe(1);
  });

  it("the tasks a task waits for are named only when the reader may open them", async () => {
    const w = await world();
    await db.taskDependency.create({ data: { taskId: w.mine.id, dependsOnId: w.elsewhere.id } });
    await loginAs(w.worker.id);
    const res = await call(taskRoute.GET, { params: { id: w.mine.id } });
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(w.elsewhere.title);
    await loginAs(w.admin.id);
    expect((await call(taskRoute.GET, { params: { id: w.mine.id } })).text).toContain(w.elsewhere.title);
  });
});
