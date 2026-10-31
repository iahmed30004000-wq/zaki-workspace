import { existsSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The pages call redirect()/notFound() and their client rows call useRouter(); no running Next app is needed here.
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

import TodayPage from "@/app/(app)/page";
import ChatPage from "@/app/(app)/chat/page";
import MyWorkPage from "@/app/(app)/my-work/page";
import ProjectsPage from "@/app/(app)/projects/page";
import ListPage from "@/app/(app)/list/page";
import CalendarPage from "@/app/(app)/calendar/page";
import GoalsPage from "@/app/(app)/goals/page";
import IdeasPage from "@/app/(app)/ideas/page";
import ProductionPage from "@/app/(app)/production/page";
import DepartmentsPage from "@/app/(app)/departments/page";
import TicketsPage from "@/app/(app)/tickets/page";
import CampaignsPage from "@/app/(app)/campaigns/page";
import CrmPage from "@/app/(app)/crm/page";
import FilesPage from "@/app/(app)/files/page";
import MembersPage from "@/app/(app)/members/page";
import AnalyticsPage from "@/app/(app)/analytics/page";
import AutomationPage from "@/app/(app)/automation/page";
import TelegramPage from "@/app/(app)/telegram/page";
import SettingsPage from "@/app/(app)/settings/page";
import ArchivePage from "@/app/(app)/archive/page";
import OwnerBoardPage from "@/app/(app)/owner/page";
import OwnerAssistantPage from "@/app/(app)/owner/assistant/page";
import CheckinsPage from "@/app/(app)/checkins/page";
import DocumentsPage from "@/app/(app)/documents/page";
import ApprovalsPage from "@/app/(app)/approvals/page";
import StructurePage from "@/app/(app)/structure/page";
import DevelopmentPage from "@/app/(app)/development/page";
import CurrentSpacePage from "@/app/(app)/spaces/current/page";
import WatchPage from "@/app/(app)/watch/page";
import * as goalsRoute from "@/app/api/goals/route";
import * as goalRoute from "@/app/api/goals/[id]/route";
import * as ideasRoute from "@/app/api/ideas/route";
import * as ideaRoute from "@/app/api/ideas/[id]/route";
import * as ideaVoteRoute from "@/app/api/ideas/[id]/vote/route";
import * as ideaConvertRoute from "@/app/api/ideas/[id]/convert/route";
import { GoalsView } from "@/components/goals-view";
import { IdeasView } from "@/components/ideas-view";
import { getServerT } from "@/lib/i18n/server";
import { PLACES, buildNav, canOpenTab, type NavRole, type NavSubject, type PlaceKey, type TabKey } from "@/lib/nav/places";
import { requireActor } from "@/server/policy/actor";
import { listGoals } from "@/server/services/goals";
import { listIdeas } from "@/server/services/ideas";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { withHq } from "./hq-helpers";
import { call, db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";
import {
  CUSTOMER_CHAT_TITLE,
  CUSTOMER_PHONE,
  N8N_HOOK,
  makeCustomer,
  makeDepartment,
  makeRoutine,
  seedN8n,
  seedTelegram,
} from "./guest-helpers";
import { html, type PageElement } from "./pages-access-helpers";
import { resolveServerTree } from "./today-helpers";

/**
 * WP-ACCESS: an external partner (org GUEST) is offered only the tabs of `src/lib/nav/places.ts` that include
 * guests, and every page or route whose tab is NOT offered to them refuses them on the server - the guest
 * notice (or a redirect / not-found) on a page, 403 `guest.no_access` on a route - and hands them no company
 * data. Goals and ideas became staff-only (docs/PHASE0-AUDIT.md R10); /analytics and /settings refuse a guest;
 * nothing changes for anybody else.
 */

const { t } = getServerT();
const NOTICE = t("guest.no_access");
const DAY = 24 * 3600 * 1000;

/**
 * One company with a person of every rank and data an external partner must never read. Every such row
 * carries `secret`: a space the guest is not in and its task, a colleague's name and job title, a goal (with
 * its department), an idea, a production routine, a department, a customer. The company also has a connected
 * Telegram (a customer chat) and n8n (a webhook URL). The guest has a space of their own with a task of their
 * own: the pages that ARE offered to them show it.
 */
async function companyWorld() {
  const secret = `S${uid()}`;
  const team = await makeTeam();
  const orgId = team.org.id;
  const orgName = `Company ${uid()}`;
  // «مساعد المالك» is OFF by default; its tab is on the owner's map only while its switch is on, and the loop below opens every offered tab
  await db.organization.update({ where: { id: orgId }, data: { name: orgName, settings: { features: { ownerAssistant: true } } } });
  const lead = await makeUser({ orgId, role: "LEAD", name: "Lead" });
  const staffer = await makeUser({ orgId, role: "MEMBER", name: `Staffer ${secret}` });
  await db.user.update({ where: { id: staffer.id }, data: { jobTitle: `Title ${secret}` } });
  const dept = await makeDepartment(orgId, { name: `Dept ${secret}`, memberIds: [staffer.id] });

  // the team's space (the guest is not in it): work given to the colleague, so the reports name them
  const space = await makeWorkspace(
    orgId,
    [team.admin, lead, team.member, staffer].map((person) => ({ userId: person.id })),
    `Space ${secret}`,
  );
  // «الشركة», every staff member in it (the guest is not): the ideas from before spaces had them are read there
  await withHq(orgId, [team.admin, lead, team.member, staffer].map((person) => person.id));
  const work = await makeProject(space.id, `Project ${secret}`);
  await makeTask({
    orgId,
    workspaceId: space.id,
    projectId: work.project.id,
    boardId: work.board.id,
    columnId: work.todo.id,
    creatorId: team.owner.id,
    assigneeId: staffer.id,
    title: `Task ${secret}`,
    dueDate: new Date(Date.now() + DAY),
  });

  // the guest's own space and task
  const shared = await makeWorkspace(orgId, [{ userId: team.guest.id, role: "GUEST" }, { userId: team.member.id }], "Shared space");
  const sharedWork = await makeProject(shared.id, "Shared project");
  await makeTask({
    orgId,
    workspaceId: shared.id,
    projectId: sharedWork.project.id,
    boardId: sharedWork.board.id,
    columnId: sharedWork.todo.id,
    creatorId: team.member.id,
    assigneeId: team.guest.id,
    title: "Shared task",
  });

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const goal = await db.goal.create({
    data: {
      orgId,
      creatorId: staffer.id,
      title: `Goal ${secret}`,
      description: `Goal plan ${secret}`,
      departmentId: dept.id,
      period: "WEEKLY",
      periodStart: start,
      periodEnd: new Date(start.getTime() + 7 * DAY),
    },
  });
  const idea = await db.idea.create({ data: { orgId, creatorId: staffer.id, title: `Idea ${secret}`, description: `Idea text ${secret}` } });
  // an idea the guest wrote while they were still on the team, before they were made a guest
  const guestIdea = await db.idea.create({ data: { orgId, creatorId: team.guest.id, title: `Old idea ${secret}` } });
  await makeRoutine({ orgId, title: `Routine ${secret}`, assigneeId: staffer.id, departmentId: dept.id });
  await makeCustomer({ orgId, creatorId: team.owner.id, name: `Customer ${secret}` });
  await seedTelegram(orgId);
  await seedN8n(orgId);
  return { ...team, lead, staffer, dept, space, work, shared, sharedWork, goal, idea, guestIdea, secret, orgName };
}

type World = Awaited<ReturnType<typeof companyWorld>>;

/** Company text a guest must never find in a refusal: the rows above, the company's name, the customer chat, the webhook. */
const companyText = (w: World) => [w.secret, w.orgName, CUSTOMER_CHAT_TITLE, CUSTOMER_PHONE, N8N_HOOK];

function expectNoCompanyText(w: World, text: string, where: string) {
  for (const needle of companyText(w)) expect(text, `${where} carries «${needle}»`).not.toContain(needle);
}

function expect403(res: { status: number; json: Record<string, unknown> | null }, where: string) {
  expect(res.status, where).toBe(403);
  expect(res.json?.["message"], where).toBe("guest.no_access");
}

// ───────────────────────────── the four pages: a guest gets the notice, everybody else the page ─────────────────────────────

describe("a guest gets the guest notice on /analytics, /settings, /goals and /ideas, and no company text", () => {
  it("/analytics: the notice instead of the company's numbers and the staff names with their workload", async () => {
    const w = await companyWorld();
    await loginAs(w.guest.id);
    const element = (await AnalyticsPage()) as PageElement;
    const markup = await html(element);
    expect(markup).toContain(NOTICE);
    expect(markup).not.toContain(t("analytics.title"));
    expect(markup).not.toContain(t("analytics.workload"));
    expectNoCompanyText(w, markup, "/analytics");
    expectNoCompanyText(w, JSON.stringify(element.props), "/analytics props");
  });

  it("/settings: the notice instead of the company's name, headcount and connected integrations", async () => {
    const w = await companyWorld();
    await loginAs(w.guest.id);
    const element = (await SettingsPage()) as PageElement;
    const markup = await html(element);
    expect(markup).toContain(NOTICE);
    expect(markup).not.toContain(t("settings.title"));
    expect(markup).not.toContain(t("settings.integrations"));
    expectNoCompanyText(w, markup, "/settings");
    expectNoCompanyText(w, JSON.stringify(element.props), "/settings props");
  });

  it("/goals: the notice, and the goals view (which would call /api/goals) is not rendered", async () => {
    const w = await companyWorld();
    await loginAs(w.guest.id);
    const element = (await GoalsPage()) as PageElement;
    expect(element.type).not.toBe(GoalsView);
    const markup = await html(element);
    expect(markup).toContain(NOTICE);
    expectNoCompanyText(w, markup, "/goals");
  });

  it("/ideas: the notice, and the ideas are never read for them (not in the markup, not in the props)", async () => {
    const w = await companyWorld();
    await loginAs(w.guest.id);
    const element = (await IdeasPage()) as PageElement;
    expect(element.type).not.toBe(IdeasView);
    const markup = await html(element);
    expect(markup).toContain(NOTICE);
    expectNoCompanyText(w, markup, "/ideas");
    expectNoCompanyText(w, JSON.stringify(element.props), "/ideas props");
  });
});

describe("everybody else keeps the four pages exactly as before", () => {
  it("owner, admin, lead and member: the reports, the settings, the goals view and the ideas with their authors", async () => {
    const w = await companyWorld();
    for (const person of [w.owner, w.admin, w.lead, w.member]) {
      await loginAs(person.id);
      const who = person.name;

      // the reports box of the grid: a lead's and up by the template (the tab always was); a member gets the notice
      const reports = await html(AnalyticsPage());
      expect(reports, who).not.toContain(NOTICE);
      if (person === w.member) expect(reports, who).toContain(t("access.section_off"));
      else expect(reports, who).toContain(t("analytics.title"));

      const settings = await html(SettingsPage());
      expect(settings, who).toContain(t("settings.title"));
      expect(settings, who).toContain(w.orgName);
      expect(settings, who).not.toContain(NOTICE);

      const goals = (await GoalsPage()) as PageElement;
      expect(goals.type, who).toBe(GoalsView);
      expect(goals.props["canManage"], who).toBe(person.id === w.owner.id || person.id === w.admin.id);

      const ideas = (await IdeasPage()) as PageElement;
      expect(ideas.type, who).toBe(IdeasView);
      const initial = ideas.props["initial"] as { title: string; creatorName: string }[];
      expect(initial.map((i) => i.title), who).toEqual(expect.arrayContaining([`Idea ${w.secret}`, `Old idea ${w.secret}`]));
      expect(initial.find((i) => i.title === `Idea ${w.secret}`)?.creatorName, who).toBe(`Staffer ${w.secret}`);
    }

    // somebody who opens the team's space (inside it: the reports are the current space's) still reads the
    // workload with the colleague's name in it: a member the owner gave the reports box
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } },
      data: { capabilities: ["reports.view"] },
    });
    await loginAs(w.member.id);
    (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, w.space.id);
    expect(await html(AnalyticsPage())).toContain(`Staffer ${w.secret}`);
  });
});

