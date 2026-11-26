/**
 * «روتين يومي» — ask 7 of the owner's tasks prompt (2026-11-25): a task template that makes a fresh card each day at a set
 * time for its person (every day, the working days, or chosen days). Pausing never deletes a card already made.
 *
 * The promise this file pins hardest: EXACTLY ONE card per routine per company day, whatever retries, overlaps, edits,
 * pauses and resumes happen. The database holds it (one row per routine and day), not only the clock.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as routinesRoute from "@/app/api/daily-routines/route";
import * as routineRoute from "@/app/api/daily-routines/[id]/route";
import { withFeature } from "@/lib/features";
import { dayOfInstant } from "@/lib/due-day";
import { zonedParts, zonedWallTime } from "@/lib/zoned-time";
import { runDueJobs } from "@/server/jobs/run";
import { fireDueRoutines } from "@/server/jobs/daily-routines";
import { flushPushesForTests } from "@/server/notify";
import { call, db, loginAs, makeProject, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { suspend } from "./active-helpers";

const ZONE = "Asia/Damascus";
const DAY = 24 * 3600_000;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const WORKING_DAYS = [0, 1, 2, 3, 4];

// the runner works on every company's routines and the test database is shared by the whole file
beforeEach(async () => {
  await db.dailyRoutine.deleteMany({});
});

async function world() {
  const team = await makeTeam();
  const mate = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "زميل" });
  const lead = await makeUser({ orgId: team.org.id, role: "LEAD", name: "قائد" });
  const stranger = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "غريب" });
  const ws = await makeWorkspace(
    team.org.id,
    [{ userId: team.member.id }, { userId: mate.id }, { userId: lead.id }, { userId: team.admin.id, role: "ADMIN" }, { userId: team.guest.id, role: "GUEST" }],
    "العمل",
  );
  const made = await makeProject(ws.id, "متابعة");
  return { ...team, mate, lead, stranger, ws, made };
}
type World = Awaited<ReturnType<typeof world>>;

type Routine = {
  id: string;
  title: string;
  days: number[];
  time: string;
  dueTime: string;
  active: boolean;
  stoppedReason: string | null;
  nextRunAt: string | null;
  assignee: { id: string; name: string };
  canManage: boolean;
};

const body = (w: World, over: Record<string, unknown> = {}) => ({
  workspaceId: w.ws.id,
  projectId: w.made.project.id,
  title: "تقرير الصبح",
  description: "أرقام مبارح",
  assigneeId: w.mate.id,
  days: ALL_DAYS,
  time: "08:00",
  dueTime: "18:00",
  ...over,
});
const post = (w: World, over: Record<string, unknown> = {}) => call(routinesRoute.POST, { body: body(w, over) });
const list = () => call(routinesRoute.GET, {});
const patch = (id: string, payload: Record<string, unknown>) => call(routineRoute.PATCH, { method: "PATCH", params: { id }, body: payload });
const routineOf = (res: { json: Record<string, unknown> | null }) => res.json?.["routine"] as Routine;
const listed = (res: { json: Record<string, unknown> | null }) => (res.json?.["routines"] as Routine[]).map((r) => r.id);

/** Made by `by` (the space's admin unless said), through the real door. */
async function routine(w: World, over: Record<string, unknown> = {}, by: string = w.admin.id) {
  await loginAs(by);
  const res = await post(w, over);
  expect(res.status, res.text).toBe(201);
  return routineOf(res);
}

const cards = (w: World) =>
  db.task.findMany({ where: { projectId: w.made.project.id }, orderBy: [{ dueDate: "asc" }, { id: "asc" }] });
