import { describe, expect, it } from "vitest";
import { GET as projectsGET } from "@/app/api/work/projects/route";
import { GET as projectGET } from "@/app/api/work/projects/[id]/route";
import { GET as boardGET } from "@/app/api/work/boards/[id]/route";
import * as moveRoute from "@/app/api/tasks/[id]/move/route";
import { call, db, loginAs, logout, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

/**
 * The phone's read-only doors of «المشاريع» (M2 N3): the projects of the space, one project, one board. They read the very functions the
 * site's pages read (`projectsScreenFor`, `projectScreenFor`, `boardScreenFor`), so the rules are the pages' rules — proven here against a
 * real database: somebody outside the space gets nothing, a partner reads but never adds or drags, and a card counts only for whom may open it.
 */
async function world() {
  const t = await makeTeam();
  const outsider = await makeUser({ orgId: t.org.id, role: "MEMBER", name: "Outsider" });
  const ws = await makeWorkspace(t.org.id, [
    { userId: t.admin.id, role: "ADMIN" },
    { userId: t.member.id, role: "MEMBER" },
    { userId: t.guest.id, role: "GUEST" },
  ]);
  const p = await makeProject(ws.id);
  const task = await makeTask({
    orgId: t.org.id,
    workspaceId: ws.id,
    projectId: p.project.id,
    boardId: p.board.id,
    columnId: p.todo.id,
    creatorId: t.member.id,
    assigneeId: t.member.id,
    title: "Board door task",
  });
  return { ...t, outsider, ws, ...p, task };
}

const projectsOf = () => call(projectsGET, { url: "http://localhost/api/work/projects" });
const projectOf = (id: string) => call(projectGET, { params: { id }, url: `http://localhost/api/work/projects/${id}` });
const boardOf = (id: string) => call(boardGET, { params: { id }, url: `http://localhost/api/work/boards/${id}` });

describe("GET /api/work/projects — the projects of the space the person is in", () => {
  it("a member of the space finds its project with the tasks and boards it holds", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const r = await projectsOf();
    expect(r.status).toBe(200);
    const body = r.json as { space: { id: string } | null; projects: { id: string; tasks: number; boards: number }[]; inboxes: unknown[]; canCreate: boolean };
    expect(body.space?.id).toBe(w.ws.id);
    const row = body.projects.find((p) => p.id === w.project.id);
    expect(row).toMatchObject({ tasks: 1, boards: 1 });
    expect(body.canCreate).toBe(true);
  });

  it("somebody outside the space does not see its project", async () => {
    const w = await world();
    await loginAs(w.outsider.id);
    const r = await projectsOf();
    expect(r.status).toBe(200);
    const body = r.json as { projects: { id: string }[] };
    expect(body.projects.map((p) => p.id)).not.toContain(w.project.id);
  });

  it("an archived project is not listed", async () => {
    const w = await world();
    await db.project.update({ where: { id: w.project.id }, data: { status: "ARCHIVED" } });
    await loginAs(w.member.id);
    const body = (await projectsOf()).json as { projects: { id: string }[] };
    expect(body.projects.map((p) => p.id)).not.toContain(w.project.id);
  });
});

describe("GET /api/work/projects/[id] — one project as its page shows it", () => {
  it("a member reads its head, its board with the task count, the progress and what they may do", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const r = await projectOf(w.project.id);
    expect(r.status).toBe(200);
    const body = r.json as Record<string, any>;
    expect(body.project.id).toBe(w.project.id);
    expect(body.project.workspaceId).toBe(w.ws.id);
    expect(body.boards).toEqual([{ id: w.board.id, name: w.board.name, tasks: 1 }]);
    expect(body.progress).toEqual({ open: 1, done: 0, pct: 0 });
    expect(body.access.canEdit).toBe(true);
  });

  it("a finished task counts as done in the progress", async () => {
    const w = await world();
    await db.task.update({ where: { id: w.task.id }, data: { columnId: w.done.id, completedAt: new Date() } });
    await loginAs(w.member.id);
    const body = (await projectOf(w.project.id)).json as { progress: unknown };
    expect(body.progress).toEqual({ open: 0, done: 1, pct: 100 });
  });

  it("a partner in the space reads it but may not edit it", async () => {
    const w = await world();
    await loginAs(w.guest.id);
    const r = await projectOf(w.project.id);
    expect(r.status).toBe(200);
    expect((r.json as { access: { canEdit: boolean } }).access.canEdit).toBe(false);
  });

  it("somebody outside the space, or nobody signed in, gets nothing", async () => {
    const w = await world();
    await loginAs(w.outsider.id);
    expect((await projectOf(w.project.id)).status).toBe(404);
    logout();
    expect((await projectOf(w.project.id)).status).toBe(401);
  });
});

