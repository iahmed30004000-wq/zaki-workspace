import { describe, expect, it } from "vitest";
import * as convertRoute from "@/app/api/ideas/[id]/convert/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import { createTask, updateTask } from "@/server/services/tasks";
import { call, db, loginAs, makeTeam, makeUser } from "./helpers";
import { joinOrg, joinWorkspace, makeScopedOrg, seedWork, type ScopedOrg } from "./scoping-helpers";

async function makeIdea(f: ScopedOrg, creatorId: string) {
  return db.idea.create({ data: { orgId: f.org.id, creatorId, title: `Idea ${f.token}`, description: "why" } });
}

function target(work: { project: { id: string }; board: { id: string } }, workspaceId: string) {
  return { workspaceId, projectId: work.project.id, boardId: work.board.id };
}

const tasksIn = (projectId: string) => db.task.count({ where: { projectId } });

describe("idea → task: the caller must be able to open the target workspace", () => {
  it("a MEMBER cannot convert their idea into a workspace they are not in, and nothing changes", async () => {
    const f = await makeScopedOrg();
    const idea = await makeIdea(f, f.member.id);
    await loginAs(f.member.id);
    const res = await call(convertRoute.POST, {
      params: { id: idea.id },
      body: target(f.outside, f.wsOut.id),
    });
    expect(res.status).toBe(403);
    expect(await tasksIn(f.outside.project.id)).toBe(1); // only the fixture's own task
    const after = await db.idea.findUniqueOrThrow({ where: { id: idea.id } });
    expect(after.status).toBe("NEW");
    expect(after.taskId).toBeNull();
  });

  it("a MEMBER can convert their idea into a workspace they belong to", async () => {
    const f = await makeScopedOrg();
    const idea = await makeIdea(f, f.member.id);
    await loginAs(f.member.id);
    const res = await call(convertRoute.POST, {
      params: { id: idea.id },
      body: target(f.inside, f.wsIn.id),
    });
    expect(res.status).toBe(200);
    const taskId = (res.json as { taskId: string }).taskId;
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(task.workspaceId).toBe(f.wsIn.id);
    expect(task.creatorId).toBe(f.member.id);
    const after = await db.idea.findUniqueOrThrow({ where: { id: idea.id } });
    expect(after.status).toBe("PLANNING");
    expect(after.taskId).toBe(taskId);
  });

  it("the OWNER can convert someone else's idea into any workspace of the org (they inherit them all), without a row", async () => {
    const f = await makeScopedOrg();
    const idea = await makeIdea(f, f.member.id);
    await loginAs(f.owner.id);
    const res = await call(convertRoute.POST, {
      params: { id: idea.id },
      body: target(f.outside, f.wsOut.id),
    });
    expect(res.status).toBe(200);
    const task = await db.task.findUniqueOrThrow({ where: { id: (res.json as { taskId: string }).taskId } });
    expect(task.workspaceId).toBe(f.wsOut.id);
    // the owner only looked and wrote: no row was made for them in that space
    expect(await db.workspaceMember.count({ where: { workspaceId: f.wsOut.id, userId: f.owner.id } })).toBe(0);
  });

  it("an ADMIN converts someone else's idea only into a workspace they are in (not by rank), then can", async () => {
    const f = await makeScopedOrg();
    const idea = await makeIdea(f, f.member.id);
    await loginAs(f.admin.id);
    // org admins run the ideas, but a space is open only to the people in it: wsOut is not open to this ADMIN
    const denied = await call(convertRoute.POST, {
      params: { id: idea.id },
      body: target(f.outside, f.wsOut.id),
    });
    expect(denied.status).toBe(403);
    expect(denied.json?.["message"]).toBe("not_workspace_member");
    expect(await tasksIn(f.outside.project.id)).toBe(1); // only the fixture's own task
    const untouched = await db.idea.findUniqueOrThrow({ where: { id: idea.id } });
    expect(untouched.status).toBe("NEW");
    expect(untouched.taskId).toBeNull();

    await joinWorkspace(f.admin.id, f.wsOut.id, "MEMBER");
    const res = await call(convertRoute.POST, {
      params: { id: idea.id },
      body: target(f.outside, f.wsOut.id),
    });
    expect(res.status).toBe(200);
    const task = await db.task.findUniqueOrThrow({ where: { id: (res.json as { taskId: string }).taskId } });
    expect(task.workspaceId).toBe(f.wsOut.id);
  });

  it("being added to the workspace later makes the same conversion succeed", async () => {
    const f = await makeScopedOrg();
    const idea = await makeIdea(f, f.member.id);
    await loginAs(f.member.id);
    const denied = await call(convertRoute.POST, { params: { id: idea.id }, body: target(f.outside, f.wsOut.id) });
    expect(denied.status).toBe(403);
    await joinWorkspace(f.member.id, f.wsOut.id);
    const ok = await call(convertRoute.POST, { params: { id: idea.id }, body: target(f.outside, f.wsOut.id) });
    expect(ok.status).toBe(200);
  });

  it("an id that is not a workspace at all is refused, not an internal error", async () => {
    const f = await makeScopedOrg();
    const idea = await makeIdea(f, f.member.id);
    await loginAs(f.member.id);
    const res = await call(convertRoute.POST, {
      params: { id: idea.id },
      body: { workspaceId: "no-such-workspace", projectId: f.inside.project.id, boardId: f.inside.board.id },
    });
    expect([403, 404]).toContain(res.status);
    expect((await db.idea.findUniqueOrThrow({ where: { id: idea.id } })).taskId).toBeNull();
  });

  it("a workspace of another organization is refused even for someone who belongs to both orgs", async () => {
    const a = await makeScopedOrg();
    const b = await makeScopedOrg();
    const multi = await makeUser({ orgId: a.org.id, role: "MEMBER" });
    await joinOrg(multi.id, b.org.id, "ADMIN");
    await joinWorkspace(multi.id, b.wsIn.id); // B's workspace is open to them (an ADMIN takes the row, not the rank)
    const idea = await makeIdea(a, multi.id);
    await loginAs(multi.id);
    const res = await call(convertRoute.POST, {
      params: { id: idea.id },
      body: target(b.inside, b.wsIn.id),
    });
    expect([403, 404]).toContain(res.status);
    expect(await tasksIn(b.inside.project.id)).toBe(1);
    expect((await db.idea.findUniqueOrThrow({ where: { id: idea.id } })).taskId).toBeNull();
  });

  it("keeps the existing rules: only the creator or an org admin converts, and only once", async () => {
    const f = await makeScopedOrg();
    const idea = await makeIdea(f, f.owner.id);
    await loginAs(f.member.id); // not the creator, not an admin
    expect((await call(convertRoute.POST, { params: { id: idea.id }, body: target(f.inside, f.wsIn.id) })).status).toBe(403);

    await loginAs(f.owner.id);
    expect((await call(convertRoute.POST, { params: { id: idea.id }, body: target(f.inside, f.wsIn.id) })).status).toBe(200);
    expect((await call(convertRoute.POST, { params: { id: idea.id }, body: target(f.inside, f.wsIn.id) })).status).toBe(403);
  });
});

