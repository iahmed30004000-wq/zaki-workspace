/**
 * W1.1 — the unified «مهامي» (docs/restructure/W1-work.md §W1.1), against a real database: ONE list of a person's tasks across ALL their spaces, the three scopes,
 * the chips, the stage filter and the board, the visibility rule on every read (a hidden task is not listed, counted, opened or found), the old addresses that
 * redirect behind the switch `workMyTasks`, and the doors (list, quick task, panel, stage move).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

import MyWorkPage from "@/app/(app)/my-work/page";
import ListPage from "@/app/(app)/list/page";
import CalendarPage from "@/app/(app)/calendar/page";
import * as tasksRoute from "@/app/api/work/tasks/route";
import * as taskRoute from "@/app/api/work/tasks/[id]/route";
import * as stageRoute from "@/app/api/work/tasks/[id]/stage/route";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { getWorkTaskDetail, getWorkTasks } from "@/server/services/my-work";
import { DEFAULT_MY_TASKS_PARAMS, MY_TASK_CHIPS, parseMyTasksParams, type MyTasksParams, type WorkTasksResult } from "@/lib/work/my-tasks";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { html, type PageElement } from "./pages-access-helpers";
import { daysFromNow, todayNoon } from "./scoping-helpers";

const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;
afterEach(() => jar().delete(SPACE_COOKIE));

/** One fixed moment; the company's zone is the schema default (Damascus), so «today» is cut there, not on the machine's clock. */
const NOW = new Date("2026-11-20T09:00:00Z");
const P = (over: Partial<MyTasksParams> = {}): MyTasksParams => ({ ...DEFAULT_MY_TASKS_PARAMS, ...over });
const ids = (r: WorkTasksResult) => r.tasks.map((t) => t.id);

async function switchOn(orgId: string, on = true) {
  await db.organization.update({ where: { id: orgId }, data: { settings: { features: { workMyTasks: on, workInbox: true } } } });
}

/**
 * The world: `me` is in THREE spaces (A, B, C) and in an ARCHIVED one; a fifth space (D) is not theirs. Every space has a project with a «للتنفيذ» column
 * (stage TODO) and a «منجزة» one (stage DONE). Tasks of every kind, so each rule has a task that breaks it.
 */
async function world() {
  const t = await makeTeam();
  const orgId = t.org.id;
  const me = t.member;
  const colleague = t.admin;
  const space = async (name: string, members: string[], extra: { archivedAt?: Date } = {}) => {
    const ws = await makeWorkspace(orgId, members.map((userId) => ({ userId })), name);
    if (extra.archivedAt) await db.workspace.update({ where: { id: ws.id }, data: { archivedAt: extra.archivedAt } });
    const made = await makeProject(ws.id, `${name} project`);
    await db.boardColumn.update({ where: { id: made.todo.id }, data: { stage: "TODO" } });
    await db.boardColumn.update({ where: { id: made.done.id }, data: { stage: "DONE" } });
    return { ws, ...made };
  };
  const A = await space("Alpha", [me.id, colleague.id]);
  const B = await space("Beta", [me.id, colleague.id]);
  const C = await space("Gamma", [me.id]);
  const D = await space("Delta", [colleague.id]);
  const E = await space("Epsilon", [me.id], { archivedAt: new Date("2026-01-01T00:00:00Z") });
  const mk = (s: typeof A, title: string, extra: Partial<Parameters<typeof makeTask>[0]> = {}) =>
    makeTask({ orgId, workspaceId: s.ws.id, projectId: s.project.id, boardId: s.board.id, columnId: s.todo.id, creatorId: colleague.id, title, ...extra });

  const tasks = {
    mineA: await mk(A, "mine A", { assigneeId: me.id, dueDate: todayNoon(NOW) }),
    mineB: await mk(B, "mine B", { assigneeId: me.id, dueDate: daysFromNow(-3, NOW) }),
    mineC: await mk(C, "mine C", { assigneeId: me.id, dueDate: daysFromNow(3, NOW) }),
    undated: await mk(A, "mine undated", { assigneeId: me.id }),
    shared: await mk(B, "shared with me", { assigneeId: colleague.id }),
    theirs: await mk(A, "theirs", { assigneeId: colleague.id, dueDate: todayNoon(NOW) }),
    nobody: await mk(A, "nobody's"),
    outsider: await mk(D, "mine but in D", { assigneeId: me.id }),
    archived: await mk(E, "mine in archived", { assigneeId: me.id }),
    done: await mk(A, "finished", { assigneeId: me.id, columnId: A.done.id, completedAt: daysFromNow(-1, NOW) }),
    madeByMe: await mk(B, "i made it", { assigneeId: colleague.id, creatorId: me.id, dueDate: daysFromNow(2, NOW) }),
    hidden: await mk(A, "secret plan", { assigneeId: colleague.id, creatorId: colleague.id, dueDate: todayNoon(NOW) }),
    hiddenMineElsewhere: await mk(B, "secret of mine", { assigneeId: me.id, creatorId: colleague.id }),
  };
  await db.taskCoAssignee.create({ data: { taskId: tasks.shared.id, userId: me.id } });
  // «المعنيين بس»: a private task of the colleague that I am no part of
  await db.task.update({ where: { id: tasks.hidden.id }, data: { visibility: "PARTICIPANTS" } });
  // …and one that I AM a part of (assigned to me), which stays mine
  await db.task.update({ where: { id: tasks.hiddenMineElsewhere.id }, data: { visibility: "PARTICIPANTS" } });
  return { ...t, orgId, me, colleague, A, B, C, D, E, tasks };
}
type World = Awaited<ReturnType<typeof world>>;
const cur = (s: { ws: { id: string } }, kind = "STANDARD") => ({ id: s.ws.id, kind });

