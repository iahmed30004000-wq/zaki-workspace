import { describe, expect, it } from "vitest";
import * as completeRoute from "@/app/api/tasks/[id]/complete/route";
import * as tasksRoute from "@/app/api/tasks/route";
import { AR } from "@/lib/i18n/dict";
import { quickTaskBody, TODAY_LIMITS } from "@/lib/today";
import { zonedParts } from "@/lib/zoned-time";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { joinOrg, joinWorkspace } from "./scoping-helpers";
import { allTaskIds, at, idsOf, isPlain, put, setMember, setZone, todayFor, todayNoon, world } from "./today-helpers";

/**
 * getToday(actor): what the Today page is made of. The rules, each proved here with real rows:
 *  - only the spaces the person can open (the owner: every space; an admin: none by rank), only their own
 *    tasks, never another company's;
 *  - the company's day, from Organization.timezone: a task due 23:30 local is today or tomorrow by the zone;
 *  - an external partner gets their own tasks and projects, no company numbers, no way to add or to finish;
 *  - the team pulse is «فريقي» (A2.3: the owner rank the company, anybody else the people under them in the reporting line; users.manage
 *    decides nothing: more in today-team-scope.test.ts), and a person who is no longer active is never in it.
 */

// the company's clock is UTC in `world()`, so these are plain calendar days
const NOW = at("2026-10-22T09:00:00Z");

describe("scope: only what the person may open, only their own, only their company", () => {
  it("a member sees the tasks of the spaces they are in, and a task in a space they are not in never appears", async () => {
    const w = await world();
    const visible = await put(w, "in", { assigneeId: w.member.id, title: "ظاهرة", due: at("2026-10-22T10:00:00Z") });
    const hiddenToday = await put(w, "out", { assigneeId: w.member.id, title: "مخفية اليوم", due: at("2026-10-22T10:00:00Z") });
    const hiddenOverdue = await put(w, "out", { assigneeId: w.member.id, title: "مخفية متأخرة", due: at("2026-10-20T10:00:00Z") });
    const hiddenLater = await put(w, "out", { assigneeId: w.member.id, title: "مخفية لاحقة" });

    const data = await todayFor(w.member.id, NOW);
    expect(allTaskIds(data)).toEqual([visible.id]);
    for (const hidden of [hiddenToday, hiddenOverdue, hiddenLater]) expect(allTaskIds(data)).not.toContain(hidden.id);
    expect(data.tasks.counts).toEqual({ open: 1, overdue: 0, today: 1, later: 0, doneToday: 0 });
    expect(JSON.stringify(data)).not.toContain("مخفية");
    expect(data.hasSpaces).toBe(true);
  });

  it("an admin who is not in a space does not see its tasks, even ones assigned to them; once put in a space, only that space's", async () => {
    const w = await world();
    const inTask = await put(w, "in", { assigneeId: w.admin.id, due: at("2026-10-22T10:00:00Z") });
    const outTask = await put(w, "out", { assigneeId: w.admin.id, due: at("2026-10-22T10:00:00Z") });

    const before = await todayFor(w.admin.id, NOW);
    expect(allTaskIds(before)).toEqual([]);
    expect(before.hasSpaces).toBe(false);
    expect(before.projects).toEqual([]);

    await joinWorkspace(w.admin.id, w.wsIn.id);
    const after = await todayFor(w.admin.id, NOW);
    expect(allTaskIds(after)).toEqual([inTask.id]);
    expect(allTaskIds(after)).not.toContain(outTask.id);
    expect(after.hasSpaces).toBe(true);
  });

  it("the owner sees every space of the company without a row, and still only their own work", async () => {
    const w = await world();
    const mineIn = await put(w, "in", { assigneeId: w.owner.id, due: at("2026-10-22T10:00:00Z") });
    const mineOut = await put(w, "out", { assigneeId: w.owner.id, due: at("2026-10-20T10:00:00Z") });
    const theirs = await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-22T10:00:00Z") });

    const data = await todayFor(w.owner.id, NOW);
    expect(allTaskIds(data).sort()).toEqual([mineIn.id, mineOut.id].sort());
    expect(allTaskIds(data)).not.toContain(theirs.id);
    expect(idsOf(data.tasks.overdue)).toEqual([mineOut.id]);
    expect(idsOf(data.tasks.today)).toEqual([mineIn.id]);
  });

  it("never shows a colleague's task, an unassigned one, a finished one or an archived one", async () => {
    const w = await world();
    const mine = await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-22T10:00:00Z") });
    await put(w, "in", { assigneeId: w.lead.id, due: at("2026-10-22T10:00:00Z") });
    await put(w, "in", { assigneeId: null, due: at("2026-10-22T10:00:00Z") });
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-22T10:00:00Z"), completed: true });
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-22T10:00:00Z"), archived: true });
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-01T10:00:00Z"), completed: true });

    const data = await todayFor(w.member.id, NOW);
    expect(allTaskIds(data)).toEqual([mine.id]);
    expect(data.tasks.counts.open).toBe(1);
  });

  it("never another company's: a person who works in two companies gets the one they work in now", async () => {
    const w = await world();
    const other = await makeTeam();
    await setZone(other.org.id, "UTC");
    const person = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "عامل بشركتين" });
    await joinWorkspace(person.id, w.wsIn.id);
    await joinOrg(person.id, other.org.id, "MEMBER");
    const otherSpace = await makeWorkspace(other.org.id, [{ userId: person.id }], "مساحة شركة أخرى");
    const otherProject = await makeProject(otherSpace.id, "مشروع شركة أخرى");
    const foreign = await makeTask({
      orgId: other.org.id,
      workspaceId: otherSpace.id,
      projectId: otherProject.project.id,
      boardId: otherProject.board.id,
      columnId: otherProject.todo.id,
      creatorId: other.owner.id,
      assigneeId: person.id,
      title: "مهمة شركة أخرى",
      dueDate: at("2026-10-22T10:00:00Z"),
    });
    const here = await put(w, "in", { assigneeId: person.id, due: at("2026-10-22T10:00:00Z") });

    const data = await todayFor(person.id, NOW);
    expect(allTaskIds(data)).toEqual([here.id]);
    expect(allTaskIds(data)).not.toContain(foreign.id);
    expect(JSON.stringify(data)).not.toContain("شركة أخرى");
  });

  it("hands over plain data only: strings, numbers, booleans, lists (nothing a server-to-browser hand-over could choke on)", async () => {
    const w = await world();
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-22T10:00:00Z") });
    for (const who of [w.member.id, w.owner.id, w.guest.id]) expect(isPlain(await todayFor(who, NOW)), who).toBe(true);
  });
});

