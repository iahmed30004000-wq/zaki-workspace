/**
 * B4 — «كل مساحة حساب لحالها» (the owner's decision of 2026-10-25, re-stated on 2026-11-21: «المساحات معزولة»), the parts that are not «مهامي», «الطلبات»
 * or «مهام قديمة» (their own files hold those): the quick add that names and asks for its space, «اليوم» (the same list that was counted, «الشركة» as the
 * view over all the spaces, the team card with real numbers there, the ticket a follow-up opens) and the overview (one source for the per-space numbers,
 * a real link for the late work, an «أفكار» number that is what its link opens). Against a real database.
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

import type { Prisma } from "@prisma/client";
import HomePage from "@/app/(app)/page";
import TicketsPage from "@/app/(app)/tickets/page";
import * as instantRoute from "@/app/api/instant/route";
import * as inboxRoute from "@/app/api/instant/inbox/route";
import * as tasksRoute from "@/app/api/work/tasks/route";
import { withFeature } from "@/lib/features";
import { goHref } from "@/lib/space-link";
import { DEFAULT_MY_TASKS_PARAMS, myTasksHref } from "@/lib/work/my-tasks";
import { requireActor } from "@/server/policy/actor";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { controlPanelAccess, loadPanelHome, loadPanelReports } from "@/server/services/control-panel";
import { getWorkTasks } from "@/server/services/my-work";
import { spacesOverview } from "@/server/services/spaces-overview";
import { getToday } from "@/server/services/today";
import { getTodayBySpace } from "@/server/services/today-dashboard";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeWorkspace } from "./helpers";
import { makeDepartment, makeTicket } from "./guest-helpers";
import { actorOf, html, put, world as todayWorld, todayNoon } from "./today-helpers";

const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;
afterEach(() => jar().delete(SPACE_COOKIE));

const DAY = 86_400_000;

async function setFeatures(orgId: string, features: Record<string, boolean>) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  let settings: Record<string, unknown> = (org.settings as Record<string, unknown> | null) ?? {};
  for (const [key, on] of Object.entries(features)) settings = withFeature(settings, key as never, on);
  await db.organization.update({ where: { id: orgId }, data: { settings: settings as Prisma.InputJsonValue } });
}

const hqFor = (orgId: string, userIds: string[]) =>
  db.workspace.create({ data: { organizationId: orgId, name: "الشركة", slug: `hq-${orgId}`, systemKey: "hq", kind: "HQ", members: { create: userIds.map((userId) => ({ userId })) } } });

// ───────────────────────────────────────── B4.5 the quick add ─────────────────────────────────────────

describe("B4.5 — the quick add names the space it files into, and in «الشركة» the person chooses", () => {
  async function quickWorld() {
    const t = await makeTeam();
    const alpha = await makeWorkspace(t.org.id, [{ userId: t.member.id }], "Alpha");
    const beta = await makeWorkspace(t.org.id, [{ userId: t.member.id }], "Beta");
    const other = await makeWorkspace(t.org.id, [{ userId: t.admin.id }], "Elsewhere");
    const hq = await hqFor(t.org.id, [t.member.id]);
    await setFeatures(t.org.id, { workInbox: true, workMyTasks: true, instantWork: true });
    return { ...t, alpha, beta, other, hq };
  }

  it("POST /api/instant/inbox with a spaceId files into THAT space of the person's (and answers with its name); a space that is not theirs is refused", async () => {
    const w = await quickWorld();
    await loginAs(w.member.id);
    jar().set(SPACE_COOKIE, w.hq.id);
    const res = await call(inboxRoute.POST, { body: { title: "من الشركة إلى بيتا", spaceId: w.beta.id } });
    expect(res.status).toBe(201);
    expect(res.json?.["space"]).toMatchObject({ id: w.beta.id, name: "Beta" });
    expect((await db.task.findUniqueOrThrow({ where: { id: (res.json?.["task"] as { id: string }).id } })).workspaceId).toBe(w.beta.id);
    const foreign = await call(inboxRoute.POST, { body: { title: "x", spaceId: w.other.id } });
    expect(foreign.status).toBe(403);
    expect(foreign.json?.["message"]).toBe("instant.no_space");
    // no spaceId: still the space the person is in (inside «الشركة» the first standard space, as before: other callers keep working), and the answer names it
    const plain = await call(inboxRoute.POST, { body: { title: "بلا اختيار" } });
    expect(plain.status).toBe(201);
    expect((plain.json?.["space"] as { name: string }).name).toBeTruthy();
  });

  it("GET /api/instant: inside «الشركة» it says the person must choose and lists their spaces; inside a space it does not", async () => {
    const w = await quickWorld();
    await loginAs(w.member.id);
    jar().set(SPACE_COOKIE, w.hq.id);
    const inHq = (await call(instantRoute.GET)).json as { inbox: { choose?: boolean; spaces?: { id: string; name: string }[] } };
    expect(inHq.inbox.choose).toBe(true);
    expect(inHq.inbox.spaces?.map((s) => s.name).sort()).toEqual(["Alpha", "Beta"]);
    jar().set(SPACE_COOKIE, w.alpha.id);
    const inAlpha = (await call(instantRoute.GET)).json as { inbox: { choose?: boolean; spaces?: { id: string; name: string }[]; space: { name: string } | null } };
    expect(inAlpha.inbox.choose).toBe(false);
    expect(inAlpha.inbox.space?.name).toBe("Alpha");
  });

  it("POST /api/work/tasks (the line of «مهامي») takes the screen's space and names it", async () => {
    const w = await quickWorld();
    await loginAs(w.member.id);
    jar().set(SPACE_COOKIE, w.alpha.id);
    const res = await call(tasksRoute.POST, { body: { title: "من مهامي إلى بيتا", spaceId: w.beta.id } });
    expect(res.status).toBe(201);
    expect(res.json?.["space"]).toMatchObject({ id: w.beta.id, name: "Beta" });
    const stray = await call(tasksRoute.POST, { body: { title: "غريبة", spaceId: w.other.id } });
    expect(stray.status).toBe(403);
    // without it: the space the person is in
    const plain = await call(tasksRoute.POST, { body: { title: "هنا" } });
    expect((plain.json?.["space"] as { id: string }).id).toBe(w.alpha.id);
  });
});

// ───────────────────────────────────────── B4.6 «اليوم» ─────────────────────────────────────────

describe("B4.6 — «اليوم»", () => {
  const todayPage = () => HomePage({ searchParams: { view: "today" } });

  async function twoSpaces() {
    const w = await todayWorld();
    await setFeatures(w.org.id, { navV2: true, workInbox: true });
    const now = Date.now();
    await put(w, "in", { title: "متأخرة عندي", assigneeId: w.member.id, due: new Date(now - 3 * DAY) });
    // the whole of today (noon, no hour): an hour of «now» would be late a moment later
    await put(w, "in", { title: "اليوم عندي", assigneeId: w.member.id, due: todayNoon("UTC", new Date(now)) });
    await put(w, "in", { title: "لاحقًا عندي", assigneeId: w.member.id, due: new Date(now + 4 * DAY) });
    // the member is in a second space too
    const wsTwo = await makeWorkspace(w.org.id, [{ userId: w.member.id }], "مساحة ثانية");
    const two = await makeProject(wsTwo.id, "مشروع ثانٍ");
    await makeTask({ orgId: w.org.id, workspaceId: wsTwo.id, projectId: two.project.id, boardId: two.board.id, columnId: two.todo.id, creatorId: w.owner.id, assigneeId: w.member.id, title: "في الثانية", dueDate: new Date(now - 2 * DAY) });
    return { w, wsTwo };
  }

  it("the numbers on the card are the list its links open: Today's counts equal «مهامي»'s chips in the same space", async () => {
    const { w } = await twoSpaces();
    jar().set(SPACE_COOKIE, w.wsIn.id);
    const actor = await actorOf(w.member.id);
    const today = await getToday(actor, { spaceId: w.wsIn.id });
    const mine = await getWorkTasks(w.member.id, { ...DEFAULT_MY_TASKS_PARAMS }, { current: { id: w.wsIn.id, kind: "STANDARD" } });
    expect(mine.counts.overdue).toBe(today.tasks.counts.overdue);
    expect(mine.counts.today).toBe(today.tasks.counts.today);
    // «عرض كل مهامي»: all of the open work of that one space, not every space's
    expect(mine.tasks.length).toBe(today.tasks.counts.open);
    // and the links on the card are the plain «مهامي» addresses, which open on the space the person is in
    const markup = await html(todayPage());
    expect(markup).toContain('href="/my-work"');
    expect(markup).toContain("متأخرة عندي");
  });

  it("«الشركة»: Today is the person's per-space summary (name, open, late, unread, «انتقل»), not an empty page and not a task list", async () => {
    const { w, wsTwo } = await twoSpaces();
    const hq = await hqFor(w.org.id, [w.member.id]);
    jar().set(SPACE_COOKIE, hq.id);
    const rows = await getTodayBySpace(await actorOf(w.member.id));
    const inA = rows.find((r) => r.id === w.wsIn.id);
    const inB = rows.find((r) => r.id === wsTwo.id);
    expect(inA).toMatchObject({ name: "مساحة الفريق", open: 3, overdue: 1 });
    expect(inB).toMatchObject({ name: "مساحة ثانية", open: 1, overdue: 1 });
    // «الشركة» itself, and a space the person is not in, are not rows
    expect(rows.map((r) => r.id)).not.toContain(hq.id);
    expect(rows.map((r) => r.id)).not.toContain(w.wsOut.id);

    const markup = await html(todayPage());
    expect(markup).toContain("data-today-hq");
    expect(markup).toContain("مساحة الفريق");
    expect(markup).toContain("مساحة ثانية");
    expect(markup).toContain(`href="${goHref(wsTwo.id)}"`);
    expect(markup).not.toContain('data-tour="today-tasks"');
    expect(markup).not.toContain("متأخرة عندي");
  });

  it("inside a space there is no summary of the others (they are only counts on the drawer)", async () => {
    const { w } = await twoSpaces();
    jar().set(SPACE_COOKIE, w.wsIn.id);
    await loginAs(w.member.id);
    const markup = await html(todayPage());
    expect(markup).not.toContain("data-today-hq");
    expect(markup).toContain("متأخرة عندي");
    expect(markup).not.toContain("في الثانية");
  });

  it("the team card inside «الشركة» draws real numbers (the company's, the scope said by the service) instead of the zeros of an empty space", async () => {
    const { w } = await twoSpaces();
    await setFeatures(w.org.id, { navV2: true });
    const hq = await hqFor(w.org.id, [w.owner.id]);
    jar().set(SPACE_COOKIE, hq.id);
    await loginAs(w.owner.id);
    const markup = await html(todayPage());
    const card = /<section[^>]*aria-labelledby="today-team-title"[\s\S]*?<\/section>/.exec(markup)?.[0] ?? "";
    expect(card).not.toBe("");
    const actor = await actorOf(w.owner.id);
    const wide = await getToday(actor, { spaceId: hq.id, teamWide: true });
    expect(wide.pulse?.open ?? 0).toBeGreaterThan(0);
    expect(card).toContain(`>${wide.pulse?.open}<`);
    expect(card).toContain('data-today-scope="company"');
  });

  it("«مواعيد اليوم»: a follow-up row opens the ticket itself, and the tickets page opens that ticket", async () => {
    const w = await todayWorld();
    await setFeatures(w.org.id, { navV2: true });
    const dept = await makeDepartment(w.org.id, { name: "قسم", memberIds: [w.member.id], leadId: w.lead.id });
    const ticket = await makeTicket({ orgId: w.org.id, departmentId: dept.id, creatorId: w.lead.id, assigneeId: w.member.id, status: "IN_PROGRESS", title: "تذكرة متابعة" });
    await db.ticket.update({ where: { id: ticket.id }, data: { followUpAt: new Date(Date.now() - DAY) } });
    jar().set(SPACE_COOKIE, w.wsIn.id);
    await loginAs(w.member.id);
    const markup = await html(HomePage({ searchParams: { view: "today" } }));
    expect(markup).toContain(`href="/tickets?ticket=${ticket.id}"`);
    // the page opens it: the desk is given the ticket to open
    const page = (await TicketsPage({ searchParams: { ticket: ticket.id } })) as { props: { openTicketId?: string | null } };
    expect(page.props.openTicketId).toBe(ticket.id);
    expect(((await TicketsPage({ searchParams: {} })) as { props: { openTicketId?: string | null } }).props.openTicketId ?? null).toBeNull();
  });
});

// ───────────────────────────────────────── B4.7 the overview ─────────────────────────────────────────

describe("B4.7 — the overview: one source for the per-space numbers, links that go where they say", () => {
  const NOW = new Date("2026-11-20T09:00:00Z");

  async function overview() {
    const t = await makeTeam();
    const a = await makeWorkspace(t.org.id, [{ userId: t.member.id }], "Alpha");
    const b = await makeWorkspace(t.org.id, [{ userId: t.member.id }], "Beta");
    const pa = await makeProject(a.id, "pa");
    const pb = await makeProject(b.id, "pb");
    const task = (space: typeof a, p: typeof pa, over: Partial<Parameters<typeof makeTask>[0]>) =>
      makeTask({ orgId: t.org.id, workspaceId: space.id, projectId: p.project.id, boardId: p.board.id, columnId: p.todo.id, creatorId: t.owner.id, assigneeId: t.member.id, ...over });
    // Alpha: 3 open, 2 late; Beta: 2 open, 1 late; one finished lately in Beta
    await task(a, pa, { title: "a1", dueDate: new Date(NOW.getTime() - 3 * DAY) });
    await task(a, pa, { title: "a2", dueDate: new Date(NOW.getTime() - 2 * DAY) });
    await task(a, pa, { title: "a3", dueDate: new Date(NOW.getTime() + 2 * DAY) });
    await task(b, pb, { title: "b1", dueDate: new Date(NOW.getTime() - 1 * DAY) });
    await task(b, pb, { title: "b2" });
    await task(b, pb, { title: "b3", columnId: pb.done.id, completedAt: new Date(NOW.getTime() - 2 * DAY) });
    return { ...t, a, b };
  }

  it("/spaces, the report «حسب المساحة» and the insight read the SAME numbers (one function: space-figures)", async () => {
    const w = await overview();
    await loginAs(w.owner.id);
    const actor = await requireActor();
    const cards = await spacesOverview(actor, NOW);
    const access = await controlPanelAccess(actor);
    const report = await loadPanelReports(access, {}, NOW);
    const home = await loadPanelHome(access, NOW);
    for (const space of [w.a, w.b]) {
      const card = cards.find((c) => c.id === space.id);
      const row = report.bySpace.find((r) => r.id === space.id);
      expect([card?.open, card?.overdue], space.name).toEqual([row?.open, row?.overdue]);
    }
    expect(report.bySpace.find((r) => r.id === w.a.id)).toMatchObject({ open: 3, overdue: 2 });
    expect(report.bySpace.find((r) => r.id === w.b.id)).toMatchObject({ open: 2, overdue: 1, done30: 1 });
    // the insight names the space with the most late work and the very same number
    const insight = home.insights.find((i) => i.id === "overdue");
    expect(insight?.params).toMatchObject({ n: 3, space: "Alpha", spaceN: 2 });
  });

  it("the late-work insight links to the real list of «مهامي» for that space (through /go), not to `/list?filter=overdue` that nothing reads", async () => {
    const w = await overview();
    await loginAs(w.owner.id);
    const home = await loadPanelHome(await controlPanelAccess(await requireActor()), NOW);
    const href = home.insights.find((i) => i.id === "overdue")?.href;
    expect(href).toBe(goHref(w.a.id, myTasksHref({ ...DEFAULT_MY_TASKS_PARAMS, scope: "space", chip: "overdue" })));
    expect(href).not.toContain("/list?filter");
    // and that address really lists what the sentence counted
    const there = await getWorkTasks(w.owner.id, { ...DEFAULT_MY_TASKS_PARAMS, scope: "space", chip: "overdue" }, { now: NOW, current: { id: w.a.id, kind: "STANDARD" } });
    expect(there.tasks.map((t) => t.title).sort()).toEqual(["a1", "a2"]);
  });

  it("«أفكار مستنية» counts what its link opens: the space with the most waiting ideas, through /go to that space's /ideas", async () => {
    const w = await overview();
    const idea = (workspaceId: string | null, title: string, ageDays: number, status: "NEW" | "UNDER_REVIEW" = "NEW") =>
      db.idea.create({ data: { orgId: w.org.id, creatorId: w.owner.id, workspaceId, title, status, createdAt: new Date(NOW.getTime() - ageDays * DAY) } });
    await idea(w.a.id, "قديمة في ألفا", 10);
    await idea(w.b.id, "قديمة في بيتا 1", 10);
    await idea(w.b.id, "قديمة في بيتا 2", 12);
    await idea(w.b.id, "جديدة", 1);
    await idea(w.b.id, "انراجعت", 30, "UNDER_REVIEW");
    await loginAs(w.owner.id);
    const home = await loadPanelHome(await controlPanelAccess(await requireActor()), NOW);
    const waiting = home.insights.find((i) => i.id === "ideas_waiting");
    // Beta holds two that waited past the line: that is the number, and that is the list the link opens
    expect(waiting?.params).toMatchObject({ n: 2, days: 7, space: "Beta" });
    expect(waiting?.href).toBe(goHref(w.b.id, "/ideas"));
    const opened = await db.idea.count({ where: { orgId: w.org.id, workspaceId: w.b.id, status: "NEW", createdAt: { lt: new Date(NOW.getTime() - 7 * DAY) } } });
    expect(opened).toBe(2);
  });
});