describe("scope «أنا»: my tasks from ALL my active spaces, in one list", () => {
  it("lists what is assigned to me or shared with me in three spaces, and not a task of anybody else, of a space that is not mine, of an archived one, or one hidden from me", async () => {
    const w = await world();
    const r = await getWorkTasks(w.me.id, P(), { now: NOW });
    const t = w.tasks;
    expect(ids(r).sort()).toEqual([t.mineA, t.mineB, t.mineC, t.undated, t.shared, t.hiddenMineElsewhere].map((x) => x.id).sort());
    for (const out of [t.theirs, t.nobody, t.outsider, t.archived, t.done, t.hidden, t.madeByMe]) expect(ids(r), out.title).not.toContain(out.id);
    // one answer carries the spaces to filter by (not the archived one, not the one that is not mine)
    expect(r.spaces.map((s) => s.name).sort()).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(new Set(r.tasks.map((x) => x.spaceName))).toEqual(new Set(["Alpha", "Beta", "Gamma"]));
  });

  it("a space chip narrows it to that space (a space that is not mine is ignored, never widening anything)", async () => {
    const w = await world();
    const onlyB = await getWorkTasks(w.me.id, P({ spaceId: w.B.ws.id }), { now: NOW });
    expect(ids(onlyB).sort()).toEqual([w.tasks.mineB, w.tasks.shared, w.tasks.hiddenMineElsewhere].map((x) => x.id).sort());
    const foreign = await getWorkTasks(w.me.id, P({ spaceId: w.D.ws.id }), { now: NOW });
    expect(ids(foreign)).not.toContain(w.tasks.outsider.id);
    expect(ids(foreign)).toEqual(ids(await getWorkTasks(w.me.id, P(), { now: NOW })));
  });

  it("works in «الشركة» too: it holds no projects, so the screen aggregates my spaces (and «المساحة» there is «أنا»)", async () => {
    const w = await world();
    const hq = await db.workspace.create({ data: { organizationId: w.orgId, name: "الشركة", slug: `hq-${w.orgId}`, systemKey: "hq", kind: "HQ", members: { create: [{ userId: w.me.id }] } } });
    const inHq = { id: hq.id, kind: "HQ" };
    const me = await getWorkTasks(w.me.id, P(), { now: NOW, current: inHq });
    expect(ids(me).length).toBe(6);
    expect(me.current.hq).toBe(true);
    // the HQ is not a space to filter by
    expect(me.spaces.map((s) => s.name)).not.toContain("الشركة");
    const asked = await getWorkTasks(w.me.id, P({ scope: "space" }), { now: NOW, current: inHq });
    expect(asked.scopeFellBack).toBe(true);
    expect(asked.params.scope).toBe("me");
    expect(ids(asked).sort()).toEqual(ids(me).sort());
  });

  it("a person with no space, and a stranger, get an empty screen and no error", async () => {
    const w = await world();
    const loner = await makeUser({ orgId: w.orgId, role: "MEMBER" });
    expect((await getWorkTasks(loner.id, P(), { now: NOW })).tasks).toEqual([]);
    expect((await getWorkTasks((await makeUser()).id, P(), { now: NOW })).tasks).toEqual([]);
  });
});