const rowOf = (id: string) => db.dailyRoutine.findUniqueOrThrow({ where: { id } });
const plus = (at: string | Date, ms = 60_000) => new Date(new Date(at).getTime() + ms);
/** `hour:00` on the company's clock, `days` company days after the day of `at`. */
function clock(at: string | Date, days: number, hour: number): Date {
  const p = zonedParts(new Date(new Date(at).getTime() + days * DAY), ZONE);
  return zonedWallTime({ year: p.year, month: p.month, day: p.day, hour }, ZONE);
}
const weekdayOf = (at: Date) => {
  const p = zonedParts(at, ZONE);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
};

async function setSwitch(orgId: string, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "recurringTasks", on) as Prisma.InputJsonValue } });
}

describe("making a routine", () => {
  it("is saved with its first time still ahead, and makes no card by itself", async () => {
    const w = await world();
    const before = Date.now();
    const made = await routine(w);
    expect(made).toMatchObject({ title: "تقرير الصبح", days: ALL_DAYS, time: "08:00", dueTime: "18:00", active: true, stoppedReason: null });
    expect(made.assignee.id).toBe(w.mate.id);
    const next = new Date(made.nextRunAt!);
    expect(next.getTime()).toBeGreaterThan(before);
    expect(next.getTime()).toBeLessThanOrEqual(before + DAY + 3600_000);
    expect(zonedParts(next, ZONE)).toMatchObject({ hour: 8, minute: 0 });
    expect(await cards(w)).toHaveLength(0);
  });

  it("refuses a bad shape: no day, no title, or a deadline that is not after the time the card appears", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    expect((await post(w, { days: [] })).status).toBe(422);
    expect((await post(w, { title: "  " })).status).toBe(422);
    expect((await post(w, { time: "18:00", dueTime: "18:00" })).status).toBe(422);
    expect((await post(w, { time: "25:00" })).status).toBe(422);
    expect(await db.dailyRoutine.count()).toBe(0);
  });
});