describe("the three groups: overdue, today, later — counted by the company's days", () => {
  it("sorts a task by its day, with the due day said the way people say it, and orders each group", async () => {
    const w = await world();
    const mk = (label: string, due: Date | null) => put(w, "in", { assigneeId: w.member.id, title: label, due });
    const o2 = await mk("o2", at("2026-10-20T12:00:00Z"));
    const o1 = await mk("o1", at("2026-10-21T09:00:00Z"));
    const oEdge = await mk("oEdge", at("2026-10-21T23:59:59.999Z"));
    const tEarly = await mk("tEarly", at("2026-10-22T00:00:00.000Z"));
    const tLate = await mk("tLate", at("2026-10-22T23:59:59.999Z"));
    const lEdge = await mk("lEdge", at("2026-10-23T00:00:00.000Z"));
    const lFar = await mk("lFar", at("2026-10-30T12:00:00Z"));
    const lNone = await mk("lNone", null);

    const data = await todayFor(w.member.id, NOW);
    // the most overdue first
    expect(idsOf(data.tasks.overdue)).toEqual([o2.id, o1.id, oEdge.id]);
    expect(data.tasks.overdue.map((t) => t.dueLabel)).toEqual(["قبل يومين", "أمس", "أمس"]);
    // a task due earlier today is still today's (the group is the day, not "before now")
    expect(idsOf(data.tasks.today)).toEqual([tEarly.id, tLate.id]);
    expect(data.tasks.today.map((t) => t.dueLabel)).toEqual(["اليوم", "اليوم"]);
    // the next days first, the undated last
    expect(idsOf(data.tasks.later)).toEqual([lEdge.id, lFar.id, lNone.id]);
    expect(data.tasks.later.map((t) => t.dueLabel)).toEqual(["بكرا", "بعد 8 أيام", ""]);
    expect(data.tasks.counts).toEqual({ open: 8, overdue: 3, today: 2, later: 3, doneToday: 0 });
  });

  it("carries what a row shows: the title, the project, the priority in Arabic, and whether the person may finish it", async () => {
    const w = await world();
    const task = await put(w, "in", { assigneeId: w.member.id, title: "مهمة عاجلة", priority: "URGENT", due: at("2026-10-22T10:00:00Z") });
    const data = await todayFor(w.member.id, NOW);
    expect(data.tasks.today).toEqual([
      {
        id: task.id,
        title: "مهمة عاجلة",
        projectId: w.inside.project.id,
        projectName: "مشروع الفريق",
        priority: "URGENT",
        priorityLabel: AR["priority.URGENT"],
        dueLabel: "اليوم",
        editable: true,
      },
    ]);
  });

  it("breaks a tie on the due moment by priority: the urgent one first, the one with no priority last", async () => {
    const w = await world();
    const due = at("2026-10-22T10:00:00Z");
    const mk = (title: string, priority: "URGENT" | "HIGH" | "NORMAL" | "LOW" | "NONE") => put(w, "in", { assigneeId: w.member.id, title, priority, due });
    const none = await mk("بلا", "NONE");
    const low = await mk("منخفضة", "LOW");
    const normal = await mk("عادية", "NORMAL");
    const urgent = await mk("عاجلة", "URGENT");
    const high = await mk("عالية", "HIGH");
    const data = await todayFor(w.member.id, NOW);
    expect(idsOf(data.tasks.today)).toEqual([urgent.id, high.id, normal.id, low.id, none.id]);
  });

  it("cuts each group at its limit and still counts them all", async () => {
    const w = await world();
    const cut = TODAY_LIMITS;
    for (let i = 0; i < cut.overdue + 2; i += 1) await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-15T10:00:00Z") });
    for (let i = 0; i < cut.today + 2; i += 1) await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-22T10:00:00Z") });
    for (let i = 0; i < cut.later + 2; i += 1) await put(w, "in", { assigneeId: w.member.id });

    const data = await todayFor(w.member.id, NOW);
    expect(data.tasks.overdue).toHaveLength(cut.overdue);
    expect(data.tasks.today).toHaveLength(cut.today);
    expect(data.tasks.later).toHaveLength(cut.later);
    expect(data.tasks.counts).toEqual({
      open: cut.overdue + cut.today + cut.later + 6,
      overdue: cut.overdue + 2,
      today: cut.today + 2,
      later: cut.later + 2,
      doneToday: 0,
    });
  });

  it("a task due 23:30 on the company's day is today in one zone and tomorrow in another", async () => {
    const w = await world();
    // 06:30Z on the 23rd is 23:30 on the 22nd in Phoenix (UTC-7); 14:30Z on the 22nd is 23:30 on the 22nd in Tokyo (UTC+9)
    const phoenixLate = await put(w, "in", { assigneeId: w.member.id, title: "phoenix", due: at("2026-10-23T06:30:00Z") });
    const tokyoLate = await put(w, "in", { assigneeId: w.member.id, title: "tokyo", due: at("2026-10-22T14:30:00Z") });
    const now = at("2026-10-22T20:00:00Z"); // 13:00 on the 22nd in Phoenix, 20:00 in UTC, 05:00 on the 23rd in Tokyo

    await setZone(w.org.id, "America/Phoenix");
    let data = await todayFor(w.member.id, now);
    expect(idsOf(data.tasks.today).sort()).toEqual([phoenixLate.id, tokyoLate.id].sort());
    expect(data.tasks.counts).toMatchObject({ overdue: 0, today: 2, later: 0 });

    await setZone(w.org.id, "UTC");
    data = await todayFor(w.member.id, now);
    expect(idsOf(data.tasks.today)).toEqual([tokyoLate.id]);
    expect(idsOf(data.tasks.later)).toEqual([phoenixLate.id]);
    expect(data.tasks.later[0]?.dueLabel).toBe("بكرا");

    await setZone(w.org.id, "Asia/Tokyo");
    data = await todayFor(w.member.id, now);
    expect(idsOf(data.tasks.overdue)).toEqual([tokyoLate.id]);
    expect(data.tasks.overdue[0]?.dueLabel).toBe("أمس");
    expect(idsOf(data.tasks.today)).toEqual([phoenixLate.id]);
  });

  it("puts the very moment of the zone's midnight in the new day and the millisecond before it in the old one", async () => {
    const w = await world("Asia/Tokyo");
    // Tokyo's 23rd begins at 2026-10-22T15:00:00Z
    const before = await put(w, "in", { assigneeId: w.member.id, title: "قبل", due: at("2026-10-22T14:59:59.999Z") });
    const exactly = await put(w, "in", { assigneeId: w.member.id, title: "تماما", due: at("2026-10-22T15:00:00.000Z") });
    const data = await todayFor(w.member.id, at("2026-10-22T20:00:00Z"));
    expect(idsOf(data.tasks.overdue)).toEqual([before.id]);
    expect(idsOf(data.tasks.today)).toEqual([exactly.id]);
  });

  it("works with the company's default when the zone on the row is not a zone, and does not crash", async () => {
    const w = await world("Mars/Olympus");
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-22T10:00:00Z") });
    const data = await todayFor(w.member.id, NOW);
    expect(data.timeZone).toBe("Asia/Damascus");
    expect(allTaskIds(data)).toHaveLength(1);
  });
});

