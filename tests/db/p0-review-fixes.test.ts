/**
 * The independent review of phase P0 (docs/restructure/pr/P0.R.md): holes found AFTER the six steps, each proved here.
 *
 *  1. a task made from a private chat could be published by one click on the task page (no confirmation);
 *  2. the reporting line crossed companies (a manager in company A read private tasks of the same person in company B);
 *  3. «التبعيات» showed the title of a private task to somebody who may not open it;
 *  4. the time report showed private tasks' titles to an OWNER-rank person who is not a manager of the space;
 *  5. project and milestone counts still counted private tasks.
 */
import { describe, expect, it } from "vitest";
import * as dmRoute from "@/app/api/chat/dm/route";
import * as messagesRoute from "@/app/api/chat/conversations/[id]/messages/route";
import * as makeTaskRoute from "@/app/api/chat/messages/[id]/task/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as linksRoute from "@/app/api/tasks/[id]/links/route";
import * as reportRoute from "@/app/api/time/report/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as memberRoute from "@/app/api/organizations/[id]/members/[userId]/route";
import { call, db, loginAs, makeOrg, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";

describe("1. a task made from a private chat is published only with a confirmation", () => {
  async function fromDm() {
    const t = await makeTeam();
    const orgId = t.org.id;
    const a = t.member;
    const b = await makeUser({ orgId, role: "MEMBER", name: "B" });
    const space = await makeWorkspace(orgId, [{ userId: a.id }, { userId: b.id }]);
    const { project, board } = await makeProject(space.id);
    await loginAs(a.id);
    const dm = (await call(dmRoute.POST, { body: { userId: b.id } })).json?.["id"] as string;
    const msg = (await call(messagesRoute.POST, { params: { id: dm }, body: { body: "سر بيننا" } })).json?.["id"] as string;
    const made = await call(makeTaskRoute.POST, { method: "POST", params: { id: msg }, body: { workspaceId: space.id, projectId: project.id, boardId: board.id } });
    expect(made.status).toBe(201);
    return { ...t, a, b, space, project, board, taskId: made.json?.["taskId"] as string };
  }
  const patch = (id: string, body: Record<string, unknown>) => call(taskRoute.PATCH, { method: "PATCH", params: { id }, body });

  it("PATCH visibility SPACE without confirmPublic is refused (422) and changes nothing; with it, it works", async () => {
    const w = await fromDm();
    await loginAs(w.a.id);
    const refused = await patch(w.taskId, { visibility: "SPACE" });
    expect(refused.status).toBe(422);
    expect(JSON.stringify(refused.json)).toContain("work.confirm_public_required");
    expect((await db.task.findUniqueOrThrow({ where: { id: w.taskId } })).visibility).toBe("PARTICIPANTS");
    expect((await patch(w.taskId, { visibility: "SPACE", confirmPublic: true })).status).toBe(200);
    expect((await db.task.findUniqueOrThrow({ where: { id: w.taskId } })).visibility).toBe("SPACE");
  });

  it("a task NOT made from a private chat is unchanged: SPACE needs no confirmation", async () => {
    const t = await makeTeam();
    const space = await makeWorkspace(t.org.id, [{ userId: t.member.id }]);
    const { project, board, todo } = await makeProject(space.id);
    const task = await makeTask({ orgId: t.org.id, workspaceId: space.id, projectId: project.id, boardId: board.id, columnId: todo.id, creatorId: t.member.id });
    await db.task.update({ where: { id: task.id }, data: { visibility: "PARTICIPANTS" } });
    await loginAs(t.member.id);
    expect((await patch(task.id, { visibility: "SPACE" })).status).toBe(200);
  });
});

describe("2. the reporting line stays inside one company", () => {
  it("a manager of Y in company A does not read Y's private task in company B", async () => {
    const orgA = await makeOrg();
    const orgB = await makeOrg();
    const x = await makeUser({ orgId: orgA.id, role: "MEMBER", name: "X" });
    const y = await makeUser({ orgId: orgA.id, role: "MEMBER", name: "Y" });
    // the same two people are also members of company B, where X is NOT Y's manager
    await db.organizationMember.create({ data: { organizationId: orgB.id, userId: x.id, role: "MEMBER", status: "ACTIVE" } });
    await db.organizationMember.create({ data: { organizationId: orgB.id, userId: y.id, role: "MEMBER", status: "ACTIVE" } });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: orgA.id, userId: y.id } }, data: { managerId: x.id } });
    const spaceB = await makeWorkspace(orgB.id, [{ userId: x.id }, { userId: y.id }]);
    const { project, board, todo } = await makeProject(spaceB.id);
    const task = await makeTask({ orgId: orgB.id, workspaceId: spaceB.id, projectId: project.id, boardId: board.id, columnId: todo.id, creatorId: y.id, assigneeId: y.id });
    await db.task.update({ where: { id: task.id }, data: { visibility: "PARTICIPANTS" } });
    await loginAs(x.id);
    expect((await call(taskRoute.GET, { params: { id: task.id } })).status).toBe(404);
  });
});

