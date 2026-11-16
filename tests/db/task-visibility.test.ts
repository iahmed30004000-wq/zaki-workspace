/**
 * P0.2 — a task can be private to the people it concerns («المعنيين بس», `Task.visibility = "PARTICIPANTS"`).
 *
 * The owner's complaint (2026-11-16): «لو أعطيت مهام لموظف بتظهر عند الجميع». A private task is read by its creator, its
 * assignees (the first and the people beside), their managers up the reporting line, the managers of its space, and
 * whoever holds silent oversight (`archive.view`); for everybody else it does not exist (404, absent from every list,
 * not counted, no chip in the chat). A public task («المساحة كلها») is read exactly as before.
 */
import { describe, expect, it } from "vitest";
import * as boardRoute from "@/app/api/boards/[id]/route";
import * as tasksRoute from "@/app/api/tasks/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as taskCommentsRoute from "@/app/api/tasks/[id]/comments/route";
import * as taskCompleteRoute from "@/app/api/tasks/[id]/complete/route";
import * as memberRoute from "@/app/api/organizations/[id]/members/[userId]/route";
import * as searchRoute from "@/app/api/search/route";
import { conversationDetail } from "@/server/chat/topics";
import { getProjectTimeline } from "@/server/services/timeline";
import { canSeeTask, loadWorkScope, taskVisibleSql } from "@/server/services/team-scope";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const mk = (name: string) => makeUser({ orgId, role: "MEMBER", name });
  // the people of the space, and the reporting line R → RR above the assignee A
  const [creator, assignee, beside, other, boss, bigBoss, spaceAdmin] = await Promise.all([mk("Creator"), mk("Assignee"), mk("Beside"), mk("Other"), mk("Boss"), mk("BigBoss"), mk("SpaceAdmin")]);
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId: boss.id } }, data: { managerId: bigBoss.id } });
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgId, userId: assignee.id } }, data: { managerId: boss.id } });
  const space = await makeWorkspace(orgId, [
    { userId: creator.id }, { userId: assignee.id }, { userId: beside.id }, { userId: other.id }, { userId: boss.id }, { userId: bigBoss.id },
    { userId: spaceAdmin.id, role: "ADMIN" },
  ]);
  const { project, board, todo } = await makeProject(space.id);
  const base = { orgId, workspaceId: space.id, projectId: project.id, boardId: board.id, columnId: todo.id };
  const priv = await makeTask({ ...base, creatorId: creator.id, assigneeId: assignee.id, title: "خاصة بسلمى" });
  await db.task.update({ where: { id: priv.id }, data: { visibility: "PARTICIPANTS", coAssignees: { create: [{ userId: beside.id }] } } });
  const open = await makeTask({ ...base, creatorId: creator.id, assigneeId: assignee.id, title: "علنية للمساحة" });
  // a partner (OWNER rank, not in the space, archive.view taken away) and one who still holds it
  const partner = team.admin;
  const partnerKeep = await makeUser({ orgId, role: "ADMIN", name: "PartnerKeep" });
  await loginAs(team.owner.id);
  for (const p of [partner, partnerKeep]) await call(memberRoute.PATCH, { method: "PATCH", params: { id: orgId, userId: p.id }, body: { role: "OWNER" } });
  await call(memberRoute.PATCH, { method: "PATCH", params: { id: orgId, userId: partner.id }, body: { revokedCapabilities: ["archive.view"] } });
  return { ...team, orgId, creator, assignee, beside, other, boss, bigBoss, spaceAdmin, partner, partnerKeep, space, project, board, base, priv, open };
}
type World = Awaited<ReturnType<typeof world>>;

const getTask = (id: string) => call(taskRoute.GET, { params: { id } });
const boardIds = async (w: World) => ((await call(boardRoute.GET, { params: { id: w.board.id } })).json?.["tasks"] as Array<{ id: string }> | undefined)?.map((t) => t.id) ?? [];
const listIds = async (w: World) =>
  ((await call(tasksRoute.GET, { url: `http://localhost/api/tasks?workspaceId=${w.space.id}` })).json?.["tasks"] as Array<{ id: string }> | undefined)?.map((t) => t.id) ?? [];

