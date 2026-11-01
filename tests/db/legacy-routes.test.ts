import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
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
import ChatConversationPage from "@/app/(app)/chat/[id]/page";
import WhiteboardPage from "@/app/(app)/chat/[id]/whiteboard/page";
import CallPage from "@/app/(app)/calls/[id]/page";
import WatchPage from "@/app/(app)/watch/page";
import WatchSessionPage from "@/app/(app)/watch/[id]/page";
import ArchivePage from "@/app/(app)/archive/page";
import OwnerBoardPage from "@/app/(app)/owner/page";
import OwnerBoardPersonPage from "@/app/(app)/owner/people/[id]/page";
import OwnerAssistantPage from "@/app/(app)/owner/assistant/page";
import OwnerAssistantSettingsPage from "@/app/(app)/owner/assistant/settings/page";
import ApprovalsPage from "@/app/(app)/approvals/page";
import ApprovalPage from "@/app/(app)/approvals/[id]/page";
import ApprovalFormsPage from "@/app/(app)/approvals/forms/page";
import StructurePage from "@/app/(app)/structure/page";
import DevelopmentPage from "@/app/(app)/development/page";
import DevelopmentPersonPage from "@/app/(app)/development/people/[id]/page";
import DevelopmentSkillsPage from "@/app/(app)/development/skills/page";
import DevelopmentSettingsPage from "@/app/(app)/development/settings/page";
import MyWorkPage from "@/app/(app)/my-work/page";
import TimeReportPage from "@/app/(app)/time/page";
import CheckinsPage from "@/app/(app)/checkins/page";
import ProjectsPage from "@/app/(app)/projects/page";
import ProjectPage from "@/app/(app)/projects/[id]/page";
import TimelinePage from "@/app/(app)/projects/[id]/timeline/page";
import BoardPage from "@/app/(app)/boards/[id]/page";
import TaskPage from "@/app/(app)/tasks/[id]/page";
import ListPage from "@/app/(app)/list/page";
import CalendarPage from "@/app/(app)/calendar/page";
import GoalsPage from "@/app/(app)/goals/page";
import IdeasPage from "@/app/(app)/ideas/page";
import CardsPage from "@/app/(app)/cards/page";
import CardPageRoute from "@/app/(app)/cards/[id]/page";
import ProductionPage from "@/app/(app)/production/page";
import DepartmentsPage from "@/app/(app)/departments/page";
import TeamsPage from "@/app/(app)/teams/page";
import MembersPage from "@/app/(app)/members/page";
import FilesPage from "@/app/(app)/files/page";
import DocumentsPage from "@/app/(app)/documents/page";
import DocumentRoute from "@/app/(app)/documents/[id]/page";
import ManufacturingPage from "@/app/(app)/manufacturing/page";
import MaterialRoute from "@/app/(app)/manufacturing/materials/[id]/page";
import CrmPage from "@/app/(app)/crm/page";
import AnalyticsPage from "@/app/(app)/analytics/page";
import AutomationPage from "@/app/(app)/automation/page";
import TelegramPage from "@/app/(app)/telegram/page";
import SettingsPage from "@/app/(app)/settings/page";
import ProfilePage from "@/app/(app)/profile/page";
import PublicProfilePage from "@/app/(app)/u/[id]/page";
import GuidePage from "@/app/(app)/guide/page";
import GuideArticlePage from "@/app/(app)/guide/[slug]/page";
import SpacesPage from "@/app/(app)/spaces/page";
import CurrentSpacePage from "@/app/(app)/spaces/current/page";
import TicketsPage from "@/app/(app)/tickets/page";
import CampaignsPage from "@/app/(app)/campaigns/page";
import * as goRoute from "@/app/go/route";
import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";
import RegisterCheckEmailPage from "@/app/register/check-email/page";
import RegisterConfirmPage from "@/app/register/confirm/page";
import OnboardingPage from "@/app/onboarding/page";
import { ARTICLES } from "@/lib/guide/articles";
import { LEGACY_ROUTES, type NavRole } from "@/lib/nav/places";
import { requireActor } from "@/server/policy/actor";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";
import { html } from "./pages-access-helpers";
import { resolveServerTree } from "./today-helpers";

