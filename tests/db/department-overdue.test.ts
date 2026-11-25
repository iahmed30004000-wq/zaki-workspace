import { describe, expect, it } from "vitest";
import { listDepartments } from "@/server/services/departments";
import { resolveTimeZone, zonedDayStart } from "@/lib/zoned-time";
import { db, makeProject, makeTask, makeTeam, makeWorkspace } from "./helpers";
import { actorOf } from "./today-helpers";

/**
 * «متأخر» in the departments list is a COMPANY day, like everywhere else (Phase B of the review).
 *
 * `loadAnalytics`, My Work, the Today page and «كل المساحات» all compare a due date with the START
 * of the company's today (`zonedDayStart`, `Organization.timezone`). `listDepartments` compared it
 * with the machine's wall clock instead: a task due at 09:00 today showed as «متأخرة» at noon, so
 * one screen and the next disagreed about the same task, and the number moved with the server's
 * clock rather than with the work.
 *
 * The service takes `now` so the test can pin the day (the same shape as `loadAnalytics`).
 */

const ZONE = "Asia/Damascus";
const DAY = 24 * 3600 * 1000;

async function departmentWorld(now: Date) {
  const team = await makeTeam();
  await db.organization.update({ where: { id: team.org.id }, data: { timezone: ZONE } });
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }], "مساحة القسم");
  const made = await makeProject(ws.id, "مشروع القسم");
  const dept = await db.department.create({ data: { orgId: team.org.id, name: "قسم", color: "#123456" } });
  await db.project.update({ where: { id: made.project.id }, data: { departmentId: dept.id } });
  const dayStart = zonedDayStart(now, resolveTimeZone(ZONE));
  const task = (due: Date, title: string) =>
    makeTask({
      orgId: team.org.id,
      workspaceId: ws.id,
      projectId: made.project.id,
      boardId: made.board.id,
      columnId: made.todo.id,
      creatorId: team.owner.id,
      dueDate: due,
      title,
    });
  return { ...team, ws, made, dept, dayStart, task };
}

describe("a department's «متأخرة» is the company's day, not the server's clock", () => {
  it("a task due later today is not overdue; one due before today began is", async () => {
    // two days back, so the OLD code (which read the real clock) cannot pass this by luck
    const now = new Date(Date.now() - 2 * DAY);
    const w = await departmentWorld(now);
    const dueToday = await w.task(new Date(w.dayStart.getTime() + 12 * 3600 * 1000), "مستحقة اليوم"); // noon: the whole day
    await w.task(new Date(w.dayStart.getTime() - 3600 * 1000), "فات موعدها أمس");

    const actor = await actorOf(w.owner.id);
    const [card] = await listDepartments({ orgId: actor.orgId, orgRole: actor.role, userId: actor.userId }, now);
    if (!card) throw new Error("the department is missing from its own list");

    expect(card.overdueTasks, "a task due within the company's today is not late").toBe(1);
    expect(card.openTasks).toBe(2);
    expect(card.id).toBe(w.dept.id);

    // the one that is late is the one from yesterday: the count is not a coincidence of two numbers
    const late = await db.task.findMany({
      where: { id: { not: dueToday.id }, project: { departmentId: w.dept.id } },
      select: { dueDate: true },
    });
    expect(late[0]?.dueDate?.getTime()).toBeLessThan(w.dayStart.getTime());
  });

  it("a finished task is never counted late, whenever it was due", async () => {
    const now = new Date(Date.now() - 2 * DAY);
    const w = await departmentWorld(now);
    const task = await w.task(new Date(w.dayStart.getTime() - 5 * DAY), "أُنجزت متأخرة");
    await db.task.update({ where: { id: task.id }, data: { columnId: w.made.done.id, completedAt: new Date() } });

    const actor = await actorOf(w.owner.id);
    const [card] = await listDepartments({ orgId: actor.orgId, orgRole: actor.role, userId: actor.userId }, now);
    if (!card) throw new Error("the department is missing from its own list");
    expect(card.overdueTasks).toBe(0);
    expect(card.openTasks).toBe(0);
  });
});