// ───────────────────────────── the routes behind them ─────────────────────────────

describe("/api/goals and /api/ideas answer a guest 403 guest.no_access, before reading or writing anything", () => {
  it("GET /api/goals hands over no goal, no department, no author", async () => {
    const w = await companyWorld();
    await loginAs(w.guest.id);
    const res = await call(goalsRoute.GET);
    expect403(res, "GET /api/goals");
    expectNoCompanyText(w, res.text, "GET /api/goals");
  });

  it("POST /api/goals, PATCH and DELETE /api/goals/[id]: refused with the guest key, nothing written", async () => {
    const w = await companyWorld();
    await loginAs(w.guest.id);
    const created = await call(goalsRoute.POST, { body: { title: "Planted goal", period: "WEEKLY", anchorDate: "2026-10-22" } });
    expect403(created, "POST /api/goals");
    const edited = await call(goalRoute.PATCH, { method: "PATCH", params: { id: w.goal.id }, body: { title: "Renamed by the partner", progress: 99 } });
    expect403(edited, "PATCH /api/goals/[id]");
    const removed = await call(goalRoute.DELETE, { method: "DELETE", params: { id: w.goal.id } });
    expect403(removed, "DELETE /api/goals/[id]");
    for (const res of [created, edited, removed]) expectNoCompanyText(w, res.text, "goal write");

    expect(await db.goal.count({ where: { orgId: w.org.id } })).toBe(1);
    const goal = await db.goal.findUniqueOrThrow({ where: { id: w.goal.id } });
    expect(goal.title).toBe(`Goal ${w.secret}`);
    expect(goal.progress).toBe(0);
  });

  it("GET /api/ideas, with or without filters, hands over no idea and no author", async () => {
    const w = await companyWorld();
    await loginAs(w.guest.id);
    for (const query of ["", "?mine=1", "?status=NEW"]) {
      const res = await call(ideasRoute.GET, { url: `http://localhost/api/ideas${query}` });
      expect403(res, `GET /api/ideas${query}`);
      expectNoCompanyText(w, res.text, `GET /api/ideas${query}`);
    }
  });

  it("POST /api/ideas: refused with the guest key, nothing filed", async () => {
    const w = await companyWorld();
    await loginAs(w.guest.id);
    const res = await call(ideasRoute.POST, { body: { title: "Planted idea" } });
    expect403(res, "POST /api/ideas");
    expect(await db.idea.count({ where: { orgId: w.org.id } })).toBe(2);
  });

  it("edit, delete, vote and convert answer the guest key, even on the idea they wrote before they were made a guest", async () => {
    const w = await companyWorld();
    await loginAs(w.guest.id);
    for (const idea of [w.guestIdea, w.idea]) {
      const edit = await call(ideaRoute.PATCH, { method: "PATCH", params: { id: idea.id }, body: { title: "Edited by the partner" } });
      expect403(edit, "PATCH /api/ideas/[id]");
      const vote = await call(ideaVoteRoute.POST, { method: "POST", params: { id: idea.id } });
      expect403(vote, "POST /api/ideas/[id]/vote");
      const convert = await call(ideaConvertRoute.POST, {
        params: { id: idea.id },
        body: { workspaceId: w.shared.id, projectId: w.sharedWork.project.id, boardId: w.sharedWork.board.id },
      });
      expect403(convert, "POST /api/ideas/[id]/convert");
      const del = await call(ideaRoute.DELETE, { method: "DELETE", params: { id: idea.id } });
      expect403(del, "DELETE /api/ideas/[id]");
      for (const res of [edit, vote, convert, del]) expectNoCompanyText(w, res.text, "idea route");
    }
    expect((await db.idea.findUniqueOrThrow({ where: { id: w.guestIdea.id } })).title).toBe(`Old idea ${w.secret}`);
    expect(await db.idea.count({ where: { orgId: w.org.id } })).toBe(2);
    expect(await db.ideaVote.count({ where: { userId: w.guest.id } })).toBe(0);
    expect(await db.task.count({ where: { workspaceId: w.shared.id } })).toBe(1);
  });
});