describe("a hidden task is not listed, counted, found or opened (P0.2)", () => {
  it("a private task of somebody else's is in no scope, no chip count, no text search, no panel — and the people it concerns still read it", async () => {
    const w = await world();
    const hid = w.tasks.hidden;
    for (const params of [P(), P({ scope: "space" }), P({ scope: "project", projectId: w.A.project.id }), P({ view: "board" }), P({ chip: "today" }), P({ q: "secret" })]) {
      const r = await getWorkTasks(w.me.id, params, { now: NOW, current: cur(w.A) });
      expect(ids(r), JSON.stringify(params)).not.toContain(hid.id);
    }
    // not counted: «اليوم» of the space holds my mineA and their task, never the private one (3 would be the number with the leak)
    const space = await getWorkTasks(w.me.id, P({ scope: "space" }), { now: NOW, current: cur(w.A) });
    expect(space.counts.today).toBe(2);
    expect(space.tasks.find((x) => x.id === hid.id)).toBeUndefined();
    // not found by the text, not opened
    const found = await getWorkTasks(w.me.id, P({ scope: "space", q: "secret plan" }), { now: NOW, current: cur(w.A) });
    expect(ids(found)).not.toContain(hid.id);
    expect(await getWorkTaskDetail(w.me.id, hid.id)).toBeNull();
    // the colleague it is assigned to reads it everywhere
    const theirs = await getWorkTasks(w.colleague.id, P({ scope: "space", q: "secret plan" }), { now: NOW, current: cur(w.A) });
    expect(ids(theirs)).toContain(hid.id);
    expect((await getWorkTaskDetail(w.colleague.id, hid.id))?.task.id).toBe(hid.id);
    // …and the one that is private but assigned to me stays in MY list (I am a participant)
    expect(ids(await getWorkTasks(w.me.id, P(), { now: NOW }))).toContain(w.tasks.hiddenMineElsewhere.id);
  });

  it("the space's manager and the owner are not people it hides from... but a plain member of the space and a guest are", async () => {
    const w = await world();
    const bystander = await makeUser({ orgId: w.orgId, role: "MEMBER" });
    await db.workspaceMember.create({ data: { workspaceId: w.A.ws.id, userId: bystander.id } });
    const seen = await getWorkTasks(bystander.id, P({ scope: "space" }), { now: NOW, current: cur(w.A) });
    expect(ids(seen)).not.toContain(w.tasks.hidden.id);
    expect(ids(seen)).toContain(w.tasks.theirs.id);
    await db.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId: w.A.ws.id, userId: w.guest.id } }, create: { workspaceId: w.A.ws.id, userId: w.guest.id, role: "GUEST" }, update: {} });
    const guest = await getWorkTasks(w.guest.id, P({ scope: "space" }), { now: NOW, current: cur(w.A) });
    expect(ids(guest)).not.toContain(w.tasks.hidden.id);
  });
});

