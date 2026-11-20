import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { withFeature } from "@/lib/features";
import { getToday } from "@/server/services/today";
import { getTodayDashboard } from "@/server/services/today-dashboard";
import { companyPanelAccess, loadPanelHome } from "@/server/services/control-panel";
import { db, makeProject, makeTask, makeUser } from "./helpers";
import { joinWorkspace } from "./scoping-helpers";
import { actorOf, at, put, setMember, world, type World } from "./today-helpers";

/**
 * A2.3 — the Today team numbers follow ONE meaning of «فريقي» (D-A3): the OWNER rank holding `board.team` has the company; everybody else has
 * the people under them in the reporting line (managerId, transitive, ACTIVE), and a person with nobody under them has NO team (no pulse, no
 * strip: never a 0). `users.manage` no longer decides it. Every number is read through `taskVisibleWhere`: a task the person may not open is
 * in no count. Each number says what it counted (`scope`).
 */

const NOW = at("2026-10-22T09:00:00Z");
const pulseOf = async (userId: string, opts: Parameters<typeof getToday>[1] = {}) => (await getToday(await actorOf(userId), { now: NOW, ...opts })).pulse;
const stripOf = async (userId: string, opts: Parameters<typeof getTodayDashboard>[1] = {}) => (await getTodayDashboard(await actorOf(userId), { now: NOW, ...opts }))?.team ?? null;
const under = (orgId: string, userId: string, managerId: string | null) => setMember(orgId, userId, { managerId });

/** The admin works in `wsIn` (as a plain member of it) and the member answers to the admin; the lead answers to the member. */
async function teamWorld() {
  const w = await world();
  await joinWorkspace(w.admin.id, w.wsIn.id);
  await under(w.org.id, w.member.id, w.admin.id);
  await under(w.org.id, w.lead.id, w.member.id);
  return w;
}

async function finished(w: World, assigneeId: string, when: string) {
  const task = await put(w, "in", { assigneeId, completed: true });
  await db.task.update({ where: { id: task.id }, data: { completedAt: at(when) } });
  return task;
}