describe("staff keep the goals and ideas routes", () => {
  it("owner, admin, lead and member read the goals and the ideas; a member still files an idea and votes", async () => {
    const w = await companyWorld();
    for (const person of [w.owner, w.admin, w.lead, w.member]) {
      await loginAs(person.id);
      const goals = await call(goalsRoute.GET);
      expect(goals.status, person.name).toBe(200);
      expect((goals.json?.["goals"] as { title: string }[]).map((g) => g.title), person.name).toEqual([`Goal ${w.secret}`]);
      const ideas = await call(ideasRoute.GET, { url: "http://localhost/api/ideas" });
      expect(ideas.status, person.name).toBe(200);
      expect((ideas.json?.["ideas"] as { title: string }[]).map((i) => i.title), person.name).toContain(`Idea ${w.secret}`);
    }
    await loginAs(w.member.id);
    expect((await call(ideasRoute.POST, { body: { title: `Member idea ${uid()}` } })).status).toBe(201);
    const vote = await call(ideaVoteRoute.POST, { method: "POST", params: { id: w.idea.id } });
    expect(vote.status).toBe(200);
    expect(vote.json).toEqual({ voted: true });
  });
});

describe("the services hold the same rule where the data is read (a new caller that forgets the door still hands a guest nothing)", () => {
  it("listGoals refuses a guest with guest.no_access and still lists the goals for staff", async () => {
    const w = await companyWorld();
    await loginAs(w.guest.id);
    const guest = await requireActor();
    await expect(listGoals({ orgId: guest.orgId, orgRole: guest.role })).rejects.toMatchObject({ message: "guest.no_access" });
    await loginAs(w.member.id);
    const member = await requireActor();
    expect((await listGoals({ orgId: member.orgId, orgRole: member.role })).map((g) => g.title)).toEqual([`Goal ${w.secret}`]);
  });

  it("listIdeas refuses a guest with guest.no_access and still lists the ideas for staff", async () => {
    const w = await companyWorld();
    await expect(listIdeas(w.org.id, { viewerId: w.guest.id, external: true })).rejects.toMatchObject({ message: "guest.no_access" });
    expect((await listIdeas(w.org.id, { viewerId: w.member.id })).map((i) => i.title)).toContain(`Idea ${w.secret}`);
  });
});