describe("scope «المساحة» and scope «مشروع»", () => {
  it("«المساحة» is the current space's visible tasks, whoever they are for — and only that space", async () => {
    const w = await world();
    const r = await getWorkTasks(w.me.id, P({ scope: "space" }), { now: NOW, current: cur(w.A) });
    const t = w.tasks;
    expect(ids(r).sort()).toEqual([t.mineA, t.undated, t.theirs, t.nobody].map((x) => x.id).sort());
    expect(r.scopeFellBack).toBe(false);
    // no current space: «أنا»
    const none = await getWorkTasks(w.me.id, P({ scope: "space" }), { now: NOW, current: null });
    expect(none.scopeFellBack).toBe(true);
    // a current space that is not mine: «أنا», never that space's tasks
    const foreign = await getWorkTasks(w.me.id, P({ scope: "space" }), { now: NOW, current: cur(w.D) });
    expect(foreign.scopeFellBack).toBe(true);
    expect(ids(foreign)).not.toContain(t.outsider.id);
  });

  it("«مشروع» is one project's visible tasks; the picker offers only projects I may see; a project that is not mine is empty", async () => {
    const w = await world();
    const r = await getWorkTasks(w.me.id, P({ scope: "project", projectId: w.B.project.id }), { now: NOW });
    expect(ids(r).sort()).toEqual([w.tasks.mineB, w.tasks.shared, w.tasks.madeByMe, w.tasks.hiddenMineElsewhere].map((x) => x.id).sort());
    expect(r.projects.map((p) => p.name).sort()).toEqual(["Alpha project", "Beta project", "Gamma project"]);
    expect((await getWorkTasks(w.me.id, P({ scope: "project", projectId: w.D.project.id }), { now: NOW })).tasks).toEqual([]);
    expect((await getWorkTasks(w.me.id, P({ scope: "project", projectId: null }), { now: NOW })).tasks).toEqual([]);
  });

  it("a project of a team the person is not in is not in the picker and has no tasks for them", async () => {
    const w = await world();
    const section = await db.team.create({ data: { workspaceId: w.A.ws.id, name: "Section", members: { create: [{ userId: w.colleague.id }] } } });
    const teamProject = await makeProject(w.A.ws.id, "Team project");
    await db.project.update({ where: { id: teamProject.project.id }, data: { teamId: section.id } });
    const teamTask = await makeTask({ orgId: w.orgId, workspaceId: w.A.ws.id, projectId: teamProject.project.id, boardId: teamProject.board.id, columnId: teamProject.todo.id, creatorId: w.colleague.id, assigneeId: w.me.id, title: "team work" });
    const r = await getWorkTasks(w.me.id, P({ scope: "project", projectId: teamProject.project.id }), { now: NOW });
    expect(r.tasks).toEqual([]);
    expect(r.projects.map((p) => p.id)).not.toContain(teamProject.project.id);
    expect(ids(await getWorkTasks(w.me.id, P(), { now: NOW }))).not.toContain(teamTask.id);
  });
});