describe("3. «التبعيات» does not name a private task", () => {
  it("the other end's title and key are left out for somebody who may not open it", async () => {
    const t = await makeTeam();
    const orgId = t.org.id;
    const [owner, other] = [t.member, await makeUser({ orgId, role: "MEMBER", name: "Other" })];
    const reader = await makeUser({ orgId, role: "MEMBER", name: "Reader" });
    const space = await makeWorkspace(orgId, [{ userId: owner.id }, { userId: other.id }, { userId: reader.id }]);
    const { project, board, todo } = await makeProject(space.id);
    const base = { orgId, workspaceId: space.id, projectId: project.id, boardId: board.id, columnId: todo.id };
    const open = await makeTask({ ...base, creatorId: owner.id, title: "مهمة عامة" });
    const secret = await makeTask({ ...base, creatorId: other.id, assigneeId: other.id, title: "عنوان سري جدا" });
    await db.task.update({ where: { id: secret.id }, data: { visibility: "PARTICIPANTS" } });
    await db.taskDependency.create({ data: { taskId: open.id, dependsOnId: secret.id, kind: "BLOCKS" } });
    await loginAs(reader.id);
    const res = await call(linksRoute.GET, { params: { id: open.id } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.json)).not.toContain("عنوان سري جدا");
    await loginAs(other.id);
    expect(JSON.stringify((await call(linksRoute.GET, { params: { id: open.id } })).json)).toContain("عنوان سري جدا");
  });
});

describe("4. the time report leaves private tasks out for a person who does not manage the space", () => {
  it("a partner without archive.view and without an ADMIN row does not read a private task's entries", async () => {
    const t = await makeTeam();
    const orgId = t.org.id;
    const partner = await makeUser({ orgId, role: "MEMBER", name: "Partner" });
    const creator = t.member;
    const space = await makeWorkspace(orgId, [{ userId: creator.id }]);
    const { project, board, todo } = await makeProject(space.id);
    const secret = await makeTask({ orgId, workspaceId: space.id, projectId: project.id, boardId: board.id, columnId: todo.id, creatorId: creator.id, assigneeId: creator.id, title: "مهمة سرية بالوقت" });
    await db.task.update({ where: { id: secret.id }, data: { visibility: "PARTICIPANTS" } });
    const now = new Date();
    await db.timeEntry.create({ data: { orgId, workspaceId: space.id, userId: creator.id, taskId: secret.id, taskTitle: "مهمة سرية بالوقت", startedAt: new Date(now.getTime() - 3600_000), stoppedAt: now, seconds: 3600, source: "TIMER" } });
    await loginAs(t.owner.id);
    const patchMember = (body: Record<string, unknown>) => call(memberRoute.PATCH, { method: "PATCH", params: { id: orgId, userId: partner.id }, body });
    expect((await patchMember({ role: "OWNER" })).status).toBe(200);
    expect((await patchMember({ revokedCapabilities: ["archive.view"] })).status).toBe(200);

    await loginAs(partner.id);
    const mine = await call(reportRoute.GET, { url: `http://localhost/api/time/report?workspaceId=${space.id}` });
    expect(mine.status).toBe(200);
    expect(JSON.stringify(mine.json)).not.toContain("مهمة سرية بالوقت");
    // the primary owner (silent oversight) still reads it
    await loginAs(t.owner.id);
    expect(JSON.stringify((await call(reportRoute.GET, { url: `http://localhost/api/time/report?workspaceId=${space.id}` })).json)).toContain("مهمة سرية بالوقت");
  });
});

describe("5. counts do not include private tasks the person may not open", () => {
  it("the projects list counts only what the caller may see", async () => {
    const t = await makeTeam();
    const orgId = t.org.id;
    const a = t.member;
    const b = await makeUser({ orgId, role: "MEMBER", name: "B" });
    const space = await makeWorkspace(orgId, [{ userId: a.id }, { userId: b.id }]);
    const { project, board, todo } = await makeProject(space.id);
    const base = { orgId, workspaceId: space.id, projectId: project.id, boardId: board.id, columnId: todo.id };
    await makeTask({ ...base, creatorId: a.id, title: "public" });
    const secret = await makeTask({ ...base, creatorId: a.id, assigneeId: a.id, title: "secret" });
    await db.task.update({ where: { id: secret.id }, data: { visibility: "PARTICIPANTS" } });
    const countFor = async (userId: string) => {
      await loginAs(userId);
      const res = await call(projectsRoute.GET, { url: `http://localhost/api/projects?workspaceId=${space.id}` });
      return (res.json?.["projects"] as { _count: { tasks: number } }[])[0]!._count.tasks;
    };
    expect(await countFor(a.id)).toBe(2);
    expect(await countFor(b.id)).toBe(1);
  });
});