describe("the greeting and the date, in the company's zone", () => {
  it("takes the first name, the hour of the zone and the zone's own date", async () => {
    const w = await world();
    await db.user.update({ where: { id: w.member.id }, data: { name: "سارة خالد" } });
    const now = at("2026-10-22T05:30:00Z");

    const utc = await todayFor(w.member.id, now);
    expect(utc.greeting).toEqual({ period: "morning", firstName: "سارة", hour: 5 });
    expect(utc.dateLabel).toBe("الخميس 22 تشرين الأول 2026");
    expect(utc.timeZone).toBe("UTC");

    await setZone(w.org.id, "America/Phoenix"); // 22:30 on the 21st
    const phoenix = await todayFor(w.member.id, now);
    expect(phoenix.greeting).toEqual({ period: "evening", firstName: "سارة", hour: 22 });
    expect(phoenix.dateLabel).toBe("الأربعاء 21 تشرين الأول 2026");

    await setZone(w.org.id, "Asia/Tokyo"); // 14:30 on the 22nd
    const tokyo = await todayFor(w.member.id, now);
    expect(tokyo.greeting).toEqual({ period: "evening", firstName: "سارة", hour: 14 });
    expect(tokyo.dateLabel).toBe("الخميس 22 تشرين الأول 2026");
  });
});