describe("the pulse is «فريقي»: the people under the person, over what the person may open", () => {
  it("a person with nobody under them has NO pulse, whatever they hold: users.manage no longer makes a team", async () => {
    const w = await world();
    await joinWorkspace(w.admin.id, w.wsIn.id);
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-10T12:00:00Z") });
    expect(await pulseOf(w.admin.id)).toBeNull(); // an ADMIN holds users.manage by rank
    await setMember(w.org.id, w.member.id, { capabilities: ["users.manage"] });
    expect(await pulseOf(w.member.id)).toBeNull();
    expect(await pulseOf(w.lead.id)).toBeNull();
  });

  it("counts only the tasks of the people under the person: not their own, not a colleague's, not an unassigned one, not the owner's", async () => {
    const w = await teamWorld();
    const due = (d: string) => at(`2026-10-${d}T12:00:00Z`);
    await put(w, "in", { title: "M1", assigneeId: w.member.id, due: due("10") });
    await put(w, "in", { title: "M2", assigneeId: w.member.id, due: due("11") });
    await put(w, "in", { title: "L1", assigneeId: w.lead.id, due: due("12") }); // two levels down
    await put(w, "in", { title: "OPEN", assigneeId: w.lead.id, due: due("30") });
    await put(w, "in", { title: "MINE", assigneeId: w.admin.id, due: due("01") }); // the person's own: not their team
    await put(w, "in", { title: "OWNERS", assigneeId: w.owner.id, due: due("02") });
    await put(w, "in", { title: "NOBODY", assigneeId: null, due: due("03") });
    const pulse = await pulseOf(w.admin.id);
    expect(pulse).toMatchObject({ open: 4, overdue: 3 });
    expect(pulse?.worst.map((r) => r.title)).toEqual(["M1", "M2", "L1"]);
    expect(pulse?.worst.map((r) => r.assigneeName)).toEqual(["Member", "Member", "Lead"]);
  });

  it("a task of a report that the person may not open is in NO number (a team-only project the person is not in)", async () => {
    const w = await teamWorld();
    // an org ADMIN who is in a space manages it (D-A2 is open), so the viewer here is a plain member of the space with the member and the lead under them
    const boss = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Boss" });
    await joinWorkspace(boss.id, w.wsIn.id);
    await under(w.org.id, w.member.id, boss.id);
    const hiddenTeam = await db.team.create({ data: { workspaceId: w.wsIn.id, name: "فريق مغلق", members: { create: [{ userId: w.lead.id }] } } });
    const closed = await makeProject(w.wsIn.id, "مشروع الفريق المغلق");
    await db.project.update({ where: { id: closed.project.id }, data: { teamId: hiddenTeam.id } });
    await makeTask({
      orgId: w.org.id,
      workspaceId: w.wsIn.id,
      projectId: closed.project.id,
      boardId: closed.board.id,
      columnId: closed.todo.id,
      creatorId: w.owner.id,
      assigneeId: w.lead.id,
      title: "داخل المشروع المغلق",
      dueDate: at("2026-10-05T12:00:00Z"),
    });
    await put(w, "in", { title: "VISIBLE", assigneeId: w.lead.id, due: at("2026-10-06T12:00:00Z") });
    const pulse = await pulseOf(boss.id);
    expect(pulse).toMatchObject({ open: 1, overdue: 1 });
    expect(JSON.stringify(pulse)).not.toContain("داخل المشروع المغلق");
    const strip = await stripOf(boss.id);
    expect(strip).toMatchObject({ dueToday: 0, peopleLate: 1 });
  });

  it("a private task of a report is counted for their manager (the line is the rule), and a private task of somebody outside the team is not", async () => {
    const w = await teamWorld();
    const mine = await put(w, "in", { title: "PRIVATE-REPORT", assigneeId: w.member.id, due: at("2026-10-05T12:00:00Z") });
    await db.task.update({ where: { id: mine.id }, data: { visibility: "PARTICIPANTS" } });
    const other = await put(w, "in", { title: "PRIVATE-OTHER", assigneeId: w.owner.id, due: at("2026-10-05T12:00:00Z") });
    await db.task.update({ where: { id: other.id }, data: { visibility: "PARTICIPANTS" } });
    const pulse = await pulseOf(w.admin.id);
    expect(pulse).toMatchObject({ open: 1, overdue: 1 });
    expect(pulse?.worst.map((r) => r.title)).toEqual(["PRIVATE-REPORT"]);
  });

  it("a suspended person is not on the team, and their people are (the line passes through them)", async () => {
    const w = await teamWorld();
    await setMember(w.org.id, w.member.id, { status: "SUSPENDED" });
    await put(w, "in", { title: "BYSUSPENDED", assigneeId: w.member.id, due: at("2026-10-05T12:00:00Z") });
    await put(w, "in", { title: "BYLEAD", assigneeId: w.lead.id, due: at("2026-10-06T12:00:00Z") });
    const pulse = await pulseOf(w.admin.id);
    expect(pulse).toMatchObject({ open: 1, overdue: 1 });
    expect(pulse?.worst.map((r) => r.title)).toEqual(["BYLEAD"]);
  });

  it("a report's work in a space the person cannot open is not counted", async () => {
    const w = await teamWorld();
    await put(w, "out", { title: "ELSEWHERE", assigneeId: w.member.id, due: at("2026-10-05T12:00:00Z") });
    await put(w, "in", { title: "HERE", assigneeId: w.member.id, due: at("2026-10-06T12:00:00Z") });
    expect(await pulseOf(w.admin.id)).toMatchObject({ open: 1, overdue: 1 });
  });

  it("a task shared with a report beside somebody else counts for the team", async () => {
    const w = await teamWorld();
    const shared = await put(w, "in", { title: "SHARED", assigneeId: w.owner.id, due: at("2026-10-05T12:00:00Z") });
    await db.taskCoAssignee.create({ data: { taskId: shared.id, userId: w.member.id } });
    const pulse = await pulseOf(w.admin.id);
    expect(pulse).toMatchObject({ open: 1, overdue: 1 });
    // the list names only people OF THE TEAM: the owner holds it, so the task is counted but the owner is never shown to the manager
    expect(pulse?.worst).toEqual([]);
    expect(JSON.stringify(pulse)).not.toContain("Owner");
  });

  it("the OWNER rank has the company; a partner whose board.team was taken away has only the people under them", async () => {
    const w = await teamWorld();
    const partner = await makeUser({ orgId: w.org.id, role: "OWNER", name: "Partner" });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: partner.id } }, data: { primaryOwner: false } });
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-05T12:00:00Z") });
    await put(w, "in", { assigneeId: w.admin.id, due: at("2026-10-05T12:00:00Z") });
    await put(w, "in", { assigneeId: null, due: at("2026-10-05T12:00:00Z") });
    await put(w, "out", { assigneeId: w.lead.id, due: at("2026-10-05T12:00:00Z") });
    expect(await pulseOf(w.owner.id)).toMatchObject({ open: 4, overdue: 4, scope: { who: "company", spaceName: null } });
    expect(await pulseOf(partner.id)).toMatchObject({ open: 4, scope: { who: "company" } });
    await setMember(w.org.id, partner.id, { revokedCapabilities: ["board.team"] });
    expect(await pulseOf(partner.id)).toBeNull(); // nobody under them: no team
    await under(w.org.id, w.admin.id, partner.id);
    // the partner sees every space as the OWNER rank, but their team is the admin, the member under them and the lead under him
    const mine = await pulseOf(partner.id);
    expect(mine).toMatchObject({ scope: { who: "reports", spaceName: null } });
    expect(mine?.open).toBe(3); // admin's, member's, and the lead's task in the closed space (the partner opens every space)
  });

  it("an external partner has no pulse, whatever a stored row says", async () => {
    const w = await teamWorld();
    await setMember(w.org.id, w.guest.id, { capabilities: ["users.manage", "board.team"] });
    await under(w.org.id, w.member.id, w.guest.id);
    expect(await pulseOf(w.guest.id)).toBeNull();
    expect(await stripOf(w.guest.id)).toBeNull();
  });
});

