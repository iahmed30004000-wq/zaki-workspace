import { describe, expect, it } from "vitest";
import { createTask, listTasks, updateTask } from "@/server/services/tasks";
import { createTicket, ticketDetail, updateTicket } from "@/server/services/tickets";
import { createRoutine, listRoutines, orgRoleOf, setRoutineDone, updateRoutine } from "@/server/services/production";
import { createGoal } from "@/server/services/goals";
import { createDepartment, getDepartment, listDepartments, setMembers } from "@/server/services/departments";
import { db, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { makeDepartment, makeRoutine, makeTicket } from "./guest-helpers";
import { ctxOf, offboard, suspend } from "./active-helpers";

/**
 * "Nobody who was suspended or removed still counts" - the assignment side.
 *
 * One org with a plain colleague, a SUSPENDED one and an OFFBOARDED one. Work cannot be handed to
 * the last two; work they already hold stays readable (and editable around them) until it is moved.
 */
async function world() {
  const team = await makeTeam();
  const active = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Active colleague" });
  const suspended = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Suspended colleague" });
  const gone = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Offboarded colleague" });
  await suspend(team.org.id, suspended.id);
  await offboard(team.org.id, gone.id);
  return { ...team, active, suspended, gone };
}

describe("tasks: work cannot be assigned to a suspended or an offboarded person", () => {
  async function taskWorld() {
    const w = await world();
    // B4 (a task is given only to a person of its space): the active colleague works in the space too
    const ws = await makeWorkspace(w.org.id, [{ userId: w.member.id }, { userId: w.admin.id, role: "ADMIN" }, { userId: w.active.id }]);
    const made = await makeProject(ws.id);
    const actor = { userId: w.member.id, orgId: w.org.id };
    const input = (assigneeId: string | null) => ({
      workspaceId: ws.id,
      projectId: made.project.id,
      boardId: made.board.id,
      title: "New work",
      assigneeId,
    });
    return { ...w, ws, ...made, actor, input };
  }

  it("createTask refuses both of them and creates nothing", async () => {
    const w = await taskWorld();
    for (const person of [w.suspended, w.gone]) {
      await expect(createTask(w.actor, w.input(person.id))).rejects.toMatchObject({
        name: "ForbiddenError",
        message: "assignee.not_active",
      });
    }
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("updateTask refuses to hand a task to them and leaves the task untouched", async () => {
    const w = await taskWorld();
    const task = await makeTask({
      orgId: w.org.id,
      workspaceId: w.ws.id,
      projectId: w.project.id,
      boardId: w.board.id,
      columnId: w.todo.id,
      creatorId: w.owner.id,
    });
    for (const person of [w.suspended, w.gone]) {
      await expect(updateTask(w.actor, task.id, { title: "renamed", assigneeId: person.id })).rejects.toMatchObject({
        name: "ForbiddenError",
        message: "assignee.not_active",
      });
    }
    const row = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.assigneeId).toBeNull();
    expect(row.title).toBe(task.title);
  });

  it("a task they already hold stays readable, and can be saved around them (the unchanged assignee is not re-checked)", async () => {
    const w = await taskWorld();
    const task = await makeTask({
      orgId: w.org.id,
      workspaceId: w.ws.id,
      projectId: w.project.id,
      boardId: w.board.id,
      columnId: w.todo.id,
      creatorId: w.owner.id,
      assigneeId: w.suspended.id,
    });
    // the list is of ONE space now (it used to be the whole company's): this task's
    const listed = await listTasks(w.actor, { workspaceId: w.ws.id, limit: 10 });
    expect(listed.find((t) => t.id === task.id)?.assignee?.name).toBe("Suspended colleague");

    const saved = await updateTask(w.actor, task.id, { assigneeId: w.suspended.id, title: "still saves" });
    expect(saved.title).toBe("still saves");
    expect(saved.assigneeId).toBe(w.suspended.id);
    // moving it to somebody who is active is the way out
    const moved = await updateTask(w.actor, task.id, { assigneeId: w.active.id });
    expect(moved.assigneeId).toBe(w.active.id);
  });

  it("an active colleague is still assignable, on create and on update", async () => {
    const w = await taskWorld();
    const created = await createTask(w.actor, w.input(w.active.id));
    expect(created.assigneeId).toBe(w.active.id);
    const again = await updateTask(w.actor, created.id, { assigneeId: null });
    expect(again.assigneeId).toBeNull();
  });
});

describe("tickets: a ticket cannot be assigned to a suspended or an offboarded person", () => {
  async function ticketWorld() {
    const w = await world();
    const dept = await makeDepartment(w.org.id, {
      memberIds: [w.member.id, w.active.id, w.suspended.id, w.gone.id],
    });
    return { ...w, dept };
  }

  it("the OWNER, who may assign anybody, still cannot pick them", async () => {
    const w = await ticketWorld();
    for (const person of [w.suspended, w.gone]) {
      await expect(
        createTicket(ctxOf(w.org.id, w.owner.id, "OWNER"), w.dept.id, { title: "Printer is down", priority: "NORMAL", assigneeId: person.id }),
      ).rejects.toMatchObject({ name: "ForbiddenError", message: "assignee.not_active" });
    }
    expect(await db.ticket.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("a department member cannot pick a colleague of the department who is suspended either", async () => {
    const w = await ticketWorld();
    await expect(
      createTicket(ctxOf(w.org.id, w.member.id), w.dept.id, { title: "Printer is down", priority: "NORMAL", assigneeId: w.suspended.id }),
    ).rejects.toMatchObject({ name: "ForbiddenError", message: "assignee.not_active" });
    expect(await db.ticket.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("an ADMIN cannot hand a ticket to a person who is not in this organization at all", async () => {
    const w = await ticketWorld();
    const stranger = await makeTeam();
    await expect(
      createTicket(ctxOf(w.org.id, w.admin.id, "ADMIN"), w.dept.id, { title: "Printer is down", priority: "NORMAL", assigneeId: stranger.member.id }),
    ).rejects.toMatchObject({ name: "ForbiddenError", message: "assignee.not_member" });
    expect(await db.ticket.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("updateTicket refuses to reassign to them, but saves around an assignee who was suspended later", async () => {
    const w = await ticketWorld();
    const ticket = await makeTicket({ orgId: w.org.id, departmentId: w.dept.id, creatorId: w.member.id, assigneeId: w.active.id });
    await expect(
      updateTicket(ctxOf(w.org.id, w.admin.id, "ADMIN"), ticket.id, { assigneeId: w.gone.id }),
    ).rejects.toMatchObject({ name: "ForbiddenError", message: "assignee.not_active" });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).assigneeId).toBe(w.active.id);

    const held = await makeTicket({ orgId: w.org.id, departmentId: w.dept.id, creatorId: w.member.id, assigneeId: w.suspended.id });
    const saved = await updateTicket(ctxOf(w.org.id, w.admin.id, "ADMIN"), held.id, { assigneeId: w.suspended.id, title: "Reworded title" });
    expect(saved.assigneeId).toBe(w.suspended.id);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: held.id } })).title).toBe("Reworded title");
  });

  it("a ticket they already hold stays readable with their name on it; an active colleague is still assignable", async () => {
    const w = await ticketWorld();
    const held = await makeTicket({ orgId: w.org.id, departmentId: w.dept.id, creatorId: w.member.id, assigneeId: w.suspended.id });
    const detail = await ticketDetail(ctxOf(w.org.id, w.member.id), held.id);
    expect(detail.assignee?.name).toBe("Suspended colleague");

    const created = await createTicket(ctxOf(w.org.id, w.member.id), w.dept.id, { title: "Printer is down", priority: "NORMAL", assigneeId: w.active.id });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: created.id } })).assigneeId).toBe(w.active.id);
  });
});