describe("the team pulse: for the owner and whoever manages people, and never a person who is no longer active", () => {
  /** Twelve tasks that are overdue (and one that is not), among people who are, and are not, active. */
  async function pulseWorld() {
    const w = await world();
    const suspended = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Suspended Sam" });
    const gone = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Offboarded Olga" });
    await setMember(w.org.id, suspended.id, { status: "SUSPENDED" });
    await setMember(w.org.id, gone.id, { status: "OFFBOARDED" });

    const A = async (label: string, who: string | null, due: string, extra: { completed?: boolean; archived?: boolean } = {}) =>
      put(w, "in", { title: label, assigneeId: who, due: at(due), ...extra });
    const a1 = await A("A1", w.member.id, "2026-10-10T12:00:00Z");
    const a2 = await A("A2", w.lead.id, "2026-10-15T12:00:00Z");
    const a3 = await A("A3", w.member.id, "2026-10-18T12:00:00Z");
    const a4 = await A("A4", w.member.id, "2026-10-19T12:00:00Z");
    const a5 = await A("A5", w.lead.id, "2026-10-20T12:00:00Z");
    const a6 = await A("A6", w.member.id, "2026-10-21T12:00:00Z");
    await A("S1", suspended.id, "2026-10-01T12:00:00Z"); // the most overdue of all, held by somebody who is suspended
    await A("O1", gone.id, "2026-10-02T12:00:00Z");
    await A("U1", null, "2026-10-03T12:00:00Z");
    await A("OPEN1", w.member.id, "2026-10-30T12:00:00Z");
    await A("DONE", w.member.id, "2026-10-01T12:00:00Z", { completed: true });
    await A("ARCH", w.member.id, "2026-10-01T12:00:00Z", { archived: true });
    const out = async (label: string, due: string) => put(w, "out", { title: label, assigneeId: w.lead.id, due: at(due) });
    const w1 = await out("W1", "2026-10-05T12:00:00Z");
    const w2 = await out("W2", "2026-10-06T12:00:00Z");
    const w3 = await out("W3", "2026-10-07T12:00:00Z");
    return { w, suspended, gone, a: [a1, a2, a3, a4, a5, a6], wOut: [w1, w2, w3] };
  }

  // A2.3: «فريقي» (D-A3). The owner rank has the company; anybody else has the people under them; users.manage decides nothing here.
  it("is there for the owner and for whoever has people under them, and for nobody else (users.manage decides nothing)", async () => {
    const w = await world();
    await joinWorkspace(w.admin.id, w.wsIn.id); // an admin gets no space by rank: put them in one
    expect((await todayFor(w.owner.id, NOW)).pulse).not.toBeNull();
    expect((await todayFor(w.admin.id, NOW)).pulse).toBeNull(); // an ADMIN holds users.manage by rank, but nobody answers to them
    expect((await todayFor(w.member.id, NOW)).pulse).toBeNull();
    expect((await todayFor(w.lead.id, NOW)).pulse).toBeNull();

    await setMember(w.org.id, w.member.id, { capabilities: ["users.manage"] });
    expect((await todayFor(w.member.id, NOW)).pulse).toBeNull(); // the box alone makes no team

    await setMember(w.org.id, w.member.id, { managerId: w.admin.id });
    expect((await todayFor(w.admin.id, NOW)).pulse).not.toBeNull();
    // taking users.manage away does not take the team away: they are the same people either way
    await setMember(w.org.id, w.admin.id, { revokedCapabilities: ["users.manage"] });
    expect((await todayFor(w.admin.id, NOW)).pulse).not.toBeNull();
    // the person under them has nobody: no pulse
    expect((await todayFor(w.member.id, NOW)).pulse).toBeNull();
  });

  it("is not there for a manager who can open no space: there is nothing to take the pulse of (a new company's owner is told to open a space instead)", async () => {
    const w = await world();
    await setMember(w.org.id, w.member.id, { managerId: w.admin.id });
    expect((await todayFor(w.admin.id, NOW)).pulse).toBeNull(); // no row in any space, so nothing to count
    await joinWorkspace(w.admin.id, w.wsIn.id);
    expect((await todayFor(w.admin.id, NOW)).pulse).toEqual({ open: 0, overdue: 0, worst: [], scope: { who: "reports", spaceName: null } });
    // a company with no space at all: its owner has the same empty hands
    const fresh = await makeTeam();
    expect((await todayFor(fresh.owner.id, NOW)).pulse).toBeNull();
  });

  it("is never there for an external partner, whatever a stored row says", async () => {
    const w = await world();
    await setMember(w.org.id, w.guest.id, { capabilities: ["users.manage", "directory.view"] });
    const data = await todayFor(w.guest.id, NOW);
    expect(data.pulse).toBeNull();
    expect(data.isExternal).toBe(true);
  });

  it("counts the open and the overdue tasks over «فريقي»: the owner the whole company, a manager only the people under them in the spaces they can open", async () => {
    const { w } = await pulseWorld();
    const owner = (await todayFor(w.owner.id, NOW)).pulse;
    expect(owner).toMatchObject({ open: 13, overdue: 12, scope: { who: "company", spaceName: null } });

    await joinWorkspace(w.admin.id, w.wsIn.id);
    await setMember(w.org.id, w.member.id, { managerId: w.admin.id });
    await setMember(w.org.id, w.lead.id, { managerId: w.admin.id });
    const admin = (await todayFor(w.admin.id, NOW)).pulse;
    // the member's and the lead's open tasks of the space they share with the admin: A1..A6 (overdue) and OPEN1; the lead's three tasks in the closed space are not theirs to see
    expect(admin).toMatchObject({ open: 7, overdue: 6, scope: { who: "reports", spaceName: null } });
  });

  it("lists the five most overdue tasks with the assignee's name, and no task of somebody who is suspended or offboarded, nor an unassigned one", async () => {
    const { w, a, wOut } = await pulseWorld();

    const owner = (await todayFor(w.owner.id, NOW)).pulse!;
    expect(owner.worst).toHaveLength(TODAY_LIMITS.pulse);
    expect(idsOf(owner.worst)).toEqual([wOut[0]!.id, wOut[1]!.id, wOut[2]!.id, a[0]!.id, a[1]!.id]);
    expect(owner.worst.map((r) => r.title)).toEqual(["W1", "W2", "W3", "A1", "A2"]);
    expect(owner.worst.map((r) => r.assigneeName)).toEqual(["Lead", "Lead", "Lead", "Member", "Lead"]);
    expect(owner.worst[0]).toEqual({ id: wOut[0]!.id, title: "W1", projectName: "مشروع مغلق", assigneeName: "Lead", dueLabel: "قبل 17 يومًا" });
    expect(owner.worst[3]).toMatchObject({ projectName: "مشروع الفريق", dueLabel: "قبل 12 يومًا" });

    await joinWorkspace(w.admin.id, w.wsIn.id);
    await setMember(w.org.id, w.member.id, { managerId: w.admin.id });
    await setMember(w.org.id, w.lead.id, { managerId: w.admin.id });
    const admin = (await todayFor(w.admin.id, NOW)).pulse!;
    expect(admin.worst.map((r) => r.title)).toEqual(["A1", "A2", "A3", "A4", "A5"]);

    for (const text of [JSON.stringify(owner), JSON.stringify(admin)]) {
      expect(text).not.toContain("Suspended Sam");
      expect(text).not.toContain("Offboarded Olga");
    }
  });

  it("keeps the people who are no longer active in the company's totals (the work is still there), like the reports do", async () => {
    const { w } = await pulseWorld();
    const pulse = (await todayFor(w.owner.id, NOW)).pulse!;
    // 12 overdue = A1..A6 (6) + W1..W3 (3) + the suspended, the offboarded and the unassigned one (3)
    expect(pulse.overdue).toBe(12);
    expect(pulse.worst.every((r) => r.assigneeName === "Lead" || r.assigneeName === "Member")).toBe(true);
  });

  it("never counts another company's work, even when the same person owns that company too", async () => {
    const { w } = await pulseWorld();
    const other = await makeTeam();
    await setZone(other.org.id, "UTC");
    // the owner of this company also owns the other one: every space of both is theirs to open, but Today is this company's
    await joinOrg(w.owner.id, other.org.id, "OWNER");
    const space = await makeWorkspace(other.org.id, [{ userId: other.member.id }]);
    const made = await makeProject(space.id);
    for (let i = 0; i < 4; i += 1) {
      await makeTask({
        orgId: other.org.id,
        workspaceId: space.id,
        projectId: made.project.id,
        boardId: made.board.id,
        columnId: made.todo.id,
        creatorId: other.owner.id,
        assigneeId: other.member.id,
        dueDate: at("2026-09-01T12:00:00Z"),
      });
    }
    expect((await todayFor(w.owner.id, NOW)).pulse).toMatchObject({ open: 13, overdue: 12 });
  });
});