/**
 * WP-HYGIENE: no old link breaks.
 *
 * Phase 2 regrouped the pages into five places without moving a single address (LEGACY_ROUTES in
 * src/lib/nav/places.ts). This file proves it from the files on disk, as every rank:
 *
 *  1. the pages that exist are exactly the old addresses plus the few pages added since (the guide), and
 *     outside the shell the sign-in, first-run set-up and onboarding screens;
 *  2. every page, opened by the owner, an admin, a lead, a member and an external partner (guest), with real ids
 *     (a thing they may open, one they may not, one that was deleted), ends in exactly one of three ways: it draws
 *     an element, it redirects to a page that exists (followed, never in a loop), or it is «not found» (the
 *     shell's own Arabic page). A thrown domain error is NOT one of them: Next hides its message in production
 *     and the visitor gets the bare «Application error» screen - that is the broken link this file catches.
 *
 * Which pages a guest gets is decided elsewhere (WP-ACCESS, tests/db/guest-internal-pages.test.ts): nothing here
 * says which of them render for whom, only that none of them breaks.
 */

// ───────────────────────────── the pages on disk ─────────────────────────────

const APP_DIR = path.resolve(__dirname, "../../src/app");

/**
 * The pages of the shell that are not an old address: the in-app guide (Phase 2), reached from the help
 * button, from Phase 3 one conversation (`/chat/[id]`) and the owner's archive (`/archive`), and the owner's
 * and admins' look over every space (`/spaces`, «كل المساحات»), «التذاكر» and «الحملات» as pages of their own
 * under «الشغل» (`/tickets`, `/campaigns`), one call (`/calls/[id]`: a conversation's call or a meeting's link) and a
 * conversation's whiteboard (`/chat/[id]/whiteboard`), both 2026-10-25, and «نتفرّج سوا» (`/watch`, `/watch/[id]`, the owner's
 * sixth place, 2026-10-26) and `/spaces/current` («الإدارة» > «المساحة»: edit the space, its people; 2026-10-30), and `/cards` («اللوحات») with the page inside a card (`/cards/[id]`), and `/time` («تقرير الوقت», 2026-10-30: owned by «الشغل», linked from a task and from «وقتي اليوم»).
 */
const SHELL_PAGES_SINCE_PHASE_2 = ["/guide", "/guide/[slug]", "/chat/[id]", "/archive", "/spaces", "/spaces/current", "/tickets", "/campaigns", "/calls/[id]", "/chat/[id]/whiteboard", "/watch", "/watch/[id]", "/cards", "/cards/[id]", "/time", "/owner", "/owner/people/[id]", "/owner/assistant", "/owner/assistant/settings", "/approvals", "/approvals/[id]", "/approvals/forms", "/structure", "/development", "/development/skills", "/development/settings", "/development/people/[id]", "/checkins", "/documents/[id]", "/manufacturing", "/manufacturing/materials/[id]"] as const;
/**
 * The pages outside the shell: sign-in, opening a new company (the form, «شوف بريدك» and the mailed
 * link's confirmation) and the one-time onboarding.
 */
const DOOR_PAGES = ["/login", "/register", "/register/check-email", "/register/confirm", "/onboarding"] as const;

interface PageOnDisk {
  route: string;
  /** Inside the (app) route group, i.e. drawn inside the shell. */
  inApp: boolean;
}

/** Every page.tsx under src/app, as the address Next serves it: a route group such as (app) adds nothing to it. */
function pagesOnDisk(dir = APP_DIR, segments: string[] = [], out: PageOnDisk[] = []): PageOnDisk[] {
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (segments.length === 0 && name === "api") continue; // route handlers, not pages
      if (name.startsWith("_")) continue; // a private folder is never routed
      pagesOnDisk(full, [...segments, name], out);
    } else if (/^page\.(?:tsx|ts|jsx|js)$/.test(name)) {
      const route = `/${segments.filter((segment) => !/^\(.*\)$/.test(segment)).join("/")}`;
      out.push({ route, inApp: segments[0] === "(app)" });
    }
  }
  return out;
}

