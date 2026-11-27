import { describe, expect, it } from "vitest";
import * as deleteAllRoute from "@/app/api/workspaces/[id]/delete-all/route";
import { ensureHqSpace } from "@/server/chat/hq";
import { createDepartment } from "@/server/services/departments";
import { deptSpaceIdOf } from "@/server/services/department-space";
import type { OrgAccessContext } from "@/server/auth";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

/**
 * THE OWNER DELETES A SPACE WITH ALL ITS WORK (the owner's decision, 2026-10-26): after typing its name, everything in
 * it goes in one go — tasks, projects, conversations and messages, ideas, goals, routines, customers, opportunities,
 * notifications, its library files — and nothing of another space is touched. Never «الشركة», never anybody but the OWNER.
 * A department's space (2026-11-27) goes with its department.
 */

async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const owner = team.owner;
  const member = await makeUser({ orgId, role: "MEMBER", name: `Member ${uid()}` });
  const doomed = await makeWorkspace(orgId, [{ userId: member.id }], `Doomed ${uid()}`);
  const kept = await makeWorkspace(orgId, [{ userId: member.id }], `Kept ${uid()}`);

  const fill = async (spaceId: string) => {
    const p = await makeProject(spaceId);
    const task = await makeTask({ orgId, workspaceId: spaceId, projectId: p.project.id, boardId: p.board.id, columnId: p.todo.id, creatorId: owner.id, title: `Task ${uid()}` });
    await db.taskComment.create({ data: { taskId: task.id, authorId: owner.id, body: "note" } }).catch(() => undefined);
    const section = await db.team.create({ data: { workspaceId: spaceId, name: `Section ${uid()}` } });
    const topic = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId, title: `Topic ${uid()}`, teamId: section.id } });
    const dm = await db.conversation.create({ data: { orgId, kind: "DM", spaceId, dmKey: `${owner.id}|${member.id}@${spaceId}` } });
    const msg = await db.chatMessage.create({ data: { orgId, conversationId: topic.id, authorId: member.id, body: "hello" } });
    await db.chatMessage.create({ data: { orgId, conversationId: dm.id, authorId: member.id, body: "private" } });
    const idea = await db.idea.create({ data: { orgId, creatorId: owner.id, title: `Idea ${uid()}`, workspaceId: spaceId } });
    const goal = await db.goal.create({ data: { orgId, creatorId: owner.id, title: `Goal ${uid()}`, period: "MONTHLY", periodStart: new Date("2026-10-01"), periodEnd: new Date("2026-10-31"), workspaceId: spaceId } });
    const routine = await db.routine.create({ data: { orgId, title: `Routine ${uid()}`, workspaceId: spaceId } });
    const customer = await db.customer.create({ data: { orgId, creatorId: owner.id, name: `Customer ${uid()}`, workspaceId: spaceId } });
    const opportunity = await db.opportunity.create({ data: { orgId, number: Math.floor(Math.random() * 1e9), customerId: customer.id, ownerId: owner.id, title: `Deal ${uid()}`, workspaceId: spaceId } });
    const file = await db.storedFile.create({
      data: { orgId, uploaderId: owner.id, familyId: `f_${uid()}`, name: "plan.pdf", mimeType: "application/pdf", size: 1, path: `p_${uid()}`, purpose: "LIBRARY", workspaceId: spaceId },
    });
    const note = await db.notification.create({ data: { userId: member.id, type: "task_assigned", title: "x", workspaceId: spaceId } }).catch(() => null);
    return { p, task, section, topic, dm, msg, idea, goal, routine, customer, opportunity, file, note };
  };
  return { ...team, orgId, owner, member, doomed, kept, a: await fill(doomed.id), b: await fill(kept.id) };
}

const contents = (id: string) => call(deleteAllRoute.GET, { params: { id } });
const remove = (id: string, confirmName: string) => call(deleteAllRoute.POST, { params: { id }, body: { confirmName } });

