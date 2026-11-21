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
import ChatForumPage from "@/app/(app)/chat/s/[spaceId]/page";
import ChatConversationPage from "@/app/(app)/chat/[id]/page";
import WhiteboardPage from "@/app/(app)/chat/[id]/whiteboard/page";
import ChatInfoPage from "@/app/(app)/chat/[id]/info/page";
import CallPage from "@/app/(app)/calls/[id]/page";
import CallMinutesPage from "@/app/(app)/calls/[id]/minutes/page";
import WatchPage from "@/app/(app)/watch/page";
import WatchSessionPage from "@/app/(app)/watch/[id]/page";
import ArchivePage from "@/app/(app)/archive/page";
import OwnerBoardPage from "@/app/(app)/owner/page";
import OwnerBoardPersonPage from "@/app/(app)/owner/people/[id]/page";
import OwnerAssistantPage from "@/app/(app)/owner/assistant/page";
import OwnerAssistantSettingsPage from "@/app/(app)/owner/assistant/settings/page";
import ApprovalsPage from "@/app/(app)/approvals/page";
import RequestsPage from "@/app/(app)/requests/page";
import StalePage from "@/app/(app)/my-work/stale/page";
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
import ThemeGalleryPage from "@/app/(app)/theme-gallery/page";
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
import KnowledgePage from "@/app/(app)/knowledge/page";
import KnowledgeSheetRoute from "@/app/(app)/knowledge/[cardId]/page";
import ProductionPage from "@/app/(app)/production/page";
import DepartmentsPage from "@/app/(app)/departments/page";
import TeamsPage from "@/app/(app)/teams/page";
import MembersPage from "@/app/(app)/members/page";
import FilesPage from "@/app/(app)/files/page";
import DocumentsPage from "@/app/(app)/documents/page";
import DocumentRoute from "@/app/(app)/documents/[id]/page";
import ManufacturingPage from "@/app/(app)/manufacturing/page";
import MaterialRoute from "@/app/(app)/manufacturing/materials/[id]/page";
import MfgRecipesRoute from "@/app/(app)/manufacturing/recipes/page";
import MfgOrdersRoute from "@/app/(app)/manufacturing/orders/page";
import MfgReportsRoute from "@/app/(app)/manufacturing/reports/page";
import CrmPage from "@/app/(app)/crm/page";
import AnalyticsPage from "@/app/(app)/analytics/page";
import AutomationPage from "@/app/(app)/automation/page";
import TelegramPage from "@/app/(app)/telegram/page";
import SettingsPage from "@/app/(app)/settings/page";
import ProfilePage from "@/app/(app)/profile/page";
import SettingsMePage from "@/app/(app)/settings/me/page";
import SettingsMeSectionPage from "@/app/(app)/settings/me/[section]/page";
import PublicProfilePage from "@/app/(app)/u/[id]/page";
import AppLinkPage from "@/app/(app)/app-link/page";
import GuidePage from "@/app/(app)/guide/page";
import GuideArticlePage from "@/app/(app)/guide/[slug]/page";
import SpacesPage from "@/app/(app)/spaces/page";
import CurrentSpacePage from "@/app/(app)/spaces/current/page";
import SpaceSettingsPage from "@/app/(app)/spaces/[id]/settings/page";
import TicketsPage from "@/app/(app)/tickets/page";
import CampaignsPage from "@/app/(app)/campaigns/page";
import * as goRoute from "@/app/go/route";
import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";
import RegisterCheckEmailPage from "@/app/register/check-email/page";
import RegisterConfirmPage from "@/app/register/confirm/page";
import OnboardingPage from "@/app/onboarding/page";
import SharePage from "@/app/share/page";
import { ARTICLES } from "@/lib/guide/articles";
import { SECTION_KEYS as SETTINGS_ME_SECTIONS } from "@/components/settings-me/sections";
import { LEGACY_ROUTES, type NavRole } from "@/lib/nav/places";
import type { Landing } from "@/server/policy/org-settings";
import { requireActor } from "@/server/policy/actor";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { db, loginAs, logout, makeProject, makeTask, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";
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
const SHELL_PAGES_SINCE_PHASE_2 = ["/app-link", "/guide", "/guide/[slug]", "/chat/[id]", "/archive", "/spaces", "/spaces/current", "/spaces/[id]/settings", "/tickets", "/campaigns", "/calls/[id]", "/calls/[id]/minutes", "/chat/[id]/whiteboard", "/chat/[id]/info", "/chat/s/[spaceId]", "/watch", "/watch/[id]", "/cards", "/cards/[id]", "/time", "/owner", "/owner/people/[id]", "/owner/assistant", "/owner/assistant/settings", "/approvals", "/approvals/[id]", "/approvals/forms", "/requests", "/my-work/stale", "/structure", "/development", "/development/skills", "/development/settings", "/development/people/[id]", "/checkins", "/knowledge", "/knowledge/[cardId]", "/theme-gallery", "/documents/[id]", "/manufacturing", "/manufacturing/materials/[id]", "/manufacturing/recipes", "/manufacturing/orders", "/manufacturing/reports", "/settings/me", "/settings/me/[section]"] as const;
/**
 * The pages outside the shell: sign-in, opening a new company (the form, «شوف بريدك» and the mailed
 * link's confirmation), the one-time onboarding and «ابعت لـ…» (`/share`, M1a: where the phone's share sheet lands;
 * signed-in people only, a signed-out visitor goes to the sign-in).
 */
const DOOR_PAGES = ["/login", "/register", "/register/check-email", "/register/confirm", "/onboarding", "/share"] as const;

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
  "/": ({ searchParams }) => TodayPage({ searchParams }),
  "/chat": () => ChatPage(),
  "/chat/[id]": (args) => ChatConversationPage({ params: idOf(args) }),
  "/chat/[id]/whiteboard": (args) => WhiteboardPage({ params: idOf(args) }),
  "/chat/[id]/info": (args) => ChatInfoPage({ params: idOf(args) }),
  "/chat/s/[spaceId]": () => ChatForumPage(),
  "/calls/[id]": (args) => CallPage({ params: idOf(args) }),
  "/calls/[id]/minutes": (args) => CallMinutesPage({ params: idOf(args) }),
  "/watch": () => WatchPage(),
  "/watch/[id]": (args) => WatchSessionPage({ params: idOf(args) }),
  "/archive": () => ArchivePage({}),
  "/owner": ({ searchParams }) => OwnerBoardPage({ searchParams }),
  "/owner/people/[id]": (args) => OwnerBoardPersonPage({ params: idOf(args), searchParams: {} }),
  "/owner/assistant": ({ searchParams }) => OwnerAssistantPage({ searchParams }),
  "/owner/assistant/settings": () => OwnerAssistantSettingsPage({}),
  "/approvals": ({ searchParams }) => ApprovalsPage({ searchParams }),
  "/approvals/[id]": (args) => ApprovalPage({ params: idOf(args) }),
  "/approvals/forms": ({ searchParams }) => ApprovalFormsPage({ searchParams }),
  // W1.4 «الطلبات»: a page of its own; the approvals pages above stay
  "/requests": ({ searchParams }) => RequestsPage({ searchParams }),
  "/structure": () => StructurePage({}),
  "/development": ({ searchParams }) => DevelopmentPage({ searchParams }),
  "/development/skills": () => DevelopmentSkillsPage(),
  "/development/settings": () => DevelopmentSettingsPage(),
  "/development/people/[id]": (args) => DevelopmentPersonPage({ params: idOf(args), searchParams: {} }),
  "/my-work": ({ searchParams }) => MyWorkPage({ searchParams }),
  // W1.9 «مهام قديمة»: a page of its own under /my-work (workStaleSweep, OFF: not-found)
  "/my-work/stale": ({ searchParams }) => StalePage({ searchParams }),
  "/time": ({ searchParams }) => TimeReportPage({ searchParams }),
  "/checkins": () => CheckinsPage(),
  "/theme-gallery": () => ThemeGalleryPage(),
  "/projects": ({ searchParams }) => ProjectsPage({ searchParams }),
  "/projects/[id]": (args) => ProjectPage({ params: idOf(args) }),
  "/projects/[id]/timeline": (args) => TimelinePage({ params: idOf(args) }),
  "/boards/[id]": (args) => BoardPage({ params: idOf(args) }),
  "/tasks/[id]": (args) => TaskPage({ params: idOf(args) }),
  "/list": ({ searchParams }) => ListPage({ searchParams }),
  "/calendar": ({ searchParams }) => CalendarPage({ searchParams }),
  "/goals": () => GoalsPage(),
  "/ideas": () => IdeasPage(),
  "/cards": () => CardsPage({}),
  "/cards/[id]": (args) => CardPageRoute({ params: idOf(args) }),
  "/knowledge": () => KnowledgePage(),
  "/knowledge/[cardId]": (args) => KnowledgeSheetRoute({ params: { cardId: args.params["cardId"] ?? "" } }),
  "/production": () => ProductionPage(),
  "/departments": () => DepartmentsPage(),
  "/teams": () => TeamsPage(),
  "/members": () => MembersPage({}),
  "/files": () => FilesPage(),
  "/documents": () => DocumentsPage(),
  "/documents/[id]": (args) => DocumentRoute({ params: idOf(args) }),
  "/manufacturing": () => ManufacturingPage(),
  "/manufacturing/materials/[id]": (args) => MaterialRoute({ params: idOf(args) }),
  "/manufacturing/recipes": () => MfgRecipesRoute(),
  "/manufacturing/orders": () => MfgOrdersRoute(),
  "/manufacturing/reports": () => MfgReportsRoute({ searchParams: {} }),
  "/crm": () => CrmPage(),
  "/analytics": () => AnalyticsPage({}),
  "/automation": () => AutomationPage({}),
  "/telegram": () => TelegramPage({}),
  "/settings": () => SettingsPage(),
  "/profile": () => ProfilePage(),
  // C4.1 «إعداداتي»: `/profile` now REDIRECTS to its first section (the old address keeps working); the sections are one dynamic page
  "/settings/me": () => SettingsMePage(),
  "/settings/me/[section]": ({ params }) => SettingsMeSectionPage({ params: { section: params["section"] ?? "" } }),
  "/u/[id]": (args) => PublicProfilePage({ params: idOf(args) }),
  "/app-link": ({ searchParams }) => AppLinkPage({ searchParams }),
  "/guide": () => GuidePage(),
  "/guide/[slug]": ({ params }) => GuideArticlePage({ params: { slug: params["slug"] ?? "" } }),
  "/spaces": () => SpacesPage({}),
  "/spaces/current": () => CurrentSpacePage(),
  "/spaces/[id]/settings": (args) => SpaceSettingsPage({ params: idOf(args) }),
  "/tickets": () => TicketsPage({}),
  "/campaigns": () => CampaignsPage(),
  "/login": () => LoginPage(),
  "/register": () => RegisterPage(),
  "/register/check-email": () => RegisterCheckEmailPage(),
  "/register/confirm": ({ searchParams }) => RegisterConfirmPage({ searchParams }),
  "/onboarding": ({ searchParams }) => OnboardingPage({ searchParams }),
  // M1a: where the phone's share sheet lands (outside the shell, signed-in people only); called with some words, as the share sheet does
  "/share": () => SharePage({ searchParams: { text: "x" } }),
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
  await db.organization.update({ where: { id: orgId }, data: { settings: { features: { ownerAssistant: true, knowledgeCards: true, workRequests: true } } } });
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
    case "/spaces/[id]/settings":
      // A2.2: a space of the team, the one shared with the partner, the one nobody is in, and one that is gone
      return [...spaces.map((s) => s.space.id), GONE].map((id) => `/spaces/${id}/settings`);
    case "/boards/[id]":
      return [...spaces.map((s) => s.board.id), GONE].map((id) => `/boards/${id}`);
    case "/tasks/[id]":
      return [...spaces.map((s) => s.task.id), GONE].map((id) => `/tasks/${id}`);
    case "/chat/[id]":
      // a topic of the team's space, one of the space nobody is in, and one that is gone
      return [w.teamTopic.id, w.closedTopic.id, GONE].map((id) => `/chat/${id}`);
    case "/chat/[id]/info":
      // the phone's info screen: with the switch OFF it goes to the conversation, so the same three: a topic of the team's space, one nobody is in, one that is gone
      return [w.teamTopic.id, w.closedTopic.id, GONE].map((id) => `/chat/${id}/info`);
    case "/chat/[id]/whiteboard":
      return [w.teamTopic.id, w.closedTopic.id, GONE].map((id) => `/chat/${id}/whiteboard`);
    case "/chat/s/[spaceId]":
      // the forum view of a space of the team, one of the space nobody is in, and one that is gone (the page reads no id: with the switch off every address goes to /chat)
      return [w.teamSpace.space.id, w.closed.space.id, GONE].map((id) => `/chat/s/${id}`);
    case "/calls/[id]":
      return [w.topicCall.id, w.closedMeeting.id, GONE].map((id) => `/calls/${id}`);
    case "/calls/[id]/minutes":
      // S6.2: the minutes of a call the owner can see, of one that is closed, and of one that is gone (the switch is off here: not found for every rank)
      return [w.topicCall.id, w.closedMeeting.id, GONE].map((id) => `/calls/${id}/minutes`);
    case "/watch/[id]":
      return [w.watch.id, GONE].map((id) => `/watch/${id}`);
    case "/cards/[id]":
      // a card of the team's space, one of the space shared with the partner, one of the space nobody is in, and one that is gone
      return [...spaces.map((s) => s.card.id), GONE].map((id) => `/cards/${id}`);
    case "/knowledge/[cardId]":
      // a product sheet only exists through the knowledge door, which this world does not set up: the only address is one that is gone (every rank gets «not found»)
      return [`/knowledge/${GONE}`];
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
    case "/settings/me/[section]":
      // C4.1: every section of «إعداداتي», and one that does not exist (not found)
      return [...SETTINGS_ME_SECTIONS, GONE].map((section) => `/settings/me/${section}`);
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
          // (W1.9 /my-work/stale is OFF by default: not-found is its honest answer, tested in work-stale-sweep.test.ts)
          // (A2.2 /spaces/[id]/settings answers not-found while controlPanelV2 is OFF, the default; the owner opens it with the switch ON in space-settings.test.ts)
          // (S6.2 /calls/[id]/minutes answers not-found while meetingMinutes is OFF, the default; the owner reads the minutes with it ON in tests/db/meeting-minutes.test.ts)
          if (rank === "OWNER" && IN_APP.has(route) && route !== "/my-work/stale" && route !== "/spaces/[id]/settings" && route !== "/calls/[id]/minutes" && !address.includes(GONE)) {
            expect(end.kind, `${where}: the owner opens it`).toBe("rendered");
          }
        }
      });
    }
  }
});