// ───────────────────────────── the loop: every tab of PLACES × the five ranks ─────────────────────────────

type PageCall = () => Promise<ReactElement> | ReactElement;

/** Every tab's page (the file at its `href`), called the way Next calls it. A tab added to PLACES without a line here fails below. */
const TAB_PAGES: Record<TabKey, PageCall> = {
  "my-work": () => MyWorkPage({ searchParams: {} }),
  projects: () => ProjectsPage({ searchParams: {} }),
  list: () => ListPage({ searchParams: {} }),
  calendar: () => CalendarPage({ searchParams: {} }),
  goals: () => GoalsPage(),
  ideas: () => IdeasPage(),
  production: () => ProductionPage(),
  departments: () => DepartmentsPage(),
  tickets: () => TicketsPage(),
  campaigns: () => CampaignsPage(),
  crm: () => CrmPage(),
  files: () => FilesPage(),
  documents: () => DocumentsPage(),
  team: () => MembersPage(),
  space: () => CurrentSpacePage(),
  reports: () => AnalyticsPage(),
  automation: () => AutomationPage(),
  telegram: () => TelegramPage(),
  settings: () => SettingsPage(),
  archive: () => ArchivePage(),
  board: () => OwnerBoardPage({ searchParams: {} }),
  assistant: () => OwnerAssistantPage({ searchParams: {} }),
  checkins: () => CheckinsPage(),
  approvals: () => ApprovalsPage({ searchParams: {} }),
  structure: () => StructurePage(),
  development: () => DevelopmentPage({ searchParams: {} }),
};