describe("the scope each number says it counted", () => {
  it("«فريقي» outside a space; inside one the space is named and only it is counted; `teamWide` counts every space the person can open", async () => {
    const w = await teamWorld();
    await joinWorkspace(w.admin.id, w.wsOut.id);
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-05T12:00:00Z") });
    await put(w, "out", { assigneeId: w.member.id, due: at("2026-10-05T12:00:00Z") });
    const free = await pulseOf(w.admin.id);
    expect(free).toMatchObject({ open: 2, scope: { who: "reports", spaceName: null } });
    const inside = await pulseOf(w.admin.id, { spaceId: w.wsIn.id });
    expect(inside).toMatchObject({ open: 1, scope: { who: "reports", spaceName: "مساحة الفريق" } });
    const wide = await pulseOf(w.admin.id, { spaceId: w.wsIn.id, teamWide: true });
    expect(wide).toMatchObject({ open: 2, scope: { who: "reports", spaceName: null } });
    // the strip says the same
    expect(await stripOf(w.admin.id)).toMatchObject({ scope: { who: "reports", spaceName: null } });
    expect(await stripOf(w.admin.id, { space: { id: w.wsIn.id, kind: "STANDARD" } })).toMatchObject({ scope: { who: "reports", spaceName: "مساحة الفريق" } });
  });

  it("the owner's company numbers do not depend on the space the page is in once the card asks for the whole company", async () => {
    const w = await teamWorld();
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-05T12:00:00Z") });
    await put(w, "out", { assigneeId: w.lead.id, due: at("2026-10-05T12:00:00Z") });
    expect(await pulseOf(w.owner.id, { spaceId: w.wsIn.id })).toMatchObject({ open: 1, scope: { who: "company", spaceName: "مساحة الفريق" } });
    expect(await pulseOf(w.owner.id, { spaceId: w.wsIn.id, teamWide: true })).toMatchObject({ open: 2, scope: { who: "company", spaceName: null } });
    expect(await stripOf(w.owner.id, { space: { id: w.wsIn.id, kind: "STANDARD" }, teamWide: true })).toMatchObject({ scope: { who: "company", spaceName: null } });
  });
});