describe("deleting a space with all its work", () => {
  it("shows what goes with it, then deletes it all — and nothing of another space", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const before = await contents(w.doomed.id);
    expect(before.status).toBe(200);
    expect(before.json).toMatchObject({ name: w.doomed.name, projects: 1, tasks: 1, conversations: 2, messages: 2, files: 1, ideas: 1, goals: 1, routines: 1, customers: 1 });

    expect((await remove(w.doomed.id, w.doomed.name)).status).toBe(200);

    expect(await db.workspace.findUnique({ where: { id: w.doomed.id } })).toBeNull();
    expect(await db.task.findUnique({ where: { id: w.a.task.id } })).toBeNull();
    expect(await db.project.findUnique({ where: { id: w.a.p.project.id } })).toBeNull();
    expect(await db.conversation.count({ where: { id: { in: [w.a.topic.id, w.a.dm.id] } } })).toBe(0);
    expect(await db.chatMessage.findUnique({ where: { id: w.a.msg.id } })).toBeNull();
    expect(await db.team.findUnique({ where: { id: w.a.section.id } })).toBeNull();
    expect(await db.idea.findUnique({ where: { id: w.a.idea.id } })).toBeNull();
    expect(await db.goal.findUnique({ where: { id: w.a.goal.id } })).toBeNull();
    expect(await db.routine.findUnique({ where: { id: w.a.routine.id } })).toBeNull();
    expect(await db.customer.findUnique({ where: { id: w.a.customer.id } })).toBeNull();
    expect(await db.opportunity.findUnique({ where: { id: w.a.opportunity.id } })).toBeNull();
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: w.a.file.id } })).deletedAt).not.toBeNull();
    expect(await db.workspaceMember.count({ where: { workspaceId: w.doomed.id } })).toBe(0);

    // the other space is whole
    expect(await db.workspace.findUnique({ where: { id: w.kept.id } })).not.toBeNull();
    expect(await db.task.findUnique({ where: { id: w.b.task.id } })).not.toBeNull();
    expect(await db.chatMessage.findUnique({ where: { id: w.b.msg.id } })).not.toBeNull();
    expect(await db.idea.findUnique({ where: { id: w.b.idea.id } })).not.toBeNull();
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: w.b.file.id } })).deletedAt).toBeNull();
  });

  it("the typed name must be the space's own (409); nothing is deleted", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const wrong = await remove(w.doomed.id, "something else");
    expect(wrong.status).toBe(409);
    expect(wrong.json?.["message"]).toBe("spaces.delete_name_mismatch");
    expect(await db.task.findUnique({ where: { id: w.a.task.id } })).not.toBeNull();
  });

  it("only the OWNER (403); never «الشركة» (409)", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    expect((await remove(w.doomed.id, w.doomed.name)).status).toBe(403);
    expect((await contents(w.doomed.id)).status).toBe(403);
    await loginAs(w.member.id);
    expect((await remove(w.doomed.id, w.doomed.name)).status).toBe(403);

    await loginAs(w.owner.id);
    const hq = await ensureHqSpace(w.orgId, "الشركة");
    const hqTry = await remove(hq, "الشركة");
    expect(hqTry.status).toBe(409);
    expect(hqTry.json?.["message"]).toBe("spaces.delete_hq");

  });

  it("a department's space goes WITH its department: counted first, deleted together, no other department touched", async () => {
    const w = await world();
    const admin: OrgAccessContext = { orgId: w.orgId, userId: w.admin.id, orgRole: "ADMIN" };
    const dept = await createDepartment(admin, { name: `Design ${uid()}` });
    const other = await createDepartment(admin, { name: `Sales ${uid()}` });
    await db.departmentMember.create({ data: { departmentId: dept.id, userId: w.member.id } });
    await db.ticket.create({ data: { orgId: w.orgId, departmentId: dept.id, creatorId: w.owner.id, title: `Request ${uid()}`, number: Math.floor(Math.random() * 1e9) } });
    const kept = await db.ticket.create({ data: { orgId: w.orgId, departmentId: other.id, creatorId: w.owner.id, title: `Request ${uid()}`, number: Math.floor(Math.random() * 1e9) } });
    const spaceId = deptSpaceIdOf(dept.id);

    await loginAs(w.owner.id);
    const dry = await contents(spaceId);
    expect(dry.status).toBe(200);
    expect(dry.json?.["department"]).toEqual({ tickets: 1, campaigns: 0, people: 1 });
    // the dry run deletes nothing
    expect(await db.department.findUnique({ where: { id: dept.id } })).not.toBeNull();
    expect(await db.workspace.findUnique({ where: { id: spaceId } })).not.toBeNull();

    await loginAs(w.admin.id);
    expect((await remove(spaceId, dept.name)).status).toBe(403);
    await loginAs(w.owner.id);
    expect((await remove(spaceId, dept.name)).status).toBe(200);
    expect(await db.workspace.findUnique({ where: { id: spaceId } })).toBeNull();
    expect(await db.department.findUnique({ where: { id: dept.id } })).toBeNull();
    expect(await db.ticket.count({ where: { departmentId: dept.id } })).toBe(0);
    expect(await db.department.findUnique({ where: { id: other.id } })).not.toBeNull();
    expect(await db.ticket.findUnique({ where: { id: kept.id } })).not.toBeNull();
    expect(await db.workspace.findUnique({ where: { id: deptSpaceIdOf(other.id) } })).not.toBeNull();
  });

  it("a space whose department is already gone is deleted like any other (deleting a department only unlinks its space)", async () => {
    const w = await world();
    const admin: OrgAccessContext = { orgId: w.orgId, userId: w.admin.id, orgRole: "ADMIN" };
    const dept = await createDepartment(admin, { name: `Old ${uid()}` });
    const spaceId = deptSpaceIdOf(dept.id);
    await db.department.delete({ where: { id: dept.id } });
    await loginAs(w.owner.id);
    const dry = await contents(spaceId);
    expect(dry.status).toBe(200);
    expect(dry.json?.["department"]).toBeNull();
    expect((await remove(spaceId, dept.name)).status).toBe(200);
    expect(await db.workspace.findUnique({ where: { id: spaceId } })).toBeNull();
  });

  it("counts the daily routines with the others, and the seats", async () => {
    const w = await world();
    await db.dailyRoutine.create({ data: { orgId: w.orgId, workspaceId: w.doomed.id, projectId: w.a.p.project.id, boardId: w.a.p.board.id, title: "daily", assigneeId: w.member.id, createdById: w.owner.id, days: [0], time: "09:00", dueTime: "18:00" } });
    await loginAs(w.owner.id);
    const dry = await contents(w.doomed.id);
    expect(dry.json).toMatchObject({ routines: 2, department: null });
    expect(Number(dry.json?.["members"])).toBeGreaterThanOrEqual(1);
    expect((await remove(w.doomed.id, w.doomed.name)).status).toBe(200);
    expect(await db.dailyRoutine.count({ where: { workspaceId: w.doomed.id } })).toBe(0);
  });
});