/** The places that are one page and have no tabs (Today, the chat). */
const PLACE_PAGES: Partial<Record<PlaceKey, PageCall>> = {
  today: () => TodayPage(),
  chat: () => ChatPage(),
  watch: () => WatchPage(),
};

interface Entry {
  label: string;
  href: string;
  tab: TabKey | null;
  page: PageCall | undefined;
  /** Is it on this person's map (the same answer the menu, the bottom bar and the palette get)? */
  offered: (subject: NavSubject) => boolean;
}

const ENTRIES: Entry[] = PLACES.flatMap((place): Entry[] =>
  place.tabs.length === 0
    ? [
        {
          label: `place ${place.key}`,
          href: place.href ?? "/",
          tab: null,
          page: PLACE_PAGES[place.key],
          offered: (subject) => buildNav(subject).places.some((drawn) => drawn.key === place.key),
        },
      ]
    : place.tabs.map((tab) => ({
        label: `tab ${tab.key}`,
        href: tab.href,
        tab: tab.key,
        page: TAB_PAGES[tab.key],
        offered: (subject: NavSubject) => canOpenTab(subject, tab.key),
      })),
);

/**
 * A staff-only tab whose page still renders for a guest would be listed here, with the strict check run as
 * `it.fails`. Empty: «الروتين اليومي» and «الأتمتة», the last two, now show the guest notice and
 * /api/production refuses a guest (review C6), so the loop holds them like every other tab.
 */