const ON_DISK = pagesOnDisk();
const ROUTES = ON_DISK.map((page) => page.route);
const IN_APP = new Set(ON_DISK.filter((page) => page.inApp).map((page) => page.route));

// ───────────────────────────── calling a page the way Next does ─────────────────────────────

interface PageArgs {
  params: Record<string, string>;
  searchParams: Record<string, string>;
}
type PageCall = (args: PageArgs) => unknown;

const idOf = ({ params }: PageArgs) => ({ id: params["id"] ?? "" });

/** Every page on disk, called with what Next hands it. A page added without a line here fails the first describe. */
const PAGES: Record<string, PageCall> = {
  "/": () => TodayPage(),
  "/chat": () => ChatPage(),
  "/chat/[id]": (args) => ChatConversationPage({ params: idOf(args) }),
  "/chat/[id]/whiteboard": (args) => WhiteboardPage({ params: idOf(args) }),
  "/calls/[id]": (args) => CallPage({ params: idOf(args) }),
  "/watch": () => WatchPage(),
  "/watch/[id]": (args) => WatchSessionPage({ params: idOf(args) }),
  "/archive": () => ArchivePage(),
  "/owner": ({ searchParams }) => OwnerBoardPage({ searchParams }),
  "/owner/people/[id]": (args) => OwnerBoardPersonPage({ params: idOf(args), searchParams: {} }),
  "/owner/assistant": ({ searchParams }) => OwnerAssistantPage({ searchParams }),
  "/owner/assistant/settings": () => OwnerAssistantSettingsPage(),
  "/approvals": ({ searchParams }) => ApprovalsPage({ searchParams }),
  "/approvals/[id]": (args) => ApprovalPage({ params: idOf(args) }),
  "/approvals/forms": ({ searchParams }) => ApprovalFormsPage({ searchParams }),
  "/structure": () => StructurePage(),
  "/development": ({ searchParams }) => DevelopmentPage({ searchParams }),
  "/development/skills": () => DevelopmentSkillsPage(),
  "/development/settings": () => DevelopmentSettingsPage(),
  "/development/people/[id]": (args) => DevelopmentPersonPage({ params: idOf(args), searchParams: {} }),
  "/my-work": ({ searchParams }) => MyWorkPage({ searchParams }),
  "/time": ({ searchParams }) => TimeReportPage({ searchParams }),
  "/checkins": () => CheckinsPage(),
  "/projects": ({ searchParams }) => ProjectsPage({ searchParams }),
  "/projects/[id]": (args) => ProjectPage({ params: idOf(args) }),
  "/projects/[id]/timeline": (args) => TimelinePage({ params: idOf(args) }),
  "/boards/[id]": (args) => BoardPage({ params: idOf(args) }),
  "/tasks/[id]": (args) => TaskPage({ params: idOf(args) }),
  "/list": ({ searchParams }) => ListPage({ searchParams }),
  "/calendar": ({ searchParams }) => CalendarPage({ searchParams }),
  "/goals": () => GoalsPage(),
  "/ideas": () => IdeasPage(),
  "/cards": () => CardsPage(),
  "/cards/[id]": (args) => CardPageRoute({ params: idOf(args) }),
  "/production": () => ProductionPage(),
  "/departments": () => DepartmentsPage(),
  "/teams": () => TeamsPage(),
  "/members": () => MembersPage(),
  "/files": () => FilesPage(),
  "/documents": () => DocumentsPage(),
  "/documents/[id]": (args) => DocumentRoute({ params: idOf(args) }),
  "/manufacturing": () => ManufacturingPage(),
  "/manufacturing/materials/[id]": (args) => MaterialRoute({ params: idOf(args) }),
  "/crm": () => CrmPage(),
  "/analytics": () => AnalyticsPage(),
  "/automation": () => AutomationPage(),
  "/telegram": () => TelegramPage(),
  "/settings": () => SettingsPage(),
  "/profile": () => ProfilePage(),
  "/u/[id]": (args) => PublicProfilePage({ params: idOf(args) }),
  "/guide": () => GuidePage(),
  "/guide/[slug]": ({ params }) => GuideArticlePage({ params: { slug: params["slug"] ?? "" } }),
  "/spaces": () => SpacesPage(),
  "/spaces/current": () => CurrentSpacePage(),
  "/tickets": () => TicketsPage(),
  "/campaigns": () => CampaignsPage(),
  "/login": () => LoginPage(),
  "/register": () => RegisterPage(),
  "/register/check-email": () => RegisterCheckEmailPage(),
  "/register/confirm": ({ searchParams }) => RegisterConfirmPage({ searchParams }),
  "/onboarding": ({ searchParams }) => OnboardingPage({ searchParams }),
};