describe("the card of the day", () => {
  it("appears at its time, for its person, due the same day at the deadline", async () => {
    const w = await world();
    const made = await routine(w);
    await fireDueRoutines(plus(made.nextRunAt!, -120_000));
    expect(await cards(w)).toHaveLength(0);
    const run = await runDueJobs(plus(made.nextRunAt!));
    expect(run.dailyRoutines?.created).toBe(1);
    const [card] = await cards(w);
    expect(card).toMatchObject({ title: "تقرير الصبح", description: "أرقام مبارح", assigneeId: w.mate.id, creatorId: w.admin.id, columnId: w.made.todo.id });
    expect(card!.dueDate!.toISOString()).toBe(clock(made.nextRunAt!, 0, 18).toISOString());
    expect(new Date((await rowOf(made.id)).nextRunAt!).toISOString()).toBe(clock(made.nextRunAt!, 1, 8).toISOString());
    await flushPushesForTests();
    expect(await db.notification.count({ where: { userId: w.mate.id } })).toBeGreaterThan(0);
  });

  it("is one only: two runs at the same moment, later runs of the same day, and a retry that finds the old time again", async () => {
    const w = await world();
    const made = await routine(w);
    const at = plus(made.nextRunAt!);
    await Promise.all([fireDueRoutines(at), fireDueRoutines(at), runDueJobs(at)]);
    await fireDueRoutines(plus(at, 3600_000));
    expect(await cards(w)).toHaveLength(1);
    // as if the step that moves the time forward had been lost
    await db.dailyRoutine.update({ where: { id: made.id }, data: { nextRunAt: new Date(made.nextRunAt!) } });
    await fireDueRoutines(plus(at, 7200_000));
    expect(await cards(w)).toHaveLength(1);
    expect(await db.dailyRoutineRun.count({ where: { routineId: made.id } })).toBe(1);
  });

  it("is not made again when the person deletes it or finishes it that day", async () => {
    const w = await world();
    const made = await routine(w);
    await fireDueRoutines(plus(made.nextRunAt!));
    await db.task.deleteMany({ where: { projectId: w.made.project.id } });
    await db.dailyRoutine.update({ where: { id: made.id }, data: { nextRunAt: new Date(made.nextRunAt!) } });
    await fireDueRoutines(plus(made.nextRunAt!, 7200_000));
    expect(await cards(w)).toHaveLength(0);
  });

  it("is fresh each day, also while yesterday's is still open", async () => {
    const w = await world();
    const made = await routine(w);
    for (let i = 0; i < 3; i++) await fireDueRoutines(clock(made.nextRunAt!, i, 9));
    const all = await cards(w);
    expect(all).toHaveLength(3);
    expect(new Set(all.map((c) => dayOfInstant(c.dueDate!, ZONE))).size).toBe(3);
  });

  it("follows the chosen days: the working days skip Friday and Saturday; a single day comes once a week", async () => {
    const w = await world();
    const working = await routine(w, { days: WORKING_DAYS, title: "دوام" });
    const once = await routine(w, { days: [3], title: "أسبوعي" });
    const from = new Date();
    for (let i = 1; i <= 14; i++) await fireDueRoutines(clock(from, i, 23));
    const all = await cards(w);
    const of = (title: string) => all.filter((c) => c.title === title);
    expect(of("دوام")).toHaveLength(10);
    expect(of("دوام").every((c) => WORKING_DAYS.includes(weekdayOf(c.dueDate!)))).toBe(true);
    expect(of("أسبوعي")).toHaveLength(2);
    expect(of("أسبوعي").every((c) => weekdayOf(c.dueDate!) === 3)).toBe(true);
    expect([working.id, once.id]).toHaveLength(2);
  });

  it("after the server was away for days, makes today's card only, and none for the days missed", async () => {
    const w = await world();
    const made = await routine(w);
    // back at 07:00, before today's time: nothing yet
    await fireDueRoutines(clock(made.nextRunAt!, 4, 7));
    expect(await cards(w)).toHaveLength(0);
    await fireDueRoutines(clock(made.nextRunAt!, 4, 10));
    const all = await cards(w);
    expect(all).toHaveLength(1);
    expect(dayOfInstant(all[0]!.dueDate!, ZONE)).toBe(dayOfInstant(clock(made.nextRunAt!, 4, 10), ZONE));
  });
});

describe("pause, resume and edit", () => {
  it("pausing keeps every card already made and makes none; resuming starts from the next time, with nothing made up", async () => {
    const w = await world();
    const made = await routine(w);
    await fireDueRoutines(plus(made.nextRunAt!));
    const paused = await patch(made.id, { action: "pause" });
    expect(paused.status, paused.text).toBe(200);
    expect(routineOf(paused)).toMatchObject({ active: false, nextRunAt: null });
    for (let i = 1; i <= 3; i++) await fireDueRoutines(clock(made.nextRunAt!, i, 9));
    expect(await cards(w)).toHaveLength(1);

    const resumed = await patch(made.id, { action: "resume" });
    expect(resumed.status, resumed.text).toBe(200);
    expect(routineOf(resumed).active).toBe(true);
    expect(new Date(routineOf(resumed).nextRunAt!).getTime()).toBeGreaterThan(Date.now());
    expect(await cards(w)).toHaveLength(1);
  });

  it("never gives a second card the same day: after pause and resume, or after the time is moved later", async () => {
    const w = await world();
    const made = await routine(w);
    const day = made.nextRunAt!;
    await fireDueRoutines(plus(day));
    await patch(made.id, { action: "pause" });
    await patch(made.id, { action: "resume" });
    const edited = await patch(made.id, { ...body(w, { time: "10:00" }) });
    expect(edited.status, edited.text).toBe(200);
    expect(routineOf(edited)).toMatchObject({ time: "10:00", active: true });
    await db.dailyRoutine.update({ where: { id: made.id }, data: { nextRunAt: clock(day, 0, 10) } });
    await fireDueRoutines(clock(day, 0, 11));
    expect(await cards(w)).toHaveLength(1);
  });

  it("an edit changes the next cards, not the ones already made; a paused routine stays paused", async () => {
    const w = await world();
    const made = await routine(w);
    await fireDueRoutines(plus(made.nextRunAt!));
    await patch(made.id, { action: "pause" });
    const edited = await patch(made.id, { ...body(w, { title: "تقرير المسا", assigneeId: w.member.id }) });
    expect(routineOf(edited)).toMatchObject({ title: "تقرير المسا", active: false });
    await patch(made.id, { action: "resume" });
    await fireDueRoutines(plus((await rowOf(made.id)).nextRunAt!));
    await fireDueRoutines(clock(made.nextRunAt!, 2, 9));
    const all = await cards(w);
    expect(all.map((c) => c.title).sort()).toContain("تقرير المسا");
    expect(all.find((c) => c.title === "تقرير الصبح")!.assigneeId).toBe(w.mate.id);
    expect(all.find((c) => c.title === "تقرير المسا")!.assigneeId).toBe(w.member.id);
  });
});