// ───────────────────────────── 4. N1.7 and N1.8: the old addresses, and the landing page ─────────────────────────────

describe("N1.7: every old address is still a page, and «القائمة» and «التقويم» are their own pages while the switch workMyTasks is OFF (W1.1 sends them to «مهامي» only when it is on: see below)", () => {
  it("/list and /calendar draw their own page for every rank, with no step through /my-work", async () => {
    const w = await linkWorld();
    for (const person of [w.owner, w.admin, w.lead, w.member, w.guest]) {
      await loginAs(person.id);
      for (const address of ["/list", "/calendar"]) {
        const { end, chain } = await land(address);
        expect(chain.map(pathOf), `${person.name} ${address}`).not.toContain("/my-work");
        expect(end.kind, `${person.name} ${address}`).toMatch(/^(?:rendered|not-found)$/);
      }
    }
  });
});

describe("N1.8: the landing page is a company setting; «/» stays reachable as «اليوم»", () => {
  async function settle(settings: Record<string, unknown>) {
    const w = await linkWorld();
    await db.organization.update({
      where: { id: w.org.id },
      data: { settings: { features: { ownerAssistant: true, knowledgeCards: true, ...(settings["features"] as object | undefined) }, ...(settings["landing"] ? { landing: settings["landing"] as Landing } : {}) } },
    });
    return w;
  }
  const everyone = (w: World) => [w.owner, w.admin, w.lead, w.member, w.guest];

  it("navV2 OFF (the default, as merged): «/» is «اليوم» for everybody whatever the setting says - nothing changed", async () => {
    const w = await settle({ landing: "chat" });
    for (const person of everyone(w)) {
      await loginAs(person.id);
      expect((await open("/")).kind, person.name).toBe("rendered");
    }
  });

  it("navV2 ON with the default landing (the chat): «/» sends everybody to /chat, and «/?view=today» is «اليوم»", async () => {
    const w = await settle({ features: { navV2: true } });
    for (const person of everyone(w)) {
      await loginAs(person.id);
      expect(await open("/"), person.name).toEqual({ kind: "redirect", to: "/chat" });
      expect((await open("/?view=today")).kind, person.name).toBe("rendered");
    }
  });

  it("navV2 ON with the landing «اليوم»: «/» is «اليوم»; an explicit «chat» redirects like the default", async () => {
    const today = await settle({ features: { navV2: true }, landing: "today" });
    await loginAs(today.member.id);
    expect((await open("/")).kind).toBe("rendered");
    const chat = await settle({ features: { navV2: true }, landing: "chat" });
    await loginAs(chat.member.id);
    expect(await open("/")).toEqual({ kind: "redirect", to: "/chat" });
  });

  it("a broken landing value is the default (the chat), never an error", async () => {
    const w = await settle({ features: { navV2: true } });
    await db.organization.update({ where: { id: w.org.id }, data: { settings: { features: { navV2: true, ownerAssistant: true }, landing: "nowhere" } } });
    await loginAs(w.member.id);
    expect(await open("/")).toEqual({ kind: "redirect", to: "/chat" });
  });

  it("the redirect ends on a page that exists and draws (the walk above follows it)", async () => {
    const w = await settle({ features: { navV2: true } });
    for (const person of everyone(w)) {
      await loginAs(person.id);
      const { end, chain } = await land("/");
      expect(chain, person.name).toEqual(["/", "/chat"]);
      expect(end.kind, person.name).toMatch(/^(?:rendered|not-found)$/);
    }
  });
});