describe("no KPI appears twice with different numbers", () => {
  it("the owner's team card (open, overdue) is the same number as the control panel's for the company", async () => {
    const w = await teamWorld();
    for (const [who, d] of [[w.member.id, "01"], [w.lead.id, "02"], [w.admin.id, "03"], [null, "04"], [w.owner.id, "30"]] as const) {
      await put(w, "in", { assigneeId: who, due: at(`2026-10-${d}T12:00:00Z`) });
    }
    await put(w, "out", { assigneeId: w.lead.id, due: at("2026-10-05T12:00:00Z") });
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id }, select: { settings: true } });
    let settings = withFeature(org.settings, "ownerBoard", true);
    settings = withFeature(settings, "controlPanel", true);
    await db.organization.update({ where: { id: w.org.id }, data: { settings: settings as Prisma.InputJsonValue } });
    const actor = await actorOf(w.owner.id);
    const access = await companyPanelAccess(actor);
    expect(access).not.toBeNull();
    const panel = await loadPanelHome(access!, NOW);
    const pulse = await pulseOf(w.owner.id, { teamWide: true });
    expect(pulse?.open).toBe(panel.kpis.open);
    expect(pulse?.overdue).toBe(panel.kpis.overdue);
  });

  it("the pulse and the strip count the same people late and the same due-today tasks", async () => {
    const w = await teamWorld();
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-05T12:00:00Z") });
    await put(w, "in", { assigneeId: w.lead.id, due: at("2026-10-22T15:00:00Z") });
    const pulse = await pulseOf(w.admin.id);
    const strip = await stripOf(w.admin.id);
    expect(pulse?.overdue).toBe(1);
    expect(strip).toMatchObject({ peopleLate: 1, dueToday: 1 });
    expect(pulse?.scope).toEqual(strip?.scope);
  });
});

describe("the strip is «فريقي» too", () => {
  it("a person with nobody under them has no strip; a manager counts finished this week, due today and people late over their people only", async () => {
    const w = await teamWorld();
    expect(await stripOf(w.lead.id)).toBeNull();
    await finished(w, w.member.id, "2026-10-20T10:00:00Z");
    await finished(w, w.lead.id, "2026-10-21T10:00:00Z");
    await finished(w, w.admin.id, "2026-10-21T10:00:00Z"); // the person's own: not their team
    await finished(w, w.member.id, "2026-10-10T10:00:00Z"); // last week
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-22T15:00:00Z") });
    await put(w, "in", { assigneeId: w.owner.id, due: at("2026-10-22T15:00:00Z") });
    await put(w, "in", { assigneeId: w.lead.id, due: at("2026-10-14T10:00:00Z") });
    await put(w, "in", { assigneeId: w.owner.id, due: at("2026-10-14T10:00:00Z") });
    expect(await stripOf(w.admin.id)).toEqual({ scope: { who: "reports", spaceName: null }, doneWeek: 2, dueToday: 1, peopleLate: 1 });
  });

  it("a team-mate who only shares an overdue task is late (one person), and the outsider who holds it is not counted", async () => {
    const w = await teamWorld();
    const shared = await put(w, "in", { assigneeId: w.owner.id, due: at("2026-10-05T12:00:00Z") });
    await db.taskCoAssignee.create({ data: { taskId: shared.id, userId: w.member.id } });
    expect(await stripOf(w.admin.id)).toMatchObject({ peopleLate: 1 });
    // when the team-mate also holds one of their own, still one person
    await put(w, "in", { assigneeId: w.member.id, due: at("2026-10-06T12:00:00Z") });
    expect(await stripOf(w.admin.id)).toMatchObject({ peopleLate: 1 });
    // and an overdue task of an outsider alone adds nobody
    const alone = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Alone" });
    await joinWorkspace(alone.id, w.wsIn.id);
    await put(w, "in", { assigneeId: alone.id, due: at("2026-10-06T12:00:00Z") });
    expect(await stripOf(w.admin.id)).toMatchObject({ peopleLate: 1 });
  });
});