describe("what «no space yet» says depends on whether the person may open one", () => {
  it("knows who holds spaces.create: the owner and the admins, a lead or a member only when switched on, never the partner", async () => {
    const w = await world();
    for (const who of [w.owner, w.admin]) expect((await todayFor(who.id, NOW)).canCreateSpaces, who.name).toBe(true);
    for (const who of [w.member, w.lead, w.guest]) expect((await todayFor(who.id, NOW)).canCreateSpaces, who.name).toBe(false);
    await setMember(w.org.id, w.member.id, { capabilities: ["spaces.create"] });
    expect((await todayFor(w.member.id, NOW)).canCreateSpaces).toBe(true);
    await setMember(w.org.id, w.admin.id, { revokedCapabilities: ["spaces.create"] });
    expect((await todayFor(w.admin.id, NOW)).canCreateSpaces).toBe(false);
    await setMember(w.org.id, w.guest.id, { capabilities: ["spaces.create"] });
    expect((await todayFor(w.guest.id, NOW)).canCreateSpaces).toBe(false);
  });
});

describe("an external partner: their own tasks and their own projects, and nothing of the company", () => {
  it("sees only their own tasks in the spaces they were put in, cannot finish them, and gets no pulse, no quick add and no space they are not in", async () => {
    const w = await world();
    await joinWorkspace(w.guest.id, w.wsIn.id, "GUEST");
    const own = await put(w, "in", { assigneeId: w.guest.id, title: "مهمة الشريك", due: at("2026-10-22T10:00:00Z") });
    const colleague = await put(w, "in", { assigneeId: w.member.id, title: "مهمة زميل", due: at("2026-10-22T10:00:00Z") });
    const unshared = await put(w, "out", { assigneeId: w.guest.id, title: "مهمة مساحة غير مشاركة", due: at("2026-10-22T10:00:00Z") });

    const data = await todayFor(w.guest.id, NOW);
    expect(allTaskIds(data)).toEqual([own.id]);
    expect(allTaskIds(data)).not.toContain(colleague.id);
    expect(allTaskIds(data)).not.toContain(unshared.id);
    expect(data.tasks.today[0]?.editable).toBe(false);
    expect(data.isExternal).toBe(true);
    expect(data.pulse).toBeNull();
    expect(data.quickAdd).toBeNull();
    expect(JSON.stringify(data)).not.toContain("مهمة زميل");
  });

  it("is shown only the projects they have work in, with their own open tasks counted, not the project's", async () => {
    const w = await world();
    await joinWorkspace(w.guest.id, w.wsIn.id, "GUEST");
    await put(w, "in", { assigneeId: w.guest.id, due: at("2026-10-22T10:00:00Z") });
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-22T10:00:00Z") });
    await put(w, "in", { assigneeId: w.member.id });
    const other = await makeProject(w.wsIn.id, "مشروع بلا شريك");
    await makeTask({
      orgId: w.org.id,
      workspaceId: w.wsIn.id,
      projectId: other.project.id,
      boardId: other.board.id,
      columnId: other.todo.id,
      creatorId: w.owner.id,
      assigneeId: w.member.id,
    });

    const guest = await todayFor(w.guest.id, NOW);
    expect(guest.projects.map((p) => [p.name, p.openTasks])).toEqual([["مشروع الفريق", 1]]);

    const member = await todayFor(w.member.id, NOW);
    expect(member.projects.map((p) => [p.name, p.openTasks]).sort()).toEqual([["مشروع بلا شريك", 1], ["مشروع الفريق", 3]].sort());
  });
});