describe("who may do what", () => {
  it("a partner from outside and somebody outside the space can make nothing there", async () => {
    const w = await world();
    for (const userId of [w.guest.id, w.stranger.id]) {
      await loginAs(userId);
      const res = await post(w);
      expect([403, 404]).toContain(res.status);
    }
    expect(await db.dailyRoutine.count()).toBe(0);
  });

  it("the person must be of the space, and not somebody above the maker (they would only be asked, every day)", async () => {
    const w = await world();
    await loginAs(w.admin.id);
    expect((await post(w, { assigneeId: w.stranger.id })).status).toBe(403);
    await loginAs(w.member.id);
    expect((await post(w, { assigneeId: w.lead.id })).status).toBe(403);
    expect((await post(w, { assigneeId: w.member.id })).status).toBe(201);
  });

  it("the project must be of the space named", async () => {
    const w = await world();
    const other = await makeWorkspace(w.org.id, [{ userId: w.admin.id, role: "ADMIN" }], "التصنيع");
    const there = await makeProject(other.id, "تاني");
    await loginAs(w.admin.id);
    expect((await post(w, { projectId: there.project.id })).status).toBe(404);
  });

  it("a manager of the space sees and manages all of its routines; anybody else only what they made or what is theirs", async () => {
    const w = await world();
    const forMate = await routine(w, {}, w.admin.id);
    const own = await routine(w, { assigneeId: w.member.id, title: "تبعي" }, w.member.id);

    await loginAs(w.admin.id);
    expect(listed(await list()).sort()).toEqual([forMate.id, own.id].sort());
    await loginAs(w.mate.id);
    const mine = await list();
    expect(listed(mine)).toEqual([forMate.id]);
    expect((mine.json!["routines"] as Routine[])[0]!.canManage).toBe(false);
    expect((await patch(forMate.id, { action: "pause" })).status).toBe(403);
    expect((await patch(own.id, { action: "pause" })).status).toBe(404);
    await loginAs(w.stranger.id);
    expect(listed(await list())).toEqual([]);
    expect((await patch(forMate.id, { action: "pause" })).status).toBe(404);
    await loginAs(w.admin.id);
    expect((await patch(own.id, { action: "pause" })).status).toBe(200);
  });

  it("offers only the spaces, projects and people the person may use", async () => {
    const w = await world();
    await makeWorkspace(w.org.id, [{ userId: w.admin.id, role: "ADMIN" }], "سرية");
    await loginAs(w.member.id);
    const res = await list();
    const spaces = res.json!["spaces"] as { id: string; projects: { id: string }[]; people: { id: string }[] }[];
    expect(spaces.map((s) => s.id)).toEqual([w.ws.id]);
    expect(spaces[0]!.projects.map((p) => p.id)).toEqual([w.made.project.id]);
    const people = spaces[0]!.people.map((p) => p.id);
    expect(people).toContain(w.member.id);
    expect(people).toContain(w.mate.id);
    expect(people).not.toContain(w.lead.id);
    expect(people).not.toContain(w.stranger.id);
    expect(people).not.toContain(w.guest.id);
  });
});