describe("the chips, their counts, the stage and the views", () => {
  it("each chip lists what its name says, and its number is the length of its list", async () => {
    const w = await world();
    const t = w.tasks;
    const chip = async (c: MyTasksParams["chip"], extra: Partial<MyTasksParams> = {}) => getWorkTasks(w.me.id, P({ chip: c, ...extra }), { now: NOW });
    expect(ids(await chip("today"))).toEqual([t.mineA.id]);
    expect(ids(await chip("overdue"))).toEqual([t.mineB.id]);
    expect(ids(await chip("week")).sort()).toEqual([t.mineA.id, t.mineC.id].sort());
    expect(ids(await chip("nodate")).sort()).toEqual([t.undated.id, t.shared.id, t.hiddenMineElsewhere.id].sort());
    expect(ids(await chip("done"))).toEqual([t.done.id]);
    // «أنشأتها»: what I made, whoever it is for — the «أنا» filter gives way to it
    expect(ids(await chip("created"))).toEqual([t.madeByMe.id]);
    const all = await chip(null);
    for (const c of MY_TASK_CHIPS) expect(all.counts[c], c).toBe((await chip(c)).tasks.length);
  });

  it("«أنشأتها» in a space is what I made there; «اليوم» is the company's day, not the machine's", async () => {
    const w = await world();
    const inB = await getWorkTasks(w.me.id, P({ scope: "space", chip: "created" }), { now: NOW, current: cur(w.B) });
    expect(ids(inB)).toEqual([w.tasks.madeByMe.id]);
    // 22:30 UTC is already tomorrow in Damascus: «اليوم» follows the company
    const late = new Date("2026-11-20T22:30:00Z");
    const tomorrowNoon = await makeTask({ orgId: w.orgId, workspaceId: w.A.ws.id, projectId: w.A.project.id, boardId: w.A.board.id, columnId: w.A.todo.id, creatorId: w.colleague.id, assigneeId: w.me.id, title: "tomorrow", dueDate: todayNoon(late) });
    expect(ids(await getWorkTasks(w.me.id, P({ chip: "today" }), { now: late }))).toContain(tomorrowNoon.id);
    expect(ids(await getWorkTasks(w.me.id, P({ chip: "today" }), { now: NOW }))).not.toContain(tomorrowNoon.id);
  });

  it("the stage filter keeps the tasks whose column has that stage; each row carries its stage; the board shows the open work and the lately finished", async () => {
    const w = await world();
    const done = await getWorkTasks(w.me.id, P({ stage: "DONE", chip: "done" }), { now: NOW });
    expect(ids(done)).toEqual([w.tasks.done.id]);
    expect((await getWorkTasks(w.me.id, P({ stage: "TODO" }), { now: NOW })).tasks.every((x) => x.columnStage === "TODO")).toBe(true);
    expect((await getWorkTasks(w.me.id, P({ stage: "REVIEW" }), { now: NOW })).tasks).toEqual([]);
    const board = await getWorkTasks(w.me.id, P({ view: "board" }), { now: NOW });
    expect(board.tasks.find((x) => x.id === w.tasks.done.id)?.columnStage).toBe("DONE");
    expect(ids(board)).toContain(w.tasks.mineA.id);
    // a task finished a month ago is not on the board
    await db.task.update({ where: { id: w.tasks.done.id }, data: { completedAt: daysFromNow(-30, NOW) } });
    expect(ids(await getWorkTasks(w.me.id, P({ view: "board" }), { now: NOW }))).not.toContain(w.tasks.done.id);
  });

  it("the calendar holds the open tasks due in the month, on the company's calendar", async () => {
    const w = await world();
    const cal = await getWorkTasks(w.me.id, P({ view: "calendar", month: "2026-11" }), { now: NOW });
    expect(cal.month).toBe("2026-11");
    expect(ids(cal).sort()).toEqual([w.tasks.mineA.id, w.tasks.mineB.id, w.tasks.mineC.id].sort());
    expect((await getWorkTasks(w.me.id, P({ view: "calendar", month: "2027-03" }), { now: NOW })).tasks).toEqual([]);
    // the calendar has no chips: a chip left in the address is not applied there
    const withChip = await getWorkTasks(w.me.id, P({ view: "calendar", month: "2026-11", chip: "created" }), { now: NOW });
    expect(ids(withChip).sort()).toEqual(ids(cal).sort());
  });

  it("sorting and the text search work together with a scope", async () => {
    const w = await world();
    const byTitle = await getWorkTasks(w.me.id, P({ sort: "title" }), { now: NOW });
    expect(byTitle.tasks.map((x) => x.title)).toEqual([...byTitle.tasks.map((x) => x.title)].sort((a, b) => a.localeCompare(b, "ar")));
    const found = await getWorkTasks(w.me.id, P({ q: "mine C" }), { now: NOW });
    expect(ids(found)).toEqual([w.tasks.mineC.id]);
  });

  it("an editable flag follows the space role: a guest row of a space is read-only", async () => {
    const w = await world();
    const r = await getWorkTasks(w.me.id, P(), { now: NOW });
    expect(r.tasks.every((x) => x.editable)).toBe(true);
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: w.C.ws.id, userId: w.me.id } }, data: { role: "GUEST" } });
    const after = await getWorkTasks(w.me.id, P(), { now: NOW });
    expect(after.tasks.find((x) => x.id === w.tasks.mineC.id)?.editable).toBe(false);
    expect(after.tasks.find((x) => x.id === w.tasks.mineA.id)?.editable).toBe(true);
  });
});