describe("«مشاريعي النشطة»", () => {
  it("lists the active, planned and at-risk projects of the person's spaces, in Arabic, and not the finished, held or archived ones", async () => {
    const w = await world();
    const make = (name: string, status: "ACTIVE" | "AT_RISK" | "ON_HOLD" | "COMPLETED" | "ARCHIVED") =>
      db.project.create({ data: { workspaceId: w.wsIn.id, name, status } });
    await make("نشط", "ACTIVE");
    await make("في خطر", "AT_RISK");
    await make("موقوف", "ON_HOLD");
    await make("مكتمل", "COMPLETED");
    await make("مؤرشف", "ARCHIVED");
    await db.project.create({ data: { workspaceId: w.wsOut.id, name: "في مساحة مغلقة", status: "ACTIVE" } });

    const data = await todayFor(w.member.id, NOW);
    expect(data.projects.map((p) => p.name).sort()).toEqual(["مشروع الفريق", "نشط", "في خطر"].sort());
    expect(data.projects.find((p) => p.name === "نشط")).toMatchObject({ status: "ACTIVE", statusLabel: AR["enum.ProjectStatus.ACTIVE"] });
    expect(data.projects.find((p) => p.name === "في خطر")).toMatchObject({ statusLabel: AR["enum.ProjectStatus.AT_RISK"] });
    expect(data.projects.find((p) => p.name === "مشروع الفريق")).toMatchObject({ statusLabel: AR["enum.ProjectStatus.PLANNING"] });
    // the owner opens the closed space too
    expect((await todayFor(w.owner.id, NOW)).projects.map((p) => p.name)).toContain("في مساحة مغلقة");
  });

  it("shows the six most recent, newest first, with the number of open tasks (finished and archived ones are not open)", async () => {
    const w = await world();
    // «newest» is `updatedAt`, and eight creates land in the same millisecond: without a distinct
    // stamp the last two tie and the tie-break is the random cuid, so the order is genuinely undefined.
    for (let i = 1; i <= 8; i += 1) {
      await db.project.create({
        data: { workspaceId: w.wsIn.id, name: `مشروع ${i}`, status: "ACTIVE", updatedAt: new Date(NOW.getTime() - (8 - i) * 60_000) },
      });
    }
    // the world's own project is older than the eight, so it falls outside the six
    await db.project.update({ where: { id: w.inside.project.id }, data: { updatedAt: new Date(NOW.getTime() - 60 * 60_000) } });
    const data = await todayFor(w.member.id, NOW);
    expect(data.projects.map((p) => p.name)).toEqual(["مشروع 8", "مشروع 7", "مشروع 6", "مشروع 5", "مشروع 4", "مشروع 3"]);

    await put(w, "in", { assigneeId: w.member.id });
    await put(w, "in", { assigneeId: w.lead.id });
    await put(w, "in", { assigneeId: w.member.id, completed: true });
    await put(w, "in", { assigneeId: w.member.id, archived: true });
    await db.project.update({ where: { id: w.inside.project.id }, data: { status: "ACTIVE" } });
    const again = await todayFor(w.member.id, NOW);
    expect(again.projects[0]).toMatchObject({ name: "مشروع الفريق", openTasks: 2 });
  });
});