// ───────────────────────────── 5. W1.4: «الطلبات» is a new page, and no old address moved ─────────────────────────────

describe("W1.4: /requests is a page of its own and the approvals addresses are still pages", () => {
  it("every rank lands on /requests and on every approvals address without a break; a guest never reads the company's inbox", async () => {
    const w = await linkWorld();
    for (const person of [w.owner, w.admin, w.lead, w.member, w.guest]) {
      await loginAs(person.id);
      for (const address of ["/requests", "/requests?tab=mine", "/approvals", "/approvals/forms"]) {
        const { end, chain } = await land(address);
        expect(chain.map(pathOf), `${person.name} ${address}`).not.toContain("/my-work");
        expect(end.kind, `${person.name} ${address}`).toMatch(/^(?:rendered|not-found)$/);
      }
    }
  });

  it("with the switch OFF (the default) the same address serves today's approvals page for staff, so nothing is lost", async () => {
    const w = await linkWorld();
    await db.organization.update({ where: { id: w.org.id }, data: { settings: { features: { ownerAssistant: true, knowledgeCards: true } } } });
    for (const person of [w.owner, w.admin, w.lead, w.member]) {
      await loginAs(person.id);
      const { end } = await land("/requests");
      expect(end.kind, person.name).toMatch(/^(?:rendered|not-found)$/);
    }
  });
});

