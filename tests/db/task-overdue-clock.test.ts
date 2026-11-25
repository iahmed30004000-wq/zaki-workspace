import { describe, expect, it } from "vitest";
import { listTasks } from "@/server/services/tasks";
import { queryTasksForView } from "@/server/services/views";
import { getMyWork } from "@/server/services/my-work";
import { put, todayFor, world as todayWorld } from "./today-helpers";

/**
 * B6 (Phase B review, fixed in Phase E): «متأخرة» is one question with one answer.
 *
 * My Work, the Today page and the reports measure a task against the START of the company's today
 * (`Organization.timezone`). Two other paths measured against the server's wall clock — the list
 * route's `?overdue=true` and the views query's fallback when a caller forgot the line — so the same
 * task due at 09:00 today was "today" on one screen and "overdue" on the next after noon.
 */
describe("overdue is the company's day on every path, not the wall clock", () => {
  it("a whole-day task of today is not overdue at 15:00 — the list, the views, My Work and Today agree", async () => {
    const w = await todayWorld("Asia/Damascus");
    const now = new Date("2026-03-16T12:00:00Z"); // 15:00 on the 16th in Damascus
    const dueToday = await put(w, "in", { assigneeId: w.member.id, due: new Date("2026-03-16T09:00:00Z") }); // the 16th, no hour picked (noon)
    const dueYesterday = await put(w, "in", { assigneeId: w.member.id, due: new Date("2026-03-15T06:00:00Z") }); // 09:00 the 15th
    const actor = { userId: w.member.id, orgId: w.org.id };

    const listed = await listTasks(actor, { workspaceId: w.wsIn.id, overdue: true, limit: 50, now });
    expect(listed.map((t) => t.id)).toEqual([dueYesterday.id]);

    // no line given: the views query reads the company's own line instead of "this very moment"
    const viewed = await queryTasksForView({ orgId: w.org.id, workspaceIds: [w.wsIn.id], overdueOnly: true, now });
    expect(viewed.map((t) => t.id)).toEqual([dueYesterday.id]);

    const myWork = await getMyWork(w.member.id, now);
    expect(myWork.overdue.map((r) => r.task.id)).toEqual([dueYesterday.id]);
    expect(myWork.today.map((r) => r.task.id)).toEqual([dueToday.id]);

    const today = await todayFor(w.member.id, now);
    expect(today.tasks.overdue.map((t) => t.id)).toEqual([dueYesterday.id]);
  });

  it("the line is the company's zone, not the server's: before midnight in New York the task due that morning is still today", async () => {
    const w = await todayWorld("America/New_York");
    // 02:00 UTC on the 16th is 22:00 on the 15th in New York, and already 08:00 on the 16th in Damascus
    const now = new Date("2026-03-16T02:00:00Z");
    const dueThisMorning = await put(w, "in", {
      assigneeId: w.member.id,
      due: new Date("2026-03-16T13:00:00Z"), // 09:00 on the 16th in New York
    });
    const actor = { userId: w.member.id, orgId: w.org.id };
    const listed = await listTasks(actor, { workspaceId: w.wsIn.id, overdue: true, limit: 50, now });
    expect(listed.map((t) => t.id)).not.toContain(dueThisMorning.id);
    const viewed = await queryTasksForView({ orgId: w.org.id, workspaceIds: [w.wsIn.id], overdueOnly: true, now });
    expect(viewed.map((t) => t.id)).not.toContain(dueThisMorning.id);
  });
});