describe("routines: a routine cannot be assigned to a suspended or an offboarded person, nor to a stranger", () => {
  const adminCtx = (w: { org: { id: string }; admin: { id: string } }) => ({ orgId: w.org.id, userId: w.admin.id });

  it("createRoutine refuses them and creates nothing", async () => {
    const w = await world();
    for (const person of [w.suspended, w.gone]) {
      await expect(createRoutine(adminCtx(w), { title: "Open the shop", assigneeId: person.id })).rejects.toMatchObject({
        name: "ForbiddenError",
        message: "assignee.not_active",
      });
    }
    expect(await db.routine.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("createRoutine refuses a person of another organization", async () => {
    const w = await world();
    const stranger = await makeTeam();
    await expect(createRoutine(adminCtx(w), { title: "Open the shop", assigneeId: stranger.member.id })).rejects.toMatchObject({
      name: "ForbiddenError",
      message: "assignee.not_member",
    });
    expect(await db.routine.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("updateRoutine refuses a new assignee who is out, but saves around the one who left later", async () => {
    const w = await world();
    const routine = await makeRoutine({ orgId: w.org.id, title: "Cut the fabric", assigneeId: w.active.id });
    await expect(updateRoutine(adminCtx(w), routine.id, { title: "Cut the fabric", assigneeId: w.gone.id })).rejects.toMatchObject({
      name: "ForbiddenError",
      message: "assignee.not_active",
    });
    expect((await db.routine.findUniqueOrThrow({ where: { id: routine.id } })).assigneeId).toBe(w.active.id);

    const held = await makeRoutine({ orgId: w.org.id, title: "Pack the boxes", assigneeId: w.suspended.id });
    await updateRoutine(adminCtx(w), held.id, { title: "Pack the boxes twice", assigneeId: w.suspended.id });
    const row = await db.routine.findUniqueOrThrow({ where: { id: held.id } });
    expect(row.title).toBe("Pack the boxes twice");
    expect(row.assigneeId).toBe(w.suspended.id);
  });

  it("a routine they already hold stays readable; an active colleague is still assignable", async () => {
    const w = await world();
    await makeRoutine({ orgId: w.org.id, title: "Pack the boxes", assigneeId: w.suspended.id });
    const list = await listRoutines(w.org.id);
    expect(list.map((r) => r.assigneeName)).toEqual(["Suspended colleague"]);

    const created = await createRoutine(adminCtx(w), { title: "Open the shop", assigneeId: w.active.id });
    expect((await db.routine.findUniqueOrThrow({ where: { id: created.id } })).assigneeId).toBe(w.active.id);
  });
});

describe("production and goals: a suspended or offboarded member has no role there any more", () => {
  it("orgRoleOf answers for an active member and refuses everybody else", async () => {
    const w = await world();
    await expect(orgRoleOf(w.org.id, w.admin.id)).resolves.toBe("ADMIN");
    for (const person of [w.suspended, w.gone]) {
      await expect(orgRoleOf(w.org.id, person.id)).rejects.toMatchObject({ name: "ForbiddenError", message: "not_org_member" });
    }
  });

  it("a suspended ADMIN can no longer tick a routine off", async () => {
    const w = await world();
    const routine = await makeRoutine({ orgId: w.org.id, title: "Cut the fabric" });
    await suspend(w.org.id, w.admin.id);
    await expect(setRoutineDone({ orgId: w.org.id, userId: w.admin.id }, routine.id, "2026-11-02", true)).rejects.toMatchObject({
      name: "ForbiddenError",
      message: "not_org_member",
    });
    expect(await db.routineLog.count({ where: { routineId: routine.id } })).toBe(0);
  });

  it("a suspended ADMIN can no longer create a goal or a routine", async () => {
    const w = await world();
    await suspend(w.org.id, w.admin.id);
    await expect(
      createGoal({ orgId: w.org.id, userId: w.admin.id }, { title: "Sell more", period: "WEEKLY", anchorDate: "2026-11-02" }),
    ).rejects.toMatchObject({ name: "ForbiddenError", message: "not_org_member" });
    await expect(createRoutine({ orgId: w.org.id, userId: w.admin.id }, { title: "Open the shop" })).rejects.toMatchObject({
      name: "ForbiddenError",
      message: "not_org_member",
    });
    expect(await db.goal.count({ where: { orgId: w.org.id } })).toBe(0);
    expect(await db.routine.count({ where: { orgId: w.org.id } })).toBe(0);
  });
});

describe("departments: only active people can lead or join, and only they are listed", () => {
  it("a suspended or offboarded person cannot be the lead of a new department", async () => {
    const w = await world();
    for (const person of [w.suspended, w.gone]) {
      await expect(createDepartment(ctxOf(w.org.id, w.admin.id, "ADMIN"), { name: "IT desk", leadId: person.id })).rejects.toMatchObject({
        name: "NotFoundError",
        message: "dept.lead_not_member",
      });
    }
    expect(await db.department.count({ where: { orgId: w.org.id } })).toBe(0);
  });

  it("they are not added as members, on create or later; removing one of them still works", async () => {
    const w = await world();
    const ctx = ctxOf(w.org.id, w.admin.id, "ADMIN");
    const dept = await createDepartment(ctx, { name: "IT desk", memberIds: [w.active.id, w.suspended.id, w.gone.id] });
    const rows = await db.departmentMember.findMany({ where: { departmentId: dept.id } });
    expect(rows.map((r) => r.userId)).toEqual([w.active.id]);

    await setMembers(ctx, dept.id, { addUserIds: [w.member.id, w.suspended.id, w.gone.id] });
    const after = await db.departmentMember.findMany({ where: { departmentId: dept.id } });
    expect(after.map((r) => r.userId).sort()).toEqual([w.active.id, w.member.id].sort());

    // somebody who left before being taken off the roster can still be taken off it
    await db.departmentMember.create({ data: { departmentId: dept.id, userId: w.suspended.id } });
    await setMembers(ctx, dept.id, { removeUserIds: [w.suspended.id] });
    expect(await db.departmentMember.count({ where: { departmentId: dept.id, userId: w.suspended.id } })).toBe(0);
  });

  it("old roster rows of people who are out are not listed (the list and the single department)", async () => {
    const w = await world();
    const dept = await makeDepartment(w.org.id, { memberIds: [w.active.id, w.suspended.id, w.gone.id] });
    const ctx = ctxOf(w.org.id, w.member.id);

    const list = await listDepartments(ctx);
    expect(list.find((d) => d.id === dept.id)?.members.map((m) => m.name)).toEqual(["Active colleague"]);

    const one = await getDepartment(ctx, dept.id);
    expect(one.members.map((m) => m.name)).toEqual(["Active colleague"]);
  });
});