// ───────────────────────────── 6. W1.1: «القائمة» and «التقويم» are views of «مهامي», behind the switch workMyTasks ─────────────────────────────

describe("W1.1: with the switch `workMyTasks` ON, /list and /calendar land on «مهامي» (?view=list|calendar&scope=space) for every rank; the old addresses keep working", () => {
  async function worldWithSwitch(on: boolean) {
    const w = await linkWorld();
    await db.organization.update({ where: { id: w.org.id }, data: { settings: { features: { ownerAssistant: true, knowledgeCards: true, workRequests: true, workMyTasks: on } } } });
    return w;
  }

  it("ON: every rank's /list, /calendar and the old inner tabs end on /my-work, drawn, in one step and never in a loop", async () => {
    const w = await worldWithSwitch(true);
    for (const person of [w.owner, w.admin, w.lead, w.member, w.guest]) {
      await loginAs(person.id);
      for (const [address, target] of [
        ["/list", "/my-work?view=list&scope=space"],
        ["/calendar", "/my-work?view=calendar&scope=space"],
        ["/calendar?mine=1&month=2026-12", "/my-work?view=calendar&scope=me&month=2026-12"],
        ["/list?group=assignee&q=x", "/my-work?view=list&scope=space&q=x&group=person"],
      ] as const) {
        const { end, chain } = await land(address);
        expect(chain.map((step) => step.split("?")[0]).slice(-1)[0], `${person.name} ${address}`).toBe("/my-work");
        expect(chain, `${person.name} ${address}`).toContain(target);
        expect(end.kind, `${person.name} ${address}`).toMatch(/^(?:rendered|not-found)$/);
      }
      for (const address of ["/my-work", "/my-work?tab=today", "/my-work?tab=completed", "/my-work?view=board", "/my-work?task=whatever"]) {
        const { end, chain } = await land(address);
        expect(chain, `${person.name} ${address}`).toEqual([address]);
        expect(end.kind, `${person.name} ${address}`).toBe("rendered");
      }
    }
  });

  it("OFF (the default): the same addresses are their own pages and none of them steps through /my-work", async () => {
    const w = await worldWithSwitch(false);
    for (const person of [w.owner, w.admin, w.lead, w.member, w.guest]) {
      await loginAs(person.id);
      for (const address of ["/list", "/calendar", "/list?group=assignee", "/calendar?mine=1"]) {
        const { end, chain } = await land(address);
        expect(chain.map(pathOf), `${person.name} ${address}`).not.toContain("/my-work");
        expect(end.kind, `${person.name} ${address}`).toMatch(/^(?:rendered|not-found)$/);
      }
    }
  });
});