describe("the old addresses, behind the switch", () => {
  const land = async (page: () => unknown) => {
    try {
      const tree = (await page()) as PageElement;
      return { kind: "rendered" as const, tree };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const to = /^NEXT_REDIRECT:(.*)$/.exec(message)?.[1];
      if (to !== undefined) return { kind: "redirect" as const, to };
      throw err;
    }
  };

  it("OFF (the default): /my-work is today's page and /list and /calendar are their own pages — nothing moved", async () => {
    const w = await world();
    await switchOn(w.orgId, false);
    await loginAs(w.me.id);
    jar().set(SPACE_COOKIE, w.A.ws.id);
    const mine = await land(() => MyWorkPage({ searchParams: {} }));
    expect(mine.kind).toBe("rendered");
    const markup = await html((mine as { tree: PageElement }).tree);
    // the old page's six inner tabs
    expect(markup).toContain("/my-work?tab=upcoming");
    expect((await land(() => ListPage({ searchParams: {} }))).kind).toBe("rendered");
    expect((await land(() => CalendarPage({ searchParams: {} }))).kind).toBe("rendered");
  });

  it("ON: /list and /calendar redirect to «مهامي» with ?view=list|calendar&scope=space, keeping what still means something", async () => {
    const w = await world();
    await switchOn(w.orgId);
    await loginAs(w.me.id);
    jar().set(SPACE_COOKIE, w.A.ws.id);
    expect(await land(() => ListPage({ searchParams: {} }))).toEqual({ kind: "redirect", to: "/my-work?view=list&scope=space" });
    expect(await land(() => CalendarPage({ searchParams: {} }))).toEqual({ kind: "redirect", to: "/my-work?view=calendar&scope=space" });
    expect(await land(() => CalendarPage({ searchParams: { mine: "1", month: "2026-12" } }))).toEqual({ kind: "redirect", to: "/my-work?view=calendar&scope=me&month=2026-12" });
    // …and an address with a workspace named in it is still never trusted: the redirect names none
    const withWs = await land(() => ListPage({ searchParams: { workspace: w.D.ws.id } }));
    expect(withWs).toEqual({ kind: "redirect", to: "/my-work?view=list&scope=space" });
  });

  it("ON: the six old inner tabs open as chips (?tab=today is «اليوم») and the page draws the unified screen with the first answer in it", async () => {
    const w = await world();
    await switchOn(w.orgId);
    await loginAs(w.me.id);
    jar().set(SPACE_COOKIE, w.A.ws.id);
    const tabs: Record<string, string | null> = { today: "today", upcoming: "week", overdue: "overdue", completed: "done", mine: null, created: "created" };
    for (const [tab, chip] of Object.entries(tabs)) {
      const page = await land(() => MyWorkPage({ searchParams: { tab } }));
      expect(page.kind, tab).toBe("rendered");
      const props = (page as { tree: PageElement }).tree.props as { requested: MyTasksParams; initial: WorkTasksResult };
      expect(props.requested.chip, tab).toBe(chip);
      expect(props.initial.params.chip, tab).toBe(chip);
    }
    const page = await land(() => MyWorkPage({ searchParams: { view: "board", scope: "space" } }));
    const props = (page as { tree: PageElement }).tree.props as { initial: WorkTasksResult };
    expect(props.initial.params).toMatchObject({ view: "board", scope: "space" });
    expect(props.initial.tasks.map((x) => x.id)).toContain(w.tasks.theirs.id);
    expect(props.initial.tasks.map((x) => x.id)).not.toContain(w.tasks.hidden.id);
    // it draws (the rows, the chips)
    const markup = await html((page as { tree: PageElement }).tree);
    expect(markup).toContain("data-stage=\"TODO\"");
    expect(markup).toContain("theirs");
    expect(markup).not.toContain("secret plan");
  });

  it("ON: the page for an address that parses to nothing known is just the default screen, never an error", async () => {
    const w = await world();
    await switchOn(w.orgId);
    await loginAs(w.me.id);
    const page = await land(() => MyWorkPage({ searchParams: { view: "nonsense", scope: "everything", chip: "x" } }));
    expect(page.kind).toBe("rendered");
    expect(parseMyTasksParams({ view: "nonsense" })).toEqual(DEFAULT_MY_TASKS_PARAMS);
  });
});