describe("«إضافة سريعة»: where a task can be added from Today", () => {
  it("offers the projects that have a board with columns, in the spaces the person can write in, with the person as the assignee", async () => {
    const w = await world();
    const noBoard = await db.project.create({ data: { workspaceId: w.wsIn.id, name: "بلا لوحة" } });
    const emptyBoardProject = await db.project.create({ data: { workspaceId: w.wsIn.id, name: "لوحة بلا أعمدة" } });
    await db.board.create({ data: { projectId: emptyBoardProject.id, name: "فاضية" } });
    await db.project.update({ where: { id: w.inside.project.id }, data: { status: "ACTIVE" } });
    const finished = await makeProject(w.wsIn.id, "مشروع مكتمل");
    await db.project.update({ where: { id: finished.project.id }, data: { status: "COMPLETED" } });

    const data = await todayFor(w.member.id, NOW);
    expect(data.quickAdd).not.toBeNull();
    expect(data.quickAdd!.assigneeId).toBe(w.member.id);
    expect(data.quickAdd!.targets).toEqual([
      {
        projectId: w.inside.project.id,
        projectName: "مشروع الفريق",
        workspaceId: w.wsIn.id,
        workspaceName: "مساحة الفريق",
        boardId: w.inside.board.id,
      },
    ]);
    const names = JSON.stringify(data.quickAdd);
    for (const hidden of [noBoard.name, emptyBoardProject.name, "مشروع مكتمل", "مشروع مغلق"]) expect(names).not.toContain(hidden);
  });

  it("offers the owner every space of the company, an admin only the spaces they were put in, and a read-only row nothing", async () => {
    const w = await world();
    const owner = await todayFor(w.owner.id, NOW);
    expect(owner.quickAdd!.targets.map((t) => t.projectName).sort()).toEqual(["مشروع الفريق", "مشروع مغلق"].sort());

    // an admin outranks nobody by rank: no row, no space, no place to add
    expect((await todayFor(w.admin.id, NOW)).quickAdd).toBeNull();
    await joinWorkspace(w.admin.id, w.wsIn.id, "MEMBER");
    expect((await todayFor(w.admin.id, NOW)).quickAdd!.targets.map((t) => t.projectName)).toEqual(["مشروع الفريق"]);

    // a member whose row in the space says «guest» may read there, not add
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: w.wsIn.id, userId: w.member.id } }, data: { role: "GUEST" } });
    expect((await todayFor(w.member.id, NOW)).quickAdd).toBeNull();
  });

  it("is there, with no target, for somebody who may add but has no project with a board yet (the form then says what to do)", async () => {
    const w = await world();
    await makeWorkspace(w.org.id, [{ userId: w.lead.id }], "مساحة جديدة"); // a space with no project at all
    await db.board.deleteMany({ where: { projectId: w.inside.project.id } }); // and the project of the other one has lost its board
    const data = await todayFor(w.lead.id, NOW);
    expect(data.quickAdd).toEqual({
      assigneeId: w.lead.id,
      targets: [],
      dueToday: expect.any(String),
      dueTomorrow: expect.any(String),
    });
  });

  it("hands the form «today» and «tomorrow» as noon in the company's zone", async () => {
    const w = await world("America/Phoenix");
    const data = await todayFor(w.member.id, at("2026-10-22T20:00:00Z")); // 13:00 on the 22nd in Phoenix
    const quick = data.quickAdd!;
    expect(quick.dueToday).toBe("2026-10-22T19:00:00.000Z");
    expect(quick.dueTomorrow).toBe("2026-10-23T19:00:00.000Z");
    expect(zonedParts(new Date(quick.dueToday), "America/Phoenix")).toMatchObject({ day: 22, hour: 12, minute: 0 });
  });
});