/** The page that serves a path (a static folder wins over a dynamic one), with the values of its [segments]. */
function matchRoute(pathname: string): { route: string; params: Record<string, string> } | null {
  const parts = pathname.split("/").filter(Boolean);
  let best: { route: string; params: Record<string, string>; dynamic: number } | null = null;
  for (const route of ROUTES) {
    const pattern = route.split("/").filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let dynamic = 0;
    const fits = pattern.every((segment, i) => {
      const part = parts[i] ?? "";
      const name = /^\[(.+)\]$/.exec(segment)?.[1];
      if (!name) return segment === part;
      params[name] = decodeURIComponent(part);
      dynamic += 1;
      return true;
    });
    if (fits && (!best || dynamic < best.dynamic)) best = { route, params, dynamic };
  }
  return best ? { route: best.route, params: best.params } : null;
}

type Outcome =
  | { kind: "rendered" }
  | { kind: "redirect"; to: string }
  | { kind: "not-found" }
  | { kind: "broken"; error: string };

const pathOf = (address: string) => new URL(address, "http://localhost").pathname;

/** Opens one address as the signed-in person: what the page drew, where it sent them, or how it broke. */
async function open(address: string): Promise<Outcome> {
  const url = new URL(address, "http://localhost");
  const found = matchRoute(url.pathname);
  const page = found ? PAGES[found.route] : undefined;
  if (!found || !page) return { kind: "broken", error: `no page serves ${url.pathname}` };
  let tree: ReactNode;
  try {
    // the Today page mounts async server parts (the first-steps card): resolve those the way Next does
    tree = await resolveServerTree((await page({ params: found.params, searchParams: Object.fromEntries(url.searchParams) })) as ReactNode);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const to = /^NEXT_REDIRECT:(.*)$/.exec(message)?.[1];
    if (to !== undefined) return { kind: "redirect", to };
    if (message === "NEXT_NOT_FOUND") return { kind: "not-found" };
    return { kind: "broken", error: `threw ${err instanceof Error ? err.name : typeof err} «${message}»` };
  }
  if (!isValidElement(tree)) return { kind: "broken", error: `returned ${tree === null ? "null" : typeof tree} instead of an element` };
  try {
    await html(tree as ReactElement);
  } catch (err) {
    return { kind: "broken", error: `could not be drawn: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { kind: "rendered" };
}

const jar = () => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar as Map<string, string>;

/**
 * `/go?space=…&next=…` (a route, not a page: it enters a space and sends on), passed the way a browser does: the
 * cookie it sets is kept, and its Location is the next step.
 */
async function throughGo(address: string): Promise<string> {
  const res = await goRoute.GET(new Request(new URL(address, "http://localhost")));
  const set = /zk-space=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
  if (set) jar().set(SPACE_COOKIE, decodeURIComponent(set));
  return res.headers.get("location") ?? "/";
}

/** Opens an address and follows its redirects like a browser: where it ends, and the way there. */
async function land(address: string): Promise<{ end: Outcome; chain: string[] }> {
  const chain = [address];
  // a step is the address AND the space the person is in: coming back to a page after entering its space is
  // not a loop, coming back to it in the same space is
  const here = () => jar().get(SPACE_COOKIE) ?? "";
  const seen = new Set([`${pathOf(address)}|${here()}`]);
  let end = await open(address);
  while (end.kind === "redirect") {
    let target = end.to;
    if (pathOf(target) === "/go") {
      chain.push(target);
      target = await throughGo(target);
    }
    if (!matchRoute(pathOf(target))) return { end: { kind: "broken", error: `redirects to ${target}, which no page serves` }, chain };
    if (seen.has(`${pathOf(target)}|${here()}`)) {
      return { end: { kind: "broken", error: `redirect loop ${[...chain, target].join(" -> ")}` }, chain };
    }
    seen.add(`${pathOf(target)}|${here()}`);
    chain.push(target);
    end = await open(target);
  }
  return { end, chain };
}

// ───────────────────────────── the company ─────────────────────────────

/** An id that never existed: the old link to a task, a board, a person or an article that was deleted, or a typo. */
const GONE = `gone${uid()}`;

/**
 * One company with a person of every rank and three spaces: the team's (admin, lead and member are in it), one
 * shared with the external partner (a guest row, and the member), and one nobody is in (only the owner opens it).
 * Each space has a project, a board and a task.
 */
async function linkWorld() {
  const team = await makeTeam();
  const orgId = team.org.id;
  // «مساعد المالك» is OFF by default and its pages are «not found» while it is off; the owner opens every page of the shell below
  await db.organization.update({ where: { id: orgId }, data: { settings: { features: { ownerAssistant: true } } } });
  const lead = await makeUser({ orgId, role: "LEAD", name: "Lead" });

  async function spaceWithWork(members: { userId: string; role?: "ADMIN" | "MEMBER" | "GUEST" }[], name: string, assigneeId: string | null) {
    const space = await makeWorkspace(orgId, members, `${name} space`);
    const work = await makeProject(space.id, `${name} project`);
    const task = await makeTask({
      orgId,
      workspaceId: space.id,
      projectId: work.project.id,
      boardId: work.board.id,
      columnId: work.todo.id,
      creatorId: team.owner.id,
      assigneeId,
      title: `${name} task`,
    });
    const card = await db.card.create({ data: { orgId, workspaceId: space.id, createdById: team.owner.id, kind: "NOTE", title: `${name} card`, body: "text" } });
    const doc = await db.document.create({ data: { orgId, workspaceId: space.id, createdById: team.owner.id, title: `${name} doc`, content: "text", sharedWithPartners: name === "Shared" } });
    return { space, project: work.project, board: work.board, task, card, doc };
  }

  const teamSpace = await spaceWithWork([team.admin, lead, team.member].map((person) => ({ userId: person.id })), "Team", team.member.id);
  const shared = await spaceWithWork([{ userId: team.guest.id, role: "GUEST" }, { userId: team.member.id }], "Shared", team.guest.id);
  const closed = await spaceWithWork([], "Closed", null);
  const teamTopic = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: teamSpace.space.id, title: "Team topic" } });
  const closedTopic = await db.conversation.create({ data: { orgId, kind: "TOPIC", spaceId: closed.space.id, title: "Closed topic" } });
  // a call of a topic, and a meeting of the space nobody is in
  const topicCall = await db.call.create({ data: { orgId, spaceId: teamSpace.space.id, conversationId: teamTopic.id, startedById: team.member.id } });
  const closedMeeting = await db.call.create({ data: { orgId, spaceId: closed.space.id, startedById: team.owner.id } });
  // a «نتفرّج سوا» session of the team's space (its private topic: the member and the lead)
  const watchTopic = await db.conversation.create({
    data: { orgId, kind: "TOPIC", spaceId: teamSpace.space.id, title: "Watch", restricted: true, members: { create: [{ userId: team.member.id }, { userId: lead.id }] } },
  });
  const watch = await db.watchSession.create({
    data: { orgId, spaceId: teamSpace.space.id, conversationId: watchTopic.id, hostId: team.member.id, title: "Watch", sourceKind: "YOUTUBE", sourceRef: "dQw4w9WgXcQ", sourceUrl: "https://youtu.be/dQw4w9WgXcQ" },
  });
  // an approval request of the team's space (the member asked, the admin is the approver): the owner opens it, a partner never does
  const approval = await db.approvalRequest.create({
    data: { orgId, workspaceId: teamSpace.space.id, requesterId: team.member.id, title: "Approval", steps: { create: [{ version: 1, position: 1, approverId: team.admin.id }] } },
  });
  return { ...team, lead, teamSpace, shared, closed, approval, teamTopic, closedTopic, topicCall, closedMeeting, watch };
}

type World = Awaited<ReturnType<typeof linkWorld>>;

/** The real addresses of a route: for a dynamic one, a thing the person may open, things they may not, one that is gone. */
function addressesOf(route: string, w: World): string[] {
  const spaces = [w.teamSpace, w.shared, w.closed];
  switch (route) {
    case "/projects/[id]":
      return [...spaces.map((s) => s.project.id), GONE].map((id) => `/projects/${id}`);
    case "/projects/[id]/timeline":
      return [...spaces.map((s) => s.project.id), GONE].map((id) => `/projects/${id}/timeline`);
    case "/boards/[id]":
      return [...spaces.map((s) => s.board.id), GONE].map((id) => `/boards/${id}`);
    case "/tasks/[id]":
      return [...spaces.map((s) => s.task.id), GONE].map((id) => `/tasks/${id}`);
    case "/chat/[id]":
      // a topic of the team's space, one of the space nobody is in, and one that is gone
      return [w.teamTopic.id, w.closedTopic.id, GONE].map((id) => `/chat/${id}`);
    case "/chat/[id]/whiteboard":
      return [w.teamTopic.id, w.closedTopic.id, GONE].map((id) => `/chat/${id}/whiteboard`);
    case "/calls/[id]":
      return [w.topicCall.id, w.closedMeeting.id, GONE].map((id) => `/calls/${id}`);
    case "/watch/[id]":
      return [w.watch.id, GONE].map((id) => `/watch/${id}`);
    case "/cards/[id]":
      // a card of the team's space, one of the space shared with the partner, one of the space nobody is in, and one that is gone
      return [...spaces.map((s) => s.card.id), GONE].map((id) => `/cards/${id}`);
    case "/documents/[id]":
      // a document of the team's space, one of the space shared with the partner (shared with partners, so the partner opens it), one of the space nobody is in, and one that is gone
      return [...spaces.map((s) => s.doc.id), GONE].map((id) => `/documents/${id}`);
    case "/manufacturing/materials/[id]":
      // the ledger needs a manufacturing space; this world has none, so the only address is one that is gone (every rank gets «not found»)
      return [`/manufacturing/materials/${GONE}`];
    case "/approvals/[id]":
      // a request the owner and the people of the space open, and one that is gone
      return [w.approval.id, GONE].map((id) => `/approvals/${id}`);
    case "/owner/people/[id]":
      // every staff rank (a guest is not a person of the board: 404 for the owner too), and one that is gone
      return [w.owner.id, w.admin.id, w.lead.id, w.member.id, GONE].map((id) => `/owner/people/${id}`);
    case "/development/people/[id]":
      // every staff rank (a guest is not a person of the file: not found for the owner too), and one that is gone
      return [w.owner.id, w.admin.id, w.lead.id, w.member.id, GONE].map((id) => `/development/people/${id}`);
    case "/u/[id]":
      return [w.owner.id, w.admin.id, w.lead.id, w.member.id, w.guest.id, GONE].map((id) => `/u/${id}`);
    case "/guide/[slug]":
      return [...ARTICLES.map((article) => article.slug), GONE].map((slug) => `/guide/${slug}`);
    default:
      if (route.includes("[")) throw new Error(`${route}: a dynamic route needs real ids in addressesOf()`);
      return [route];
  }
}

const RANKS: readonly NavRole[] = ["OWNER", "ADMIN", "LEAD", "MEMBER", "GUEST"];

// ───────────────────────────── 1. the set of pages ─────────────────────────────

describe("every page on disk is an old address, or one of the few pages added since", () => {
  it("the pages of the shell are LEGACY_ROUTES plus the guide; outside the shell only sign-in, set-up and onboarding", () => {
    expect(ROUTES.length).toBeGreaterThan(25); // the walk really read the folders
    expect(new Set(ROUTES).size, "two folders serve the same address").toBe(ROUTES.length);
    expect([...IN_APP].sort()).toEqual([...LEGACY_ROUTES, ...SHELL_PAGES_SINCE_PHASE_2].sort());
    expect(ROUTES.filter((route) => !IN_APP.has(route)).sort()).toEqual([...DOOR_PAGES].sort());
  });

  it("every page on disk has its line in PAGES, so the loop below opens it as every rank", () => {
    expect(Object.keys(PAGES).sort()).toEqual([...ROUTES].sort());
  });
});

// ───────────────────────────── 2. the old board links (they used to end in a 500) ─────────────────────────────

describe("an old link to a board ends on the shell's not-found page, never on «Application error»", () => {
  it("a board id that does not exist (deleted, mistyped): notFound() for every rank", async () => {
    const w = await linkWorld();
    for (const person of [w.owner, w.admin, w.lead, w.member, w.guest]) {
      await loginAs(person.id);
      await expect(BoardPage({ params: { id: GONE } }), person.name).rejects.toThrow("NEXT_NOT_FOUND");
    }
  });

  it("a board of a space the person cannot open, or of another company: the same notFound() (nothing tells them it exists)", async () => {
    const w = await linkWorld();
    const stranger = await linkWorld();
    for (const person of [w.admin, w.lead, w.member, w.guest]) {
      await loginAs(person.id);
      await expect(BoardPage({ params: { id: w.closed.board.id } }), person.name).rejects.toThrow("NEXT_NOT_FOUND");
      await expect(BoardPage({ params: { id: stranger.teamSpace.board.id } }), person.name).rejects.toThrow("NEXT_NOT_FOUND");
    }
    await loginAs(w.owner.id);
    await expect(BoardPage({ params: { id: stranger.closed.board.id } })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("who may open a board is unchanged: the owner opens every space's board, a member the boards of their own spaces", async () => {
    const w = await linkWorld();
    // (inside the board's own space: from another one, the page first enters it — tests/db/current-space.test.ts)
    const openIn = async (space: { space: { id: string }; board: { id: string } }) => {
      jar().set(SPACE_COOKIE, space.space.id);
      return isValidElement(await BoardPage({ params: { id: space.board.id } }));
    };
    await loginAs(w.owner.id);
    for (const space of [w.teamSpace, w.shared, w.closed]) expect(await openIn(space)).toBe(true);
    await loginAs(w.member.id);
    for (const space of [w.teamSpace, w.shared]) expect(await openIn(space)).toBe(true);
    await loginAs(w.guest.id);
    expect(await openIn(w.shared)).toBe(true);
  });
});

// ───────────────────────────── 3. every page × the five ranks ─────────────────────────────

describe("every page × the five ranks: an element, a redirect to a page that exists, or not-found - nothing else", () => {
  let w: World;
  const personOf = (rank: NavRole) => ({ OWNER: w.owner, ADMIN: w.admin, LEAD: w.lead, MEMBER: w.member, GUEST: w.guest })[rank];

  /** Signs in as the rank's person and checks the server agrees on the rank. */
  async function signIn(rank: NavRole) {
    await loginAs(personOf(rank).id);
    expect((await requireActor()).role).toBe(rank);
  }

  beforeAll(async () => {
    w = await linkWorld();
  });

  for (const route of ROUTES) {
    for (const rank of RANKS) {
      it(`${rank} · ${route}`, async () => {
        await signIn(rank);
        for (const address of addressesOf(route, w)) {
          const { end, chain } = await land(address);
          const where = `${rank} ${chain.join(" -> ")}`;
          expect(end.kind === "broken" ? end.error : end.kind, where).toMatch(/^(?:rendered|not-found)$/);
          // not vacuous: the owner opens every page of the shell, with every id that exists
          if (rank === "OWNER" && IN_APP.has(route) && !address.includes(GONE)) {
            expect(end.kind, `${where}: the owner opens it`).toBe("rendered");
          }
        }
      });
    }
  }
});