describe("who reads a private task", () => {
  it("its creator, its assignees, their managers up the line, the space's manager and the primary owner read it everywhere", async () => {
    const w = await world();
    for (const who of [w.creator, w.assignee, w.beside, w.boss, w.bigBoss, w.spaceAdmin, w.owner, w.partnerKeep]) {
      await loginAs(who.id);
      expect((await getTask(w.priv.id)).status, `GET as ${who.id}`).toBe(200);
      expect(await boardIds(w), "board").toContain(w.priv.id);
      expect(await listIds(w), "list").toContain(w.priv.id);
      expect((await call(taskCommentsRoute.GET, { params: { id: w.priv.id } })).status, "comments").toBe(200);
    }
  });

  it("everybody else of the space does not know it exists: 404, not on the board, not in the list, no comments, no completion", async () => {
    const w = await world();
    await loginAs(w.other.id);
    expect((await getTask(w.priv.id)).status).toBe(404);
    expect(await boardIds(w)).not.toContain(w.priv.id);
    expect(await boardIds(w)).toContain(w.open.id);
    expect(await listIds(w)).not.toContain(w.priv.id);
    expect(await listIds(w)).toContain(w.open.id);
    expect((await call(taskCommentsRoute.GET, { params: { id: w.priv.id } })).status).toBe(404);
    expect((await call(taskCommentsRoute.POST, { method: "POST", params: { id: w.priv.id }, body: { body: "تطفّل" } })).status).toBe(404);
    expect((await call(taskCompleteRoute.POST, { method: "POST", params: { id: w.priv.id }, body: { complete: true } })).status).toBe(404);
    expect(await db.taskComment.count({ where: { taskId: w.priv.id } })).toBe(0);
    expect((await db.task.findUniqueOrThrow({ where: { id: w.priv.id } })).completedAt).toBeNull();
    // the timeline, the search and the chat of the project name nothing private either
    expect((await getProjectTimeline(w.project.id, w.other.id)).tasks.map((t) => t.id)).not.toContain(w.priv.id);
    const found = (await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent("خاصة بسلمى")}` })).json;
    expect(JSON.stringify(found)).not.toContain(w.priv.id);
  });

  it("a partner without archive.view and without a space row does not read it; a partner who holds it does, like the primary owner", async () => {
    const w = await world();
    await loginAs(w.partner.id);
    expect((await getTask(w.priv.id)).status).toBe(404);
    expect(await listIds(w)).not.toContain(w.priv.id);
    await loginAs(w.partnerKeep.id);
    expect((await getTask(w.priv.id)).status).toBe(200);
    await loginAs(w.owner.id);
    expect((await getTask(w.priv.id)).status).toBe(200);
  });

  it("a public task is read by the whole space exactly as before", async () => {
    const w = await world();
    for (const who of [w.other, w.creator, w.spaceAdmin]) {
      await loginAs(who.id);
      expect((await getTask(w.open.id)).status).toBe(200);
      expect(await boardIds(w)).toContain(w.open.id);
    }
  });

  it("a guest of the space never reads a private task", async () => {
    const w = await world();
    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: w.guest.id, role: "GUEST" } });
    await loginAs(w.guest.id);
    expect((await getTask(w.priv.id)).status).toBe(404);
  });

  it("the same rule as one row (canSeeTask) and as SQL (taskVisibleSql) — they agree for every person", async () => {
    const w = await world();
    const who = [w.creator, w.assignee, w.beside, w.other, w.boss, w.bigBoss, w.spaceAdmin, w.owner, w.partner, w.partnerKeep];
    for (const u of who) {
      const scope = await loadWorkScope(u.id);
      const row = { workspaceId: w.space.id, teamId: null, visibility: "PARTICIPANTS", creatorId: w.creator.id, assigneeId: w.assignee.id, coAssigneeIds: [w.beside.id] };
      const sql = await db.$queryRaw<{ id: string }[]>`SELECT t."id" FROM "Task" t WHERE t."id" = ${w.priv.id} AND ${taskVisibleSql(scope, "t")}`;
      const inSpace = scope.full.has(w.space.id);
      expect(canSeeTask(scope, row), `canSeeTask for ${u.id}`).toBe(inSpace && sql.length === 1);
    }
  });
});

describe("who changes the choice, and the default", () => {
  const patch = (id: string, body: Record<string, unknown>) => call(taskRoute.PATCH, { method: "PATCH", params: { id }, body });

  it("the creator, a manager of the space and the assignee's manager switch it; the plain assignee and a stranger cannot; every change is on the task's log", async () => {
    const w = await world();
    await loginAs(w.assignee.id);
    expect((await patch(w.priv.id, { visibility: "SPACE" })).status).toBe(403);
    await loginAs(w.other.id);
    expect((await patch(w.priv.id, { visibility: "SPACE" })).status).toBe(404);
    await loginAs(w.creator.id);
    expect((await patch(w.priv.id, { visibility: "SPACE" })).status).toBe(200);
    await loginAs(w.other.id);
    expect((await getTask(w.priv.id)).status).toBe(200);
    await loginAs(w.boss.id);
    expect((await patch(w.priv.id, { visibility: "PARTICIPANTS" })).status).toBe(200);
    await loginAs(w.other.id);
    expect((await getTask(w.priv.id)).status).toBe(404);
    const log = await db.taskActivity.findMany({ where: { taskId: w.priv.id, event: "task.visibility_changed" }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => l.meta)).toEqual([{ from: "PARTICIPANTS", to: "SPACE" }, { from: "SPACE", to: "PARTICIPANTS" }]);
  });

  it("a new task is public by default; private when the company turned the default on and somebody is assigned; the caller's own choice wins", async () => {
    const w = await world();
    await loginAs(w.creator.id);
    const make = async (extra: Record<string, unknown>) =>
      (await call(tasksRoute.POST, { method: "POST", body: { workspaceId: w.space.id, projectId: w.project.id, boardId: w.board.id, title: `T ${Math.random()}`, ...extra } })).json?.["task"] as { id: string; visibility: string };
    expect((await make({ assigneeId: w.assignee.id })).visibility).toBe("SPACE");
    await db.organization.update({ where: { id: w.orgId }, data: { settings: { features: { taskPrivacy: true } } } });
    expect((await make({ assigneeId: w.assignee.id })).visibility).toBe("PARTICIPANTS");
    expect((await make({})).visibility).toBe("SPACE");
    expect((await make({ assigneeId: w.assignee.id, visibility: "SPACE" })).visibility).toBe("SPACE");
  });
});

describe("the chat does not name a private task to a person it does not concern", () => {
  it("the «صارت مهمة» chip of a message shows for the assignee and not for another member", async () => {
    const w = await world();
    const topic = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: "General" } });
    const msg = await db.chatMessage.create({ data: { orgId: w.orgId, conversationId: topic.id, authorId: w.creator.id, body: "نعمل هالشغلة" } });
    await db.task.update({ where: { id: w.priv.id }, data: { sourceMessageId: msg.id } });
    const chips = async (userId: string) => {
      const detail = await conversationDetail({ orgId: w.orgId, userId, orgRole: "MEMBER" }, topic.id);
      return detail.messages.find((m) => m.id === msg.id)?.work ?? [];
    };
    expect((await chips(w.assignee.id)).map((x) => x.id)).toContain(w.priv.id);
    expect((await chips(w.other.id)).map((x) => x.id)).not.toContain(w.priv.id);
  });
});

describe("«خلّي المهام المسندة المفتوحة خاصة» (the space's one-click)", () => {
  it("counts, then changes only open, assigned, public tasks; every one gets a line in its log; a plain member is refused", async () => {
    const w = await world();
    const done = await makeTask({ ...w.base, creatorId: w.creator.id, assigneeId: w.assignee.id, completedAt: new Date(), title: "خلصت" });
    const unassigned = await makeTask({ ...w.base, creatorId: w.creator.id, title: "بدون مسؤول" });
    const route = await import("@/app/api/workspaces/[id]/private-tasks/route");

    await loginAs(w.other.id);
    expect((await call(route.GET, { params: { id: w.space.id } })).status).toBe(403);
    expect((await call(route.POST, { method: "POST", params: { id: w.space.id } })).status).toBe(403);
    expect((await db.task.findUniqueOrThrow({ where: { id: w.open.id } })).visibility).toBe("SPACE");

    await loginAs(w.spaceAdmin.id);
    expect((await call(route.GET, { params: { id: w.space.id } })).json?.["count"]).toBe(1); // only `open`: priv is already private, done is closed, unassigned has nobody
    const res = await call(route.POST, { method: "POST", params: { id: w.space.id } });
    expect(res.status).toBe(200);
    expect(res.json?.["changed"]).toBe(1);
    expect((await db.task.findUniqueOrThrow({ where: { id: w.open.id } })).visibility).toBe("PARTICIPANTS");
    expect((await db.task.findUniqueOrThrow({ where: { id: done.id } })).visibility).toBe("SPACE");
    expect((await db.task.findUniqueOrThrow({ where: { id: unassigned.id } })).visibility).toBe("SPACE");
    expect(await db.taskActivity.count({ where: { taskId: w.open.id, event: "task.visibility_changed" } })).toBe(1);
    await loginAs(w.other.id);
    expect((await getTask(w.open.id)).status).toBe(404);
  });
});