const KNOWN_GAPS: Partial<Record<TabKey, string>> = {};

const RANKS: readonly NavRole[] = ["OWNER", "ADMIN", "LEAD", "MEMBER", "GUEST"];

/** The notices a page shows instead of an area that is not for this person. */
const REFUSALS = [t("guest.no_access"), t("orgm.members_only"), t("chat.guest_forbidden"), t("access.section_off"), t("spaces.manage.not_yours")];

type Outcome = { kind: "rendered"; markup: string; props: string } | { kind: "redirect"; to: string } | { kind: "not-found" };

/** Every string (and number) inside a value - the data a page hands to its client view - walked once, cycles skipped. */
function textsOf(value: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "bigint") return [String(value)];
  if (value === null || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  if (value instanceof Date) return [value.toISOString()];
  return Object.values(value).flatMap((inner) => textsOf(inner, seen));
}

/** Calls a page as the signed-in person: what it rendered, or where it sent them. Anything else it throws fails the test. */
async function open(page: PageCall): Promise<Outcome> {
  let tree: ReactNode;
  try {
    // the Today page mounts an async server part (the first-steps card): resolve those the way Next does
    tree = await resolveServerTree(await page());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const to = /^NEXT_REDIRECT:(.*)$/.exec(message)?.[1];
    if (to !== undefined) return { kind: "redirect", to };
    if (message === "NEXT_NOT_FOUND") return { kind: "not-found" };
    throw err;
  }
  return { kind: "rendered", markup: await html(tree as ReactElement), props: textsOf(tree).join("\n") };
}

const refused = (markup: string) => REFUSALS.some((notice) => markup.includes(notice));

