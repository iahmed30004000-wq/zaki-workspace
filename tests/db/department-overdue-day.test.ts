import { describe, expect, it } from "vitest";
import { listDepartments } from "@/server/services/departments";
import { db, makeProject, makeTask, makeTeam, makeWorkspace } from "./helpers";
import { makeDepartment } from "./guest-helpers";
import { setZone } from "./today-helpers";

/**
 * B6 (Phase B review, fixed in Phase E), second half: the «متأخرة» counter on a department card is the
 * same question as everywhere else — due strictly before the START of the company's today. It used to
 * compare with the server's wall clock, so a task due at 09:00 was late on this card at 15:00 and not
 * late on My Work, and the number moved with the container's clock.
 */

/** The card the department's own people see, read as one of them at a fixed moment. */
async function card(w: { orgId: string; deptId: string; viewerId: string; now: Date }) {
  const listed = await listDepartments({ orgId: w.orgId, orgRole: "MEMBER", userId: w.viewerId }, w.now);
  return listed.find((d) => d.id === w.deptId);
}

async function world(timezone: string) {
  const team = await makeTeam();
  await setZone(team.org.id, timezone);
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }], "مساحة الفريق");
  const dept = await makeDepartment(team.org.id, { memberIds: [team.member.id] });
  const made = await makeProject(ws.id, "مشروع القسم");
  await db.project.update({ where: { id: made.project.id }, data: { departmentId: dept.id } });
  const due = (iso: string) =>
    makeTask({
      orgId: team.org.id,
      workspaceId: ws.id,
      projectId: made.project.id,
      boardId: made.board.id,
      columnId: made.todo.id,
      creatorId: team.owner.id,
      dueDate: new Date(iso),
    });
  return { orgId: team.org.id, deptId: dept.id, viewerId: team.member.id, due };
}

describe("a department's «متأخرة» is the company's day", () => {
  it("at 15:00 a whole-day task of today is not late; yesterday's is", async () => {
    const w = await world("Asia/Damascus");
    await w.due("2026-03-16T09:00:00Z"); // today in Damascus, no hour picked (noon = the whole day)
    await w.due("2026-03-15T06:00:00Z"); // 09:00 yesterday
    const row = await card({ ...w, now: new Date("2026-03-16T12:00:00Z") }); // 15:00 on the 16th in Damascus
    expect(row?.overdueTasks).toBe(1);
    expect(row?.openTasks).toBe(2);
  });

  it("the line is the start of the company's today, not the moment asked: before midnight in Damascus a task due 23:00 tonight is not late", async () => {
    const w = await world("Asia/Damascus");
    await w.due("2026-03-15T21:00:00Z"); // 23:00 on the 15th in Damascus, two hours ahead
    const row = await card({ ...w, now: new Date("2026-03-15T19:00:00Z") }); // 22:00 on the 15th there
    expect(row?.overdueTasks).toBe(0);
  });

  it("the same instant in a company behind UTC: that task is still today there, so nothing is late", async () => {
    const w = await world("America/New_York");
    await w.due("2026-03-15T16:00:00Z"); // the whole of the 15th in New York (noon there)
    // 22:30 UTC on the 15th is 18:30 in New York: a whole-day task is not late until the day ends
    const row = await card({ ...w, now: new Date("2026-03-15T22:30:00Z") });
    expect(row?.overdueTasks).toBe(0);
  });
});