describe("when it cannot go on", () => {
  it.each([
    ["its person was stopped", "ASSIGNEE_INACTIVE", (w: World) => suspend(w.org.id, w.mate.id)],
    ["its person left the space", "ASSIGNEE_INACTIVE", (w: World) => db.workspaceMember.deleteMany({ where: { workspaceId: w.ws.id, userId: w.mate.id } })],
    ["its maker was stopped", "CREATOR_INACTIVE", (w: World) => suspend(w.org.id, w.admin.id)],
    ["its project was archived", "ARCHIVED", (w: World) => db.project.update({ where: { id: w.made.project.id }, data: { status: "ARCHIVED" } })],
    ["its maker was taken off the space", "FAILED", (w: World) => db.workspaceMember.deleteMany({ where: { workspaceId: w.ws.id, userId: w.admin.id } })],
    ["its maker may no longer make tasks", "FAILED", (w: World) => db.organizationMember.updateMany({ where: { organizationId: w.org.id, userId: w.admin.id }, data: { revokedCapabilities: ["tasks.edit"] } })],
  ])("%s: it stops and says why, and no card is made", async (_name, reason, breakIt) => {
    const w = await world();
    const made = await routine(w);
    await breakIt(w);
    await fireDueRoutines(plus(made.nextRunAt!));
    expect(await rowOf(made.id)).toMatchObject({ active: false, stoppedReason: reason, nextRunAt: null });
    expect(await cards(w)).toHaveLength(0);
  });

  it("«تشغيل» never wakes a routine that still cannot go on; another manager takes over one whose maker left", async () => {
    const w = await world();
    const made = await routine(w);
    await db.project.update({ where: { id: w.made.project.id }, data: { status: "ARCHIVED" } });
    await fireDueRoutines(plus(made.nextRunAt!));
    await loginAs(w.admin.id);
    expect((await patch(made.id, { action: "resume" })).status).toBe(403);
    expect((await post(w)).status).toBe(403);
    expect((await rowOf(made.id)).active).toBe(false);

    await db.project.update({ where: { id: w.made.project.id }, data: { status: "ACTIVE" } });
    await suspend(w.org.id, w.admin.id);
    const second = await makeUser({ orgId: w.org.id, role: "ADMIN", name: "مدير تاني" });
    await db.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: second.id, role: "ADMIN" } });
    await loginAs(second.id);
    const resumed = await patch(made.id, { action: "resume" });
    expect(resumed.status, resumed.text).toBe(200);
    expect((await rowOf(made.id)).createdById).toBe(second.id);
  });

  it("with the company's «مهمة متكررة» switched off, the doors are shut and nothing is made; on again, it goes on", async () => {
    const w = await world();
    const made = await routine(w);
    await setSwitch(w.org.id, false);
    expect((await list()).status).toBe(404);
    expect((await post(w)).status).toBe(404);
    await fireDueRoutines(plus(made.nextRunAt!));
    expect(await cards(w)).toHaveLength(0);
    await setSwitch(w.org.id, true);
    await fireDueRoutines(plus(made.nextRunAt!));
    expect(await cards(w)).toHaveLength(1);
  });

  it("goes with its space when the space is deleted", async () => {
    const w = await world();
    await routine(w);
    await db.task.deleteMany({ where: { workspaceId: w.ws.id } });
    await db.project.deleteMany({ where: { workspaceId: w.ws.id } });
    await db.workspace.delete({ where: { id: w.ws.id } });
    expect(await db.dailyRoutine.count()).toBe(0);
    expect(await db.dailyRoutineRun.count()).toBe(0);
  });
});