describe("every tab of PLACES × the five ranks: a tab not offered to a guest refuses the guest and hands them no company data", () => {
  let w: World;
  const userOf = (rank: NavRole) =>
    ({ OWNER: w.owner, ADMIN: w.admin, LEAD: w.lead, MEMBER: w.member, GUEST: w.guest })[rank];

  /** Signs in as the rank's person and returns their map subject, from the real actor (as the layout builds it). */
  async function signIn(rank: NavRole): Promise<NavSubject> {
    await loginAs(userOf(rank).id);
    const actor = await requireActor();
    expect(actor.role).toBe(rank);
    return { role: actor.role, caps: [...actor.caps] };
  }

  /** The guest on a page that is not offered to them: the notice, a redirect or not-found - and no company text. */
  async function expectGuestRefused(entry: Entry) {
    const outcome = await open(entry.page!);
    if (outcome.kind !== "rendered") return;
    expect(refused(outcome.markup), `${entry.href} shows a refusal notice, not the page`).toBe(true);
    expectNoCompanyText(w, outcome.markup, `${entry.href} markup`);
    expectNoCompanyText(w, outcome.props, `${entry.href} props`);
  }

  beforeAll(async () => {
    w = await companyWorld();
  });

  it("covers every tab and every one-page place of PLACES, each with its page file on disk", () => {
    expect(Object.keys(TAB_PAGES).sort()).toEqual(PLACES.flatMap((place) => place.tabs.map((tab) => tab.key)).sort());
    for (const entry of ENTRIES) {
      expect(entry.page, entry.label).toBeTypeOf("function");
      const file = path.resolve(__dirname, "../../src/app/(app)", `.${entry.href}`, "page.tsx");
      expect(existsSync(file), `${entry.label}: ${file}`).toBe(true);
    }
    // guests also get Chat for the spaces/topics explicitly shared with them.
    const guest = { role: "GUEST" as const, caps: [] };
    expect(ENTRIES.filter((entry) => entry.offered(guest)).map((entry) => entry.href)).toEqual([
      "/",
      "/chat",
      "/my-work",
      "/projects",
      "/list",
      "/calendar",
      // «المستندات»: offered to a partner (they read only what is shared with them: the service decides)
      "/documents",
    ]);
  });

  for (const entry of ENTRIES) {
    for (const rank of RANKS) {
      const title = `${rank} · ${entry.label} (${entry.href})`;

      if (rank !== "GUEST") {
        it(`${title}: offered → the page itself; not offered → whatever the page serves, without breaking`, async () => {
          const subject = await signIn(rank);
          const outcome = await open(entry.page!);
          if (entry.offered(subject)) {
            expect(outcome.kind, `${entry.href} renders for ${rank}`).toBe("rendered");
            if (outcome.kind === "rendered") expect(refused(outcome.markup), `${entry.href}: no refusal for ${rank}`).toBe(false);
          } else {
            // a page may serve more people than its tab is offered to (the reports, the settings): no rule here
            expect(["rendered", "redirect", "not-found"]).toContain(outcome.kind);
          }
        });
        continue;
      }

      it(`${title}: the guest's map and the page agree`, async () => {
        const subject = await signIn(rank);
        if (entry.offered(subject)) {
          // a tab offered to guests: the page itself, with nothing of the company's that is not shared with them
          const outcome = await open(entry.page!);
          expect(outcome.kind, `${entry.href} renders for a guest`).toBe("rendered");
          if (outcome.kind === "rendered") {
            expect(refused(outcome.markup), `${entry.href}: no refusal for a guest`).toBe(false);
            for (const needle of [w.secret, CUSTOMER_CHAT_TITLE, CUSTOMER_PHONE, N8N_HOOK]) {
              expect(outcome.markup, `${entry.href} carries «${needle}»`).not.toContain(needle);
              expect(outcome.props, `${entry.href} props carry «${needle}»`).not.toContain(needle);
            }
          }
          return;
        }
        if (entry.tab && KNOWN_GAPS[entry.tab]) {
          // the gap is documented above and run as `it.fails` below; what the page hands over is still checked here
          const outcome = await open(entry.page!);
          if (outcome.kind === "rendered") {
            expectNoCompanyText(w, outcome.markup, `${entry.href} markup`);
            expectNoCompanyText(w, outcome.props, `${entry.href} props`);
          }
          return;
        }
        await expectGuestRefused(entry);
      });

      const gap = entry.tab ? KNOWN_GAPS[entry.tab] : undefined;
      if (gap) {
        it.fails(`${title}: ⚠️ KNOWN GAP (outside WP-ACCESS) - ${gap}; the strict check fails until the page refuses guests`, async () => {
          await signIn(rank);
          await expectGuestRefused(entry);
        });
      }
    }
  }
});