describe("the doors", () => {
  it("GET /api/work/tasks: 404 while the switch is off; on, it answers the same screen the page draws, with no hidden task in it", async () => {
    const w = await world();
    await loginAs(w.me.id);
    await switchOn(w.orgId, false);
    expect((await call(tasksRoute.GET, { url: "http://localhost/api/work/tasks" })).status).toBe(404);
    await switchOn(w.orgId);
    const res = await call(tasksRoute.GET, { url: "http://localhost/api/work/tasks?chip=today" });
    expect(res.status).toBe(200);
    expect((res.json?.["tasks"] as { id: string }[]).map((x) => x.id)).toEqual([w.tasks.mineA.id]);
    const all = await call(tasksRoute.GET, { url: "http://localhost/api/work/tasks?scope=me" });
    expect(all.text).not.toContain("secret plan");
    expect(all.text).not.toContain(w.tasks.hidden.id);
    // scope «المساحة» is the space the person is in (the cookie), checked
    jar().set(SPACE_COOKIE, w.A.ws.id);
    const space = await call(tasksRoute.GET, { url: "http://localhost/api/work/tasks?scope=space" });
    expect((space.json?.["tasks"] as { id: string }[]).map((x) => x.id).sort()).toEqual([w.tasks.mineA, w.tasks.undated, w.tasks.theirs, w.tasks.nobody].map((x) => x.id).sort());
    // nobody signed in
    const { logout } = await import("./helpers");
    logout();
    expect((await call(tasksRoute.GET, { url: "http://localhost/api/work/tasks" })).status).toBe(401);
  });

  it("GET /api/work/tasks/[id]: the panel's task; a hidden task is 404 (its existence is private too), and so is one in a space that is not mine", async () => {
    const w = await world();
    await switchOn(w.orgId);
    await loginAs(w.me.id);
    const ok = await call(taskRoute.GET, { params: { id: w.tasks.mineA.id } });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ task: { id: w.tasks.mineA.id, title: "mine A", columnStage: "TODO", editable: true } });
    for (const hidden of [w.tasks.hidden, w.tasks.outsider]) {
      const res = await call(taskRoute.GET, { params: { id: hidden.id } });
      expect(res.status, hidden.title).toBe(404);
      expect(res.text).not.toContain(hidden.title);
    }
  });

  it("POST /api/work/tasks: a title is all it needs; it is mine, in «صندوق المهام» of the space I am in, private by default (it has an assignee)", async () => {
    const w = await world();
    await switchOn(w.orgId);
    await loginAs(w.me.id);
    jar().set(SPACE_COOKIE, w.B.ws.id);
    const res = await call(tasksRoute.POST, { body: { title: "just a title" } });
    expect(res.status).toBe(201);
    const task = await db.task.findUniqueOrThrow({ where: { id: (res.json?.["task"] as { id: string }).id }, include: { project: true, column: true } });
    expect(task).toMatchObject({ title: "just a title", assigneeId: w.me.id, workspaceId: w.B.ws.id, visibility: "PARTICIPANTS" });
    expect(task.project.systemKey).toBe("instant");
    // a missing title is refused; the switch off is 404
    expect((await call(tasksRoute.POST, { body: { title: "  " } })).status).toBe(422);
    await switchOn(w.orgId, false);
    expect((await call(tasksRoute.POST, { body: { title: "x" } })).status).toBe(404);
  });

  it("POST /api/work/tasks inside «الشركة» lands in my first standard space; with none it says why (403 instant.no_space)", async () => {
    const w = await world();
    await switchOn(w.orgId);
    const hq = await db.workspace.create({ data: { organizationId: w.orgId, name: "الشركة", slug: `hq-${w.orgId}`, systemKey: "hq", kind: "HQ", members: { create: [{ userId: w.me.id }] } } });
    await loginAs(w.me.id);
    jar().set(SPACE_COOKIE, hq.id);
    const res = await call(tasksRoute.POST, { body: { title: "from the company" } });
    expect(res.status).toBe(201);
    const spaceId = (res.json?.["space"] as { id: string }).id;
    expect([w.A.ws.id, w.B.ws.id, w.C.ws.id]).toContain(spaceId);
    const only = await makeUser({ orgId: w.orgId, role: "MEMBER" });
    await db.workspaceMember.create({ data: { workspaceId: hq.id, userId: only.id } });
    await loginAs(only.id);
    jar().set(SPACE_COOKIE, hq.id);
    const none = await call(tasksRoute.POST, { body: { title: "nowhere" } });
    expect(none.status).toBe(403);
    expect(none.json?.["message"]).toBe("instant.no_space");
  });

  it("POST /api/work/tasks/[id]/stage: moves the task to the first column of ITS board with that stage; no such column is 422 and nothing moves; a hidden task is 404", async () => {
    const w = await world();
    await switchOn(w.orgId);
    await loginAs(w.me.id);
    const t = w.tasks.mineA;
    const moved = await call(stageRoute.POST, { params: { id: t.id }, body: { stage: "DONE" } });
    expect(moved.status).toBe(200);
    const after = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.columnId).toBe(w.A.done.id);
    expect(after.completedAt).not.toBeNull();
    // back to TODO: open again
    expect((await call(stageRoute.POST, { params: { id: t.id }, body: { stage: "TODO" } })).status).toBe(200);
    const reopened = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(reopened.columnId).toBe(w.A.todo.id);
    expect(reopened.completedAt).toBeNull();
    // the board has no REVIEW column
    const none = await call(stageRoute.POST, { params: { id: t.id }, body: { stage: "REVIEW" } });
    expect(none.status).toBe(422);
    expect(JSON.stringify(none.json)).toContain("work.stage_missing");
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).columnId).toBe(w.A.todo.id);
    // a bad stage is refused; a hidden task does not exist
    expect((await call(stageRoute.POST, { params: { id: t.id }, body: { stage: "SOON" } })).status).toBe(422);
    expect((await call(stageRoute.POST, { params: { id: w.tasks.hidden.id }, body: { stage: "DONE" } })).status).toBe(404);
    // a guest of the space never moves a task
    await loginAs(w.guest.id);
    expect([403, 404]).toContain((await call(stageRoute.POST, { params: { id: t.id }, body: { stage: "DONE" } })).status);
  });
});