describe("GET /api/work/boards/[id] — one board as the Kanban draws it", () => {
  it("a member gets the columns in order and the card with its key, and may add and drag", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const r = await boardOf(w.board.id);
    expect(r.status).toBe(200);
    const body = r.json as Record<string, any>;
    expect(body.board).toMatchObject({ id: w.board.id, projectId: w.project.id, workspaceId: w.ws.id });
    expect(body.columns.map((c: { id: string }) => c.id)).toEqual([w.todo.id, w.done.id]);
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0]).toMatchObject({ id: w.task.id, key: `${w.org.keyPrefix}-${w.task.number}`, columnId: w.todo.id, completed: false });
    expect(body.canEdit).toBe(true);
  });

  it("a partner reads the board but never adds or drags, and is handed no reward the owner sees", async () => {
    const w = await world();
    await db.task.update({ where: { id: w.task.id }, data: { rewardStatus: "OPEN", rewardAmountMinor: 15050, rewardCurrency: "JOD" } });
    // the owner's lens shows it: the reward is really there
    await loginAs(w.owner.id);
    const seen = (await boardOf(w.board.id)).json as { tasks: { id: string; reward: { amountMinor: number } | null }[] };
    expect(seen.tasks.find((t) => t.id === w.task.id)?.reward?.amountMinor).toBe(15050);
    // the partner's never does
    await loginAs(w.guest.id);
    const body = (await boardOf(w.board.id)).json as { canEdit: boolean; tasks: { id: string; reward: unknown }[] };
    expect(body.canEdit).toBe(false);
    expect(body.tasks.find((t) => t.id === w.task.id)).toBeDefined();
    for (const t of body.tasks) expect(t.reward ?? null).toBeNull();
  });

  it("a card moved down inside its own column lands at the place it was dropped (the index counts the OTHER cards)", async () => {
    const w = await world();
    const more = async (title: string) =>
      makeTask({ orgId: w.org.id, workspaceId: w.ws.id, projectId: w.project.id, boardId: w.board.id, columnId: w.todo.id, creatorId: w.member.id, title });
    const b = await more("B");
    const c = await more("C");
    await db.task.update({ where: { id: w.task.id }, data: { position: 1000 } });
    await db.task.update({ where: { id: b.id }, data: { position: 2000 } });
    await db.task.update({ where: { id: c.id }, data: { position: 3000 } });
    await loginAs(w.member.id);
    // the first card between B and C: index 1 among [B, C]
    const r = await call(moveRoute.POST, { params: { id: w.task.id }, method: "POST", body: { columnId: w.todo.id, index: 1 }, url: `http://localhost/api/tasks/${w.task.id}/move` });
    expect(r.status).toBe(200);
    const body = (await boardOf(w.board.id)).json as { tasks: { id: string; columnId: string }[] };
    expect(body.tasks.filter((t) => t.columnId === w.todo.id).map((t) => t.id)).toEqual([b.id, w.task.id, c.id]);
  });

  it("a private task of somebody else is not on the board", async () => {
    const w = await world();
    const hidden = await makeTask({
      orgId: w.org.id,
      workspaceId: w.ws.id,
      projectId: w.project.id,
      boardId: w.board.id,
      columnId: w.todo.id,
      creatorId: w.admin.id,
      assigneeId: w.admin.id,
      title: "Private one",
    });
    await db.task.update({ where: { id: hidden.id }, data: { visibility: "PARTICIPANTS" } });
    await loginAs(w.member.id);
    const body = (await boardOf(w.board.id)).json as { tasks: { title: string }[] };
    expect(body.tasks.map((t) => t.title)).not.toContain("Private one");
  });

  it("somebody outside the space gets «not found»", async () => {
    const w = await world();
    await loginAs(w.outsider.id);
    expect((await boardOf(w.board.id)).status).toBe(404);
  });
});