// ───────────────────────────── 7. C4.1: /profile redirects to «إعداداتي» and keeps working ─────────────────────────────

describe("C4.1: /profile is still an address: it redirects to «حسابي», the first section of «إعداداتي»", () => {
  it("every rank is sent to /settings/me/account, which draws (a signed-out visitor still goes to the sign-in)", async () => {
    const w = await linkWorld();
    for (const person of [w.owner, w.admin, w.lead, w.member, w.guest]) {
      await loginAs(person.id);
      await expect(ProfilePage(), person.name).rejects.toThrow("NEXT_REDIRECT:/settings/me/account");
      const { end, chain } = await land("/profile");
      expect(chain.map(pathOf), person.name).toEqual(["/profile", "/settings/me/account"]);
      expect(end.kind, person.name).toBe("rendered");
    }
    logout();
    await expect(ProfilePage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("the sections draw for every rank, the company's switch hides «المجلدات» (not found) and an unknown section is not found", async () => {
    const w = await linkWorld();
    for (const person of [w.owner, w.admin, w.lead, w.member, w.guest]) {
      await loginAs(person.id);
      for (const section of SETTINGS_ME_SECTIONS) {
        if (section === "folders") continue;
        expect((await land(`/settings/me/${section}`)).end.kind, `${person.name} ${section}`).toBe("rendered");
      }
      expect((await land(`/settings/me/${GONE}`)).end.kind, person.name).toBe("not-found");
    }
    await db.organization.update({ where: { id: w.org.id }, data: { settings: { features: { ownerAssistant: true, knowledgeCards: true, workRequests: true, chatFolders: false } } } });
    await loginAs(w.member.id);
    expect((await land("/settings/me/folders")).end.kind).toBe("not-found");
  });
});

// ───────────────────────────── 8. M1a: /share is a door page that only a signed-in person opens ─────────────────────────────

describe("M1a: /share (where the phone's share sheet lands) is outside the shell, and a signed-out visitor goes to the sign-in", () => {
  it("every rank sees the page draw; signed out, the visitor is sent to /login", async () => {
    const w = await linkWorld();
    for (const person of [w.owner, w.admin, w.lead, w.member, w.guest]) {
      await loginAs(person.id);
      expect((await open("/share?text=x")).kind, person.name).toBe("rendered");
    }
    logout();
    expect(await open("/share?text=x")).toEqual({ kind: "redirect", to: "/login" });
  });
});