describe("through the endpoints that already exist", () => {
  it("finishing a task of Today with the done button's request takes it off the page", async () => {
    const w = await world();
    const task = await put(w, "in", { assigneeId: w.member.id, due: todayNoon("UTC", NOW) });
    await loginAs(w.member.id);
    expect(allTaskIds(await todayFor(w.member.id, NOW))).toEqual([task.id]);

    const res = await call(completeRoute.POST, { params: { id: task.id }, body: { complete: true } });
    expect(res.status).toBe(200);

    const after = await todayFor(w.member.id, NOW);
    expect(allTaskIds(after)).toEqual([]);
    expect(after.tasks.counts.open).toBe(0);
  });

  it("a board with no done column refuses with the key the row explains (the 403 is not about the person)", async () => {
    const w = await world();
    const task = await put(w, "in", { assigneeId: w.member.id, due: todayNoon("UTC", NOW) });
    await db.boardColumn.deleteMany({ where: { boardId: w.inside.board.id, done: true } });
    await loginAs(w.member.id);
    const res = await call(completeRoute.POST, { params: { id: task.id }, body: { complete: true } });
    expect(res.status).toBe(403);
    expect(res.json?.["message"]).toBe("board.no_done_column");
    expect(allTaskIds(await todayFor(w.member.id, NOW))).toEqual([task.id]); // still open, still there
  });

  it("an external partner is refused, which is why the page offers them no button", async () => {
    const w = await world();
    await joinWorkspace(w.guest.id, w.wsIn.id, "GUEST");
    const task = await put(w, "in", { assigneeId: w.guest.id, due: todayNoon("UTC", NOW) });
    await loginAs(w.guest.id);
    const res = await call(completeRoute.POST, { params: { id: task.id }, body: { complete: true } });
    expect(res.status).toBe(403);
    expect(allTaskIds(await todayFor(w.guest.id, NOW))).toEqual([task.id]);
  });

  it("a task added with the quick add's request is accepted, is the person's own and shows under «اليوم»", async () => {
    const w = await world("America/Phoenix");
    await loginAs(w.member.id);
    const quick = (await todayFor(w.member.id, NOW)).quickAdd!;
    const body = quickTaskBody(quick, { projectId: w.inside.project.id, title: "اتصل بالمورّد", due: "today", timeZone: "UTC", now: NOW });
    expect(body).not.toBeNull();

    const res = await call(tasksRoute.POST, { body });
    expect(res.status).toBe(201);

    const after = await todayFor(w.member.id, NOW);
    expect(after.tasks.today.map((t) => t.title)).toEqual(["اتصل بالمورّد"]);
    expect(after.tasks.today[0]).toMatchObject({ projectName: "مشروع الفريق", editable: true });
    expect(after.tasks.counts).toMatchObject({ overdue: 0, today: 1 });

    const row = await db.task.findFirstOrThrow({ where: { title: "اتصل بالمورّد", orgId: w.org.id } });
    expect(row.assigneeId).toBe(w.member.id);
    expect(row.creatorId).toBe(w.member.id);
  });

  it("«بكرا» and «بدون موعد» land in «لاحقًا»", async () => {
    const w = await world("Asia/Tokyo");
    await loginAs(w.member.id);
    const quick = (await todayFor(w.member.id, NOW)).quickAdd!;
    for (const [title, due] of [["بكرا", "tomorrow"], ["بلا موعد", "none"]] as const) {
      const res = await call(tasksRoute.POST, { body: quickTaskBody(quick, { projectId: w.inside.project.id, title, due, timeZone: "Asia/Tokyo", now: NOW }) });
      expect(res.status, title).toBe(201);
    }
    const data = await todayFor(w.member.id, NOW);
    expect(data.tasks.later.map((t) => [t.title, t.dueLabel])).toEqual([["بكرا", "بكرا"], ["بلا موعد", ""]]);
    expect(data.tasks.today).toEqual([]);
  });
});

describe("«x من y خلصت»: what the person finished today", () => {
  it("counts the person's own tasks finished today in the company's day — not yesterday's, not a colleague's, not another space's", async () => {
    const w = await world();
    const done = async (assigneeId: string, completedAt: Date, place: "in" | "out" = "in") => {
      const row = await put(w, place, { assigneeId, due: at("2026-10-20T10:00:00Z"), completed: true });
      await db.task.update({ where: { id: row.id }, data: { completedAt } });
    };
    await done(w.member.id, at("2026-10-22T08:00:00Z")); // today, before NOW
    await done(w.member.id, at("2026-10-22T00:00:00Z")); // the very start of today
    await done(w.member.id, at("2026-10-21T23:59:59Z")); // yesterday
    await done(w.lead.id, at("2026-10-22T08:00:00Z")); // a colleague's
    await done(w.member.id, at("2026-10-22T08:00:00Z"), "out"); // a space the member is not in
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-22T10:00:00Z") }); // still open, due today

    const data = await todayFor(w.member.id, NOW);
    expect(data.tasks.counts.doneToday).toBe(2);
    expect(data.tasks.counts.today).toBe(1);
  });

  it("follows the company's zone: finished at 22:30 UTC is TOMORROW in Asia/Damascus", async () => {
    const w = await world("Asia/Damascus");
    const row = await put(w, "in", { assigneeId: w.member.id, due: null, completed: true });
    await db.task.update({ where: { id: row.id }, data: { completedAt: at("2026-10-21T22:30:00Z") } });
    // NOW is 2026-10-22 12:00 in Damascus: 22:30Z on the 21st is 01:30 on the 22nd there — today
    expect((await todayFor(w.member.id, NOW)).tasks.counts.doneToday).toBe(1);
    // and in a UTC company the same moment is yesterday
    const u = await world();
    const other = await put(u, "in", { assigneeId: u.member.id, due: null, completed: true });
    await db.task.update({ where: { id: other.id }, data: { completedAt: at("2026-10-21T22:30:00Z") } });
    expect((await todayFor(u.member.id, NOW)).tasks.counts.doneToday).toBe(0);
  });
});