describe("a guest (external partner) sees only what is shared with them", () => {
  it("their «مهامي» holds their own shared space's tasks, never another space's, and the page serves them", async () => {
    const w = await world();
    await switchOn(w.orgId);
    await db.workspaceMember.create({ data: { workspaceId: w.A.ws.id, userId: w.guest.id, role: "GUEST" } });
    const mine = await makeTask({ orgId: w.orgId, workspaceId: w.A.ws.id, projectId: w.A.project.id, boardId: w.A.board.id, columnId: w.A.todo.id, creatorId: w.colleague.id, assigneeId: w.guest.id, title: "for the guest" });
    await loginAs(w.guest.id);
    const r = await getWorkTasks(w.guest.id, P({ scope: "space" }), { now: NOW, current: cur(w.A) });
    expect(ids(r)).toContain(mine.id);
    expect(ids(r)).not.toContain(w.tasks.hidden.id);
    expect(r.tasks.every((x) => x.editable === false)).toBe(true);
    expect(r.spaces.map((s) => s.name)).toEqual(["Alpha"]);
    expect(JSON.stringify(r)).not.toContain("Beta");
    jar().set(SPACE_COOKIE, w.A.ws.id);
    const page = (await MyWorkPage({ searchParams: {} })) as PageElement;
    expect(await html(page)).not.toContain("Beta");
  });
});