describe("tasks: an assignee must belong to the actor's organization (checked in the service)", () => {
  async function setup() {
    const f = await makeScopedOrg();
    const work = await seedWork({
      orgId: f.org.id,
      workspaceId: f.wsIn.id,
      token: f.token,
      label: "assign",
      creatorId: f.owner.id,
    });
    const stranger = await makeTeam(); // a user of a different organization
    return { f, work, actor: { userId: f.member.id, orgId: f.org.id }, foreign: stranger.member };
  }

  it("updateTask refuses a user of another organization and leaves the task untouched", async () => {
    const { work, actor, foreign } = await setup();
    await expect(updateTask(actor, work.task.id, { assigneeId: foreign.id })).rejects.toMatchObject({
      name: "ForbiddenError",
      message: "assignee.not_member",
    });
    const row = await db.task.findUniqueOrThrow({ where: { id: work.task.id } });
    expect(row.assigneeId).toBeNull();
    expect(await db.taskActivity.count({ where: { taskId: work.task.id, event: "task.updated" } })).toBe(0);
  });

  it("updateTask refuses an id that is not a user, as a refusal and not a database error", async () => {
    const { work, actor } = await setup();
    await expect(updateTask(actor, work.task.id, { assigneeId: "no-such-user" })).rejects.toMatchObject({
      name: "ForbiddenError",
      message: "assignee.not_member",
    });
  });

  it("the refused change does not partially apply other fields of the same update", async () => {
    const { work, actor, foreign } = await setup();
    await expect(
      updateTask(actor, work.task.id, { title: "renamed", priority: "URGENT", assigneeId: foreign.id }),
    ).rejects.toMatchObject({ name: "ForbiddenError" });
    const row = await db.task.findUniqueOrThrow({ where: { id: work.task.id } });
    expect(row.title).toBe(work.task.title);
    expect(row.priority).toBe("NORMAL");
    expect(row.assigneeId).toBeNull();
  });

  it("updateTask still assigns a colleague of the same org, and un-assigns with null", async () => {
    const { f, work, actor } = await setup();
    const colleague = await makeUser({ orgId: f.org.id, role: "MEMBER" });
    // B4 (a task is given only to a person of its space): the colleague works in the task's space
    await db.workspaceMember.create({ data: { workspaceId: f.wsIn.id, userId: colleague.id } });
    const assigned = await updateTask(actor, work.task.id, { assigneeId: colleague.id });
    expect(assigned.assigneeId).toBe(colleague.id);
    const cleared = await updateTask(actor, work.task.id, { assigneeId: null });
    expect(cleared.assigneeId).toBeNull();
  });

  it("updateTask can resend the current assignee and change other fields (nothing is being re-assigned)", async () => {
    const { f, work, actor } = await setup();
    const colleague = await makeUser({ orgId: f.org.id, role: "MEMBER" });
    await db.workspaceMember.create({ data: { workspaceId: f.wsIn.id, userId: colleague.id } });
    await updateTask(actor, work.task.id, { assigneeId: colleague.id });
    // the colleague later leaves the org; a form that resends the unchanged assignee must still save
    await db.organizationMember.deleteMany({ where: { organizationId: f.org.id, userId: colleague.id } });
    const saved = await updateTask(actor, work.task.id, { assigneeId: colleague.id, title: "still saves" });
    expect(saved.title).toBe("still saves");
    expect(saved.assigneeId).toBe(colleague.id);
  });

  it("createTask keeps refusing a foreign assignee too", async () => {
    const { f, work, actor, foreign } = await setup();
    await expect(
      createTask(actor, {
        workspaceId: f.wsIn.id,
        projectId: work.project.id,
        boardId: work.board.id,
        title: "new",
        assigneeId: foreign.id,
      }),
    ).rejects.toMatchObject({ name: "ForbiddenError", message: "assignee.not_member" });
  });

  it("PATCH /api/tasks/:id still answers 403 for a foreign assignee", async () => {
    const { f, work, foreign } = await setup();
    await loginAs(f.member.id);
    const res = await call(taskRoute.PATCH, {
      method: "PATCH",
      params: { id: work.task.id },
      body: { assigneeId: foreign.id },
    });
    expect(res.status).toBe(403);
    expect((await db.task.findUniqueOrThrow({ where: { id: work.task.id } })).assigneeId).toBeNull();
  });
});
