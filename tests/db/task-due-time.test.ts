import { describe, expect, it } from "vitest";
import { createTask, listTasks } from "@/server/services/tasks";
import { dueWallOfInstant } from "@/lib/due-day";
import * as tasksRoute from "@/app/api/tasks/route";
import * as recurrenceRoute from "@/app/api/tasks/[id]/recurrence/route";
import { fireDueRecurrences } from "@/server/jobs/recurrence";
import { call, loginAs } from "./helpers";
import { put, setZone, todayFor, world as todayWorld } from "./today-helpers";
import { db } from "./helpers";

/** Day and hour for a due date, and the default «today at 18:00» for a task created without one (the owner, 2026-11-25). */
const ZONE = "Asia/Amman";

async function world() {
  const w = await todayWorld(ZONE);
  await setZone(w.org.id, ZONE);
  const actor = { userId: w.member.id, orgId: w.org.id };
  const where = { workspaceId: w.wsIn.id, projectId: w.inside.project.id, boardId: w.inside.board.id };
  const dueOf = async (id: string) => {
    const row = await db.task.findUniqueOrThrow({ where: { id }, select: { dueDate: true } });
    return row.dueDate ? dueWallOfInstant(row.dueDate, ZONE) : null;
  };
  const today = () => dueWallOfInstant(new Date(), ZONE).slice(0, 10);
  return { ...w, actor, where, dueOf, today };
}

const settings = (orgId: string, value: Record<string, unknown>) => db.organization.update({ where: { id: orgId }, data: { settings: value as never } });

describe("a new task with no date", () => {
  it("is due today at 18:00 in the company's zone; an explicit null stays «بدون موعد»; a named date is kept", async () => {
    const w = await world();
    const day = w.today();
    const bare = await createTask(w.actor, { ...w.where, title: "بدون ما أختار" });
    expect(await w.dueOf(bare.id)).toBe(`${day}T18:00`);
    const none = await createTask(w.actor, { ...w.where, title: "بدون موعد", dueDate: null });
    expect(await w.dueOf(none.id)).toBeNull();
    const named = await createTask(w.actor, { ...w.where, title: "بموعد", dueDate: new Date("2027-01-05T07:30:00Z") });
    expect(await w.dueOf(named.id)).toBe("2027-01-05T10:30");
  });

  it("follows the company's own hour, and «no default» means none", async () => {
    const w = await world();
    await settings(w.org.id, { defaultDueHour: 9 });
    expect(await w.dueOf((await createTask(w.actor, { ...w.where, title: "تسعة" })).id)).toBe(`${w.today()}T09:00`);
    await settings(w.org.id, { defaultDueHour: null });
    expect(await w.dueOf((await createTask(w.actor, { ...w.where, title: "ولا إشي" })).id)).toBeNull();
  });

  it("through the route: absent is the default, null is none, a day and an hour is the company's wall clock", async () => {
    const w = await world();
    await loginAs(w.member.id);
    const make = async (extra: Record<string, unknown>) => {
      const res = await call(tasksRoute.POST, { body: { ...w.where, title: "من الشاشة", ...extra } });
      expect(res.status).toBe(201);
      return w.dueOf((res.json as unknown as { task: { id: string } }).task.id);
    };
    expect(await make({})).toBe(`${w.today()}T18:00`);
    expect(await make({ dueDate: null })).toBeNull();
    expect(await make({ dueDate: "2027-01-05T16:45" })).toBe("2027-01-05T16:45");
    expect(await make({ dueDate: "2027-01-05" })).toBe("2027-01-05T12:00");
    const bad = await call(tasksRoute.POST, { body: { ...w.where, title: "غلط", dueDate: "2027-13-05T16:45" } });
    expect(bad.status).toBe(422);
  });
});

describe("late means the hour has passed", () => {
  it("at 19:00 a task due 18:00 is late on the list and on «اليوم», and one due 21:00 is still today's", async () => {
    const w = await world();
    const at = (wall: string) => new Date(`${wall}:00+03:00`);
    const passed = await put(w, "in", { assigneeId: w.member.id, due: at("2026-11-25T18:00") });
    const ahead = await put(w, "in", { assigneeId: w.member.id, due: at("2026-11-25T21:00") });
    const wholeDay = await put(w, "in", { assigneeId: w.member.id, due: at("2026-11-25T12:00") });
    const now = at("2026-11-25T19:00");
    const late = await listTasks(w.actor, { workspaceId: w.wsIn.id, overdue: true, limit: 50, now });
    expect(late.map((t) => t.id)).toEqual([passed.id]);
    const today = await todayFor(w.member.id, now);
    expect(today.tasks.overdue.map((t) => t.id)).toEqual([passed.id]);
    expect(today.tasks.today.map((t) => t.id).sort()).toEqual([ahead.id, wholeDay.id].sort());
    expect(today.tasks.counts).toMatchObject({ overdue: 1, today: 2 });
  });
});

describe("a repeating task with an hour", () => {
  it("appears when its day begins, due at the hour, so it is never born late; a second run adds nothing", async () => {
    const w = await world();
    await db.taskRecurrence.deleteMany({});
    const day = (n: number) => dueWallOfInstant(new Date(Date.now() + n * 86_400_000), ZONE).slice(0, 10);
    const at = (wall: string) => new Date(`${wall}:00+03:00`);
    const template = await createTask(w.actor, { ...w.where, title: "روتين", dueDate: at(`${day(1)}T18:00`) });
    await loginAs(w.member.id);
    const set = await call(recurrenceRoute.PUT, { method: "PUT", params: { id: template.id }, body: { rule: { kind: "DAILY" }, mode: "SCHEDULE", endsOn: null } });
    expect(set.status).toBeLessThan(300);
    const made = () => db.task.findMany({ where: { recurrenceId: { not: null }, id: { not: template.id }, orgId: w.org.id }, select: { id: true, dueDate: true } });

    await fireDueRecurrences(at(`${day(1)}T23:30`)); // the evening before the next one's day
    expect(await made()).toHaveLength(0);
    await fireDueRecurrences(at(`${day(2)}T00:05`));
    const first = await made();
    expect(first.map((t) => dueWallOfInstant(t.dueDate!, ZONE))).toEqual([`${day(2)}T18:00`]);
    await fireDueRecurrences(at(`${day(2)}T00:10`));
    await fireDueRecurrences(at(`${day(2)}T18:30`));
    expect(await made()).toHaveLength(1);
  });
});
