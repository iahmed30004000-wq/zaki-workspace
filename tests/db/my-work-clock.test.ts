import { describe, expect, it } from "vitest";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { loadAnalytics } from "@/server/services/analytics";
import { getMyWork } from "@/server/services/my-work";
import { db, makeProject, makeTask, makeTeam, makeWorkspace } from "./helpers";
import { put, todayFor, world as todayWorld } from "./today-helpers";

/**
 * "Today" is the company's day (Organization.timezone), not the clock of the server it runs on:
 * a server on UTC is three hours behind Damascus, and for those hours My Work and the Today page
 * used to disagree.
 */
describe("My Work follows the company's day", () => {
  async function world(timezone: string) {
    const team = await makeTeam();
    await db.organization.update({ where: { id: team.org.id }, data: { timezone } });
    const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
    const { project, board, todo } = await makeProject(ws.id);
    const due = (iso: string) =>
      makeTask({
        orgId: team.org.id,
        workspaceId: ws.id,
        projectId: project.id,
        boardId: board.id,
        columnId: todo.id,
        creatorId: team.owner.id,
        assigneeId: team.member.id,
        dueDate: new Date(iso),
      });
    return { team, due };
  }

  it("a task due at 10:00 Damascus time on the 16th is TODAY at 00:30 on the 16th there (21:30 UTC on the 15th)", async () => {
    const { team, due } = await world("Asia/Damascus");
    const task = await due("2026-03-16T07:00:00Z"); // 10:00 in Damascus
    const data = await getMyWork(team.member.id, new Date("2026-03-15T21:30:00Z"));
    expect(data.today.map((r) => r.task.id)).toContain(task.id);
    expect(data.upcoming.map((r) => r.task.id)).not.toContain(task.id);
    expect(data.overdue.map((r) => r.task.id)).not.toContain(task.id);
  });

  it("at 15:00 there on the 16th (12:00 UTC) a whole-day task is still TODAY and NOT overdue, and one whose hour was 10:00 is overdue", async () => {
    const { team, due } = await world("Asia/Damascus");
    const timed = await due("2026-03-16T07:00:00Z"); // 10:00 in Damascus, five hours before `now`
    expect((await getMyWork(team.member.id, new Date("2026-03-16T12:00:00Z"))).overdue.map((r) => r.task.id)).toContain(timed.id);
    const task = await due("2026-03-16T09:00:00Z"); // no hour picked: noon
    const data = await getMyWork(team.member.id, new Date("2026-03-16T12:00:00Z"));
    expect(data.today.map((r) => r.task.id)).toContain(task.id);
    expect(data.overdue.map((r) => r.task.id)).not.toContain(task.id);
    expect(data.upcoming.map((r) => r.task.id)).not.toContain(task.id);
  });

  it("at the same moment a task due on the 15th (13:00 Damascus time) is overdue, and only overdue", async () => {
    const { team, due } = await world("Asia/Damascus");
    const task = await due("2026-03-15T10:00:00Z");
    const data = await getMyWork(team.member.id, new Date("2026-03-16T12:00:00Z"));
    expect(data.overdue.map((r) => r.task.id)).toContain(task.id);
    expect(data.today.map((r) => r.task.id)).not.toContain(task.id);
    expect(data.upcoming.map((r) => r.task.id)).not.toContain(task.id);
  });

  it("the same instant is still the 15th in a company behind UTC, so that task is upcoming there", async () => {
    const { team, due } = await world("America/New_York");
    const task = await due("2026-03-16T07:00:00Z");
    const data = await getMyWork(team.member.id, new Date("2026-03-15T21:30:00Z"));
    expect(data.upcoming.map((r) => r.task.id)).toContain(task.id);
    expect(data.today.map((r) => r.task.id)).not.toContain(task.id);
  });
});

/**
 * "Overdue" is one line for every screen (src/lib/due-day.ts): a whole-day task is late once its day ends, a task with an hour once the hour passes (the
 * owner, 2026-11-25). Never in two groups at once.
 */
describe("one line between today and overdue: My Work, Today and Analytics agree", () => {
  it("at 15:00 on its due day a whole-day task is today and not overdue in all three, and yesterday's task is overdue in all three", async () => {
    const w = await todayWorld("Asia/Damascus");
    const now = new Date("2026-03-16T12:00:00Z"); // 15:00 on the 16th in Damascus
    const dueToday = await put(w, "in", { assigneeId: w.member.id, due: new Date("2026-03-16T09:00:00Z") }); // the 16th, no hour picked
    const dueYesterday = await put(w, "in", { assigneeId: w.member.id, due: new Date("2026-03-15T06:00:00Z") }); // 09:00 on the 15th

    const myWork = await getMyWork(w.member.id, now);
    expect(myWork.today.map((r) => r.task.id)).toEqual([dueToday.id]);
    expect(myWork.overdue.map((r) => r.task.id)).toEqual([dueYesterday.id]);

    const today = await todayFor(w.member.id, now);
    expect(today.tasks.today.map((t) => t.id)).toEqual([dueToday.id]);
    expect(today.tasks.overdue.map((t) => t.id)).toEqual([dueYesterday.id]);

    const report = await loadAnalytics(w.org.id, await accessibleWorkspaceIds(w.member.id), now);
    expect(report.overdue).toBe(1); // yesterday's task only
    expect(report.upcoming7).toBe(1); // today's task is due within the coming week, not overdue
  });
});