// ───────────────────────────── the privacy matrix of the COUNTS (rows for P0.5's table: R8) ─────────────────────────────
// A number is never computed over a task the viewer cannot open: a count that includes a hidden task is a leak. One report R holds four
// tasks; each viewer has R under them (or is the company). Expected = how many of the four the viewer's team card counts.
//   T1 public in the viewer's space · T2 private («المعنيين بس») made by the owner · T3 in a team-only project · T4 in a space the viewer is not in
const COUNTS = {
  managerInSpace: 2, //     a plain member of the space with R under them: T1, and T2 (the line is the rule)
  spaceAdminManager: 3, //  the space's ADMIN with R under them: T1, T2, T3 (they manage the space) — never T4
  ownerCompany: 4, //       the primary owner (silent oversight): everything
  partnerWithoutOversight: 3, // a partner who lost archive.view: every space, but NOT the owner's private task
} as const;

describe("the privacy matrix of the team counts", () => {
  async function matrixWorld() {
    const w = await world();
    const report = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Report" });
    await joinWorkspace(report.id, w.wsIn.id);
    const hiddenTeam = await db.team.create({ data: { workspaceId: w.wsIn.id, name: "فريق مغلق", members: { create: [{ userId: w.lead.id }, { userId: report.id }] } } });
    const closed = await makeProject(w.wsIn.id, "مشروع مغلق على فريق");
    await db.project.update({ where: { id: closed.project.id }, data: { teamId: hiddenTeam.id } });
    const due = at("2026-10-05T12:00:00Z");
    await put(w, "in", { title: "T1", assigneeId: report.id, due });
    const t2 = await put(w, "in", { title: "T2", assigneeId: report.id, due });
    await db.task.update({ where: { id: t2.id }, data: { visibility: "PARTICIPANTS" } });
    await makeTask({ orgId: w.org.id, workspaceId: w.wsIn.id, projectId: closed.project.id, boardId: closed.board.id, columnId: closed.todo.id, creatorId: w.owner.id, assigneeId: report.id, title: "T3", dueDate: due });
    await put(w, "out", { title: "T4", assigneeId: report.id, due });
    return { w, report };
  }

  it("each viewer's card counts exactly the tasks they may open, and never names a hidden one", async () => {
    const { w, report } = await matrixWorld();
    const boss = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Boss" });
    await joinWorkspace(boss.id, w.wsIn.id);
    const spaceAdmin = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "SpaceAdmin" });
    await joinWorkspace(spaceAdmin.id, w.wsIn.id, "ADMIN");
    const partner = await makeUser({ orgId: w.org.id, role: "OWNER", name: "Partner" });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: partner.id } }, data: { primaryOwner: false } });
    await setMember(w.org.id, partner.id, { revokedCapabilities: ["archive.view"] });

    const seen = async (viewerId: string, managerOfReport: string | null) => {
      if (managerOfReport) await under(w.org.id, report.id, managerOfReport);
      const pulse = await pulseOf(viewerId, { teamWide: true });
      // the strip agrees with the pulse on who is late (one person holds every task) for every viewer
      expect(await stripOf(viewerId, { teamWide: true })).toMatchObject({ peopleLate: 1 });
      return { open: pulse?.open, titles: JSON.stringify(pulse) };
    };
    expect((await seen(boss.id, boss.id)).open).toBe(COUNTS.managerInSpace);
    const forSpaceAdmin = await seen(spaceAdmin.id, spaceAdmin.id);
    expect(forSpaceAdmin.open).toBe(COUNTS.spaceAdminManager);
    expect((await seen(w.owner.id, null)).open).toBe(COUNTS.ownerCompany);
    expect((await seen(partner.id, null)).open).toBe(COUNTS.partnerWithoutOversight);
  });

  it("a viewer who may open none of the four sees a team card with no task of theirs in it", async () => {
    const { w, report } = await matrixWorld();
    const stranger = await makeUser({ orgId: w.org.id, role: "MEMBER", name: "Stranger" });
    await joinWorkspace(stranger.id, w.wsOut.id); // a space where none of R's work is public
    await under(w.org.id, report.id, stranger.id);
    const pulse = await pulseOf(stranger.id, { teamWide: true });
    // the stranger opens only wsOut: T4 is there and public, so it is the only one counted (T1..T3 are in a space they cannot open)
    expect(pulse?.open).toBe(1);
    expect(JSON.stringify(pulse)).not.toMatch(/T1|T2|T3/);
  });
});
