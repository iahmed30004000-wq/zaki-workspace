/**
 * THE FIVE PLACES — the one map of the navigation.
 *
 * The owner's plan for Phase 2: five places and no more — اليوم · الدردشة · الشغل · المكتبة · الإدارة; and a sixth
 * by his own ask (2026-10-26): نتفرّج سوا. His later ask (2026-10-30) put «الإدارة» LAST, after it: the order is
 * اليوم · الدردشة · الشغل · المكتبة · نتفرّج سوا · الإدارة, on the computer's menu and the phone's bar alike.
 * A place has tabs, and every tab is a page that already existed: nothing was removed and no old
 * address broke, the pages were only grouped (LEGACY_ROUTES lists them, and a test proves each one
 * is still a page and still has a home here).
 *
 * The bottom bar (phone), the side menu (computer), the tab strip, the command palette and the
 * guide's tours all read this one module. It is PURE on purpose — no React, no Next, no server
 * imports — so the (app) layout computes the person's map on the server (`buildNav`), the shell
 * draws it in the browser, and the tests read it directly.
 *
 * ⚠️ The map is discoverability only. A tab that is not offered is still refused by the server on
 *    its own (every page and route decides from the session), and a tab that IS offered may still
 *    show the page's own "not for you" notice.
 * 🔧 When a page's rule changes, change its tab's `requires` here too: tests/nav-places.test.ts
 *    pins who sees what, rank by rank.
 *
 * ⚠️ One rule runs the other way and has no exception: a page or route whose tab is NOT offered to
 *    an external partner (a guest) must refuse a guest and hand them no company data, even though a
 *    guest never sees the link. A page may be open to MORE people than its tab (the reports page
 *    serves everybody who is not a guest, its tab is offered from LEAD up), never to a guest unless
 *    the tab includes guests.
 * 🔧 `canOpenTab` / `offeredToGuests` below are that rule in one place: the pages that refuse guests
 *    ask `offeredToGuests`, so flipping a tab here flips them with it, and
 *    tests/db/guest-internal-pages.test.ts renders every tab's page as every rank to prove it.
 *
 * TWO MAPS, ONE SWITCH (N1.1, docs/restructure/N1-navigation.md). `PLACES_V1` is the map above, untouched. `PLACES_V2` is the new one,
 * drawn for a person whose `NavSubject.navV2` is true (the company's switch `navV2`, OFF when merged): الدردشة · اليوم · الشغل ·
 * المكتبة · نتفرّج سوا · الإدارة (or «الناس» for staff with no admin power), at most four tabs per place (`MAX_TABS`) and the rest under
 * «المزيد» (`NavPlace.more`). Both maps are pinned by tests (tests/nav-places.test.ts, tests/nav-places-v2.test.ts). A place whose new page
 * is built later points at TODAY's page until then («مهامي» → /my-work, W1.1 — behind the switch `workMyTasks` the same address is the unified screen; «الإدارة» keeps today's tabs, A2.1). «الطلبات» has its own page since W1.4 (/requests; the approvals pages stay pages of the same tab).
 * Nothing is removed by either map: /list and /calendar stay pages (they are views of «مهامي» on the new map, W1.1 will fold them in).
 */

import type { FeatureKey } from "../features";
import { opensOnCards, type SpaceLayout } from "../cards/shared";

/** The ranks, as the policy names them (src/server/policy/rank.ts keeps the order; a test compares). */
export const NAV_ROLES = ["OWNER", "ADMIN", "LEAD", "MEMBER", "GUEST"] as const;
export type NavRole = (typeof NAV_ROLES)[number];

/**
 * Who the map is drawn for: the rank held in the ACTIVE organization and the EFFECTIVE capabilities
 * (the rank's defaults plus and minus what the owner switched). The layout passes `actor.role` and
 * `[...actor.caps]`.
 */
export interface NavSubject {
  role: NavRole;
  caps: readonly string[];
  /**
   * Does this person manage the space they are in (the owner, its ADMIN, an org ADMIN who is in it)? Read from the
   * database by the layout (`currentSpace(actor).manager`), because a space role is not a capability. An external
   * partner never does, whatever is passed. It only decides whether «المساحة» is offered: the page and the routes
   * behind it decide again, on the server.
   */
  spaceManager?: boolean;
  /**
   * Does somebody ACTIVE answer to this person («الهيكل»)? Read from the database by the layout (a reporting line is data, not a
   * capability). An external partner never is. It only decides whether «الهيكل» is offered and whether the file tab is called
   * «الأداء والتطوير» or «ملفي»: the pages and the routes decide again, on the server.
   */
  supervisor?: boolean;
  /** The company's switched-off features (src/lib/features.ts): their places are not drawn. */
  off?: readonly FeatureKey[];
  /**
   * The layout of the space the person is in (`currentSpace(actor).layout`, read on the server by the layout). A space of
   * «لوحات» or «تصنيع» is «فقط لوحات» (the owner's ask, 2026-10-30): its menu offers «اللوحات» and «الإدارة» and nothing
   * else (`CARDS_SPACE_PLACES`). Left out, or STANDARD: the map is the usual one, untouched.
   */
  spaceLayout?: SpaceLayout;
  /**
   * Draw the NEW map (`PLACES_V2`) for this person: the company's switch `navV2` is on. Left out or false: the old map, exactly as before.
   * (A switch is read from `Organization.settings` on the server: `navExtrasOf` in src/server/policy/org-settings.ts hands this and `workTabs`
   * to whoever builds the subject.)
   */
  navV2?: boolean;
  /**
   * The company's switch `workMyTasks` is ON (W1.1): «مهامي» is the ONE screen of the person's tasks, and «القائمة» and «التقويم» are views of it (`/list` and
   * `/calendar` send there), so the OLD map stops drawing them as tabs of their own. Left out or false (the default, and what the switch OFF gives): the old tabs
   * are drawn as they always were. (`navExtrasOf` in src/server/policy/org-settings.ts hands it to whoever builds the subject, like `navV2`.)
   */
  workMyTasks?: boolean;
  /**
   * The optional work tools the OWNER pinned as tabs for the whole company (`Organization.settings.workTabs`, written by A2.1): at most two keys
   * of `WORK_OPTIONAL_TABS`, in his order. They follow the core tabs while there is room under `MAX_TABS`; what does not fit stays in «المزيد».
   * Only the new map reads it; a tool the person may not open is never drawn because it was pinned.
   */
  workTabs?: readonly string[];
}

export type PlaceKey = "today" | "chat" | "work" | "library" | "admin" | "watch" | "cards";

export type TabKey =
  | "my-work"
  | "projects"
  | "list"
  | "calendar"
  | "goals"
  | "ideas"
  | "production"
  | "departments"
  | "tickets"
  | "campaigns"
  | "crm"
  | "checkins"
  | "files"
  | "documents"
  | "knowledge"
  | "team"
  | "space"
  | "reports"
  | "automation"
  | "telegram"
  | "settings"
  | "archive"
  | "board"
  | "assistant"
  | "approvals"
  | "structure"
  | "development"
  // «الطلبات» (N1.1, the new map only; its own page /requests since W1.4): everything that waits for a decision - approvals, assignment requests, the person's department tickets, cards and sheets.
  | "requests"
  // «مهام قديمة» (W1.9, the new map only, under «المزيد»): the review list of open tasks nobody touched, for the owner and whoever manages a space.
  | "stale";

/** An icon by NAME: the shell maps it to a drawing (src/components/shell/nav-icons.tsx). Data only, so it crosses from server to browser. */
export type NavIconKey = "today" | "chat" | "work" | "library" | "admin" | "team" | "reports" | "automation" | "telegram" | "settings" | "watch" | "cards";

/**
 * Who may see a place or a tab:
 *   "everyone"            every signed-in person, an external partner (guest) included
 *   "staff"               everybody but a guest
 *   { capability }        holds that switch (a guest never does, whatever was stored)
 *   { rankAtLeast }       that rank or above
 *   { anyOf }             one of these
 *   { allOf }             all of these (W1.8: a page that needs two boxes, e.g. «التذاكر» = the directory AND the tickets box)
 *   { spaceManager }      staff who manage the space they are in (`NavSubject.spaceManager`)
 *   { supervisor }        staff somebody answers to (`NavSubject.supervisor`)
 *   { workCapability }    an external partner (the space's own rules decide for them), or staff holding that box
 */
export type Requirement =
  | "everyone"
  | "staff"
  | { readonly capability: string }
  | { readonly rankAtLeast: NavRole }
  | { readonly anyOf: readonly Requirement[] }
  | { readonly allOf: readonly Requirement[] }
  | { readonly workCapability: string }
  | { readonly spaceManager: true }
  | { readonly supervisor: true };

export interface TabDef {
  readonly key: TabKey;
  readonly href: string;
  readonly labelKey: string;
  readonly requires: Requirement;
  /** The icon the place wears when this is its only tab (only the admin place takes its tab's name). */
  readonly icon?: NavIconKey;
  /** Other addresses that are this tab's pages (a board is part of a project, an old URL that moved). */
  readonly also?: readonly string[];
  /** The owner's switch this tab is behind («الميزات»): off, the tab is gone for everybody. */
  readonly feature?: FeatureKey;
  /** A tab that is called differently for different people («لوحة المالك» / «لوحة الفريق» / «لوحتي»): the dictionary key for this person. */
  readonly labelFor?: (subject: NavSubject) => string;
  /** A tab that is not drawn for this person because something else took its place («التقارير» is inside «لوحة التحكم» for the owner). */
  readonly hideFor?: (subject: NavSubject) => boolean;
}

export interface PlaceDef {
  readonly key: PlaceKey;
  /**
   * The optional tools of the place (the new map's «المزيد»): offered like tabs but drawn under «المزيد» unless the owner pinned them
   * (`NavSubject.workTabs`). A place with `more` is the one that takes pins.
   */
  readonly more?: readonly TabDef[];
  /**
   * The new map's rule for the place that is called «الناس» for staff with no admin power: when none of the person's tabs is `powered`, the place
   * takes this name and icon instead of its own. One rule, no name per tab (the old `singleTabTakesLabel` is the old map's alone).
   */
  readonly peopleOnly?: { readonly labelKey: string; readonly icon: NavIconKey; readonly powered: (tab: TabDef, subject: NavSubject) => boolean };
  /** Where the place opens. Left out: on its first tab the person may use. */
  readonly href?: string;
  readonly labelKey: string;
  readonly icon: NavIconKey;
  readonly requires: Requirement;
  /** Empty: a place that is one page. Otherwise the place is shown only while one of them is. */
  readonly tabs: readonly TabDef[];
  /** Addresses that belong to the place without being one of its tabs (a task: from a list, a board, a notification). */
  readonly owns?: readonly string[];
  /** With exactly one tab left, the place is called by that tab (a plain member sees «الفريق», not «الإدارة»). */
  readonly singleTabTakesLabel?: boolean;
  /** The owner's switch this place is behind («الميزات»): off, the place is gone for everybody. */
  readonly feature?: FeatureKey;
}

/** W1.1: with the switch `workMyTasks` ON the list and the calendar are views of «مهامي» (the old addresses redirect there), not tabs of their own. */
const foldedIntoMyTasks = (subject: NavSubject): boolean => subject.workMyTasks === true;

export const PLACES_V1: readonly PlaceDef[] = [
  { key: "today", href: "/", labelKey: "nav.place.today", icon: "today", requires: "everyone", tabs: [] },
  // Chat is available to guests; server-side topic policy limits what they can read.
  { key: "chat", href: "/chat", labelKey: "nav.place.chat", icon: "chat", requires: "everyone", tabs: [] },
  {
    key: "work",
    href: "/my-work",
    labelKey: "nav.place.work",
    icon: "work",
    requires: "everyone",
    // /time is «تقرير الوقت»: linked from a task and from «وقتي اليوم», not one of the tabs (the menu and its order stay as they were)
    owns: ["/tasks", "/time"],
    tabs: [
      { key: "my-work", href: "/my-work", labelKey: "nav.tab.myWork", requires: { workCapability: "tasks.view" } },
      { key: "projects", href: "/projects", labelKey: "nav.projects", requires: { workCapability: "projects.view" }, also: ["/boards"] },
      { key: "list", href: "/list", labelKey: "nav.listView", requires: { workCapability: "tasks.view" }, hideFor: foldedIntoMyTasks },
      { key: "calendar", href: "/calendar", labelKey: "nav.calendar", requires: { workCapability: "tasks.view" }, hideFor: foldedIntoMyTasks },
      // The company's own goals and ideas (titles, descriptions, who wrote them): not shared with an external
      // partner. The pages and /api/goals, /api/ideas refuse a guest too (docs/PHASE0-AUDIT.md R10).
      { key: "goals", href: "/goals", labelKey: "nav.goals", requires: { capability: "goals.view" } },
      // temporary: becomes a chat topic in Phase 3
      { key: "ideas", href: "/ideas", labelKey: "nav.ideas", requires: { capability: "ideas.view" } },
      { key: "production", href: "/production", labelKey: "nav.production", requires: { capability: "production.view" } },
      // W1.8 — HONEST TABS (D-W3 is pending, so no page is relaxed yet): the three department pages refuse a person whose `directory.view` is off (the «not enabled for you» notice),
      // so their tabs say the same. «التذاكر» and «الحملات» also need their own section box. When the owner answers D-W3 («آه للموظفين»): drop `directory.view` here AND in the
      // three pages, and flip tests/db/work-tabs-honest.test.ts, in ONE commit (recorded in docs/restructure/DECISIONS.md).
      { key: "departments", href: "/departments", labelKey: "nav.departments", requires: { capability: "directory.view" } },
      // a department's tickets and campaigns, each a page of its own (the owner's ask, 2026-10-25)
      { key: "tickets", href: "/tickets", labelKey: "nav.tickets", requires: { allOf: [{ capability: "directory.view" }, { capability: "tickets.view" }] } },
      { key: "campaigns", href: "/campaigns", labelKey: "nav.campaigns", requires: { allOf: [{ capability: "directory.view" }, { capability: "campaigns.view" }] } },
      { key: "crm", href: "/crm", labelKey: "nav.crm", requires: { capability: "crm.view" } },
      // «الموافقات» (the owner's backlog, 2026-10-31): requests for a decision from one approver or a chain, and the forms that create
      // them. For staff (a guest never asks, sees or is asked: the pages and /api/approvals refuse them too), behind its switch.
      { key: "approvals", href: "/approvals", labelKey: "nav.approvals", requires: "staff", feature: "approvals" },
      // «التسجيل اليومي» (the owner's ask, 2026-10-31): the space's short stand-up. Staff only (an external partner never sees the
      // team's answers), and only while its switch in «الميزات» is on; the page and the routes decide again on the server.
      { key: "checkins", href: "/checkins", labelKey: "nav.tab.checkins", requires: "staff", feature: "checkins" },
    ],
  },
  {
    key: "library",
    href: "/files",
    labelKey: "nav.place.library",
    icon: "library",
    // «المستندات» is offered to everybody the space lets in, an external partner included (they read only what is shared with
    // them), so the place is too; the files tab keeps its own box, and a guest's place opens on «المستندات» (the first tab they may use)
    requires: "everyone",
    tabs: [
      { key: "files", href: "/files", labelKey: "nav.files", requires: { capability: "files.view" } },
      // «المستندات» (the owner's backlog, 2026-11-01): the text documents of the space. Behind its switch in «الميزات»; the page and
      // /api/documents decide again on the server (a person outside the space, or a document not shared with a partner: not found).
      { key: "documents", href: "/documents", labelKey: "nav.tab.documents", requires: "everyone", feature: "spaceDocs" },
      // «المنتجات» (Q1.1): the product sheets. Staff only (an external partner never comes in), behind its switch in «الميزات».
      { key: "knowledge", href: "/knowledge", labelKey: "nav.tab.knowledge", requires: "staff", feature: "knowledgeCards" },
    ],
  },
  // «نتفرّج سوا» (the owner's ask, 2026-10-26: «الشغل، تحتها المكتبة، الإدارة، ثم نتفرّج سوا»; «الإدارة» was moved after it on 2026-10-30): a place of its own,
  // one page, before «الإدارة». People of a space watch one link together; the sessions are the team's own talk,
  // so not an external partner's (the page and /api/watch refuse a guest too: `placeOfferedToGuests`).
  { key: "watch", href: "/watch", labelKey: "nav.place.watch", icon: "watch", requires: { capability: "watch.view" }, tabs: [], feature: "watch" },
  // «الإدارة» is the LAST place (the owner's ask, 2026-10-30), after «نتفرّج سوا».
  {
    key: "admin",
    labelKey: "nav.place.admin",
    icon: "admin",
    requires: "everyone",
    singleTabTakesLabel: true,
    tabs: [
      // /teams stays a working address, but it is the same people as /members: one tab, not two.
      // /members is the directory for whoever holds `directory.view` AND the people manager for whoever holds
      // `users.manage` (even with the directory switched off), so either switch opens the tab.
      {
        key: "team",
        href: "/members",
        labelKey: "nav.tab.team",
        icon: "team",
        requires: { anyOf: [{ capability: "directory.view" }, { capability: "users.manage" }] },
        also: ["/teams", "/u"],
      },
      // «تعديل المساحة» and «أعضاء المساحة», moved here from the projects page (the owner's ask, 2026-10-30): the space
      // the person is in, for whoever manages it. The flag comes from the layout (a space role is not a capability).
      { key: "space", href: "/spaces/current", labelKey: "nav.tab.space", icon: "admin", requires: { spaceManager: true } },
      // «لوحة المالك» (the owner's ask, 2026-10-30): the owner and his partners read everything on it; a person holding
      // `board.team` («لوحة الفريق») reads the people of the spaces they manage; `board.self` («لوحتي», on for every staff
      // rank) reads one's own page. One tab, called by what the person may read there; every route decides again on the server.
      {
        key: "board",
        href: "/owner",
        labelKey: "nav.tab.board",
        icon: "reports",
        requires: { anyOf: [{ capability: "board.self" }, { capability: "board.team" }] },
        feature: "ownerBoard",
        labelFor: (subject) =>
          subject.role === "OWNER" ? (subject.off?.includes("controlPanel") ? "nav.tab.board" : "nav.tab.controlPanel") : subject.caps.includes("board.team") ? "nav.tab.boardTeam" : "nav.tab.boardSelf",
      },
      // «مساعد المالك» (the owner's ask, 2026-10-30): next to «لوحة المالك», for the OWNER rank alone (the owner and his partners)
      // and only while its switch in «الميزات» is on. The pages and routes decide again on the server (404 for everybody else).
      { key: "assistant", href: "/owner/assistant", labelKey: "nav.tab.assistant", icon: "reports", requires: { rankAtLeast: "OWNER" }, feature: "ownerAssistant" },
      // «الهيكل» (the owner's ask, 2026-10-31): who answers to whom. The owner, whoever holds `people.manage_lines` and every supervisor
      // (for their own people); a plain employee reads their own supervisor on their «ملفي» page. Behind its switch in «الميزات».
      {
        key: "structure",
        href: "/structure",
        labelKey: "nav.tab.structure",
        icon: "team",
        requires: { anyOf: [{ rankAtLeast: "OWNER" }, { capability: "people.manage_lines" }, { supervisor: true }] },
        feature: "teamDevelopment",
      },
      // «الأداء والتطوير»: skills, scores, reviews and plans of the people one reads: the owner, a supervisor, a holder of `people.review`
      // or `people.manage_lines`. A plain employee reads their OWN file («ملفي») from a link on «لوحتي» (their menu stays as it was);
      // the page serves them, and the routes decide again on the server.
      {
        key: "development",
        href: "/development",
        labelKey: "nav.tab.development",
        icon: "reports",
        requires: { anyOf: [{ rankAtLeast: "OWNER" }, { capability: "people.review" }, { capability: "people.manage_lines" }, { supervisor: true }] },
        feature: "teamDevelopment",
      },
      // «التقارير» is a section of «لوحة التحكم» for the OWNER rank while that panel (and the board under it) is on: the page redirects there
      // and the menu does not draw it twice. Everybody else with the «التقارير» box keeps this tab and this page.
      {
        key: "reports",
        href: "/analytics",
        labelKey: "nav.analytics",
        icon: "reports",
        requires: { capability: "reports.view" },
        hideFor: (subject) => subject.role === "OWNER" && !subject.off?.includes("controlPanel") && !subject.off?.includes("ownerBoard"),
      },
      { key: "automation", href: "/automation", labelKey: "nav.tab.automation", icon: "automation", requires: { capability: "integrations.manage" } },
      { key: "telegram", href: "/telegram", labelKey: "nav.telegram", icon: "telegram", requires: { capability: "integrations.manage" } },
      {
        key: "settings",
        href: "/settings",
        labelKey: "nav.settings",
        icon: "settings",
        requires: { anyOf: [{ capability: "users.manage" }, { rankAtLeast: "OWNER" }] },
      },
      { key: "archive", href: "/archive", labelKey: "nav.archive", requires: { capability: "archive.view" } },
    ],
  },
];

/**
 * The old map under its old name: the shell, the palette and the tests that were written before the new map say `PLACES`, and they still get the
 * old map. The new map is `PLACES_V2`.
 */
export const PLACES: readonly PlaceDef[] = PLACES_V1;

/** The most tabs a place shows on the new map; everything else of the place is under «المزيد». */
export const MAX_TABS = 4;
/** The most optional tools the owner may pin as tabs (`Organization.settings.workTabs`). */
export const MAX_PINNED_TABS = 2;
/** The optional tools of «الشغل»: the tabs of the old map that are not «مهامي» «المشاريع» «الطلبات» (each behind its own switch or box), and «مهام قديمة» (W1.9, the new map's own). */
export const WORK_OPTIONAL_TABS: readonly TabKey[] = ["goals", "ideas", "production", "departments", "tickets", "campaigns", "crm", "checkins", "stale"];

/**
 * «مهام قديمة» (W1.9, switch `workStaleSweep`): /my-work/stale. Offered to the owner rank (a partner manages every space) and to whoever manages the space they are in (the
 * layout's `spaceManager`); the page decides again from the spaces the person manages (`managedSpacesOf`) and refuses a guest. While the switch is off the page is not found, so the
 * tab is not offered either. A guest never holds it: `spaceManager` is false for an outsider and the rank is below OWNER.
 */
const STALE_TAB: TabDef = {
  key: "stale",
  href: "/my-work/stale",
  labelKey: "nav.tab.stale",
  requires: { anyOf: [{ rankAtLeast: "OWNER" }, { spaceManager: true }] },
  feature: "workStaleSweep",
};

/** An optional tool of «الشغل» on the new map: a tab of the old map reused as it is, or «مهام قديمة» which only the new map has. */
const optionalTab = (key: TabKey): TabDef => (key === "stale" ? STALE_TAB : v1Tab(key));

/** A tab of the old map, by key: the new map reuses the definition (the same page, the same rule, the same box). */
function v1Tab(key: TabKey): TabDef {
  for (const place of PLACES_V1) {
    const found = place.tabs.find((tab) => tab.key === key);
    if (found) return found;
  }
  throw new Error(`places.ts: no tab ${key} in the old map`);
}

/** The admin tabs that are real administration: a person with none of them (and no control panel) is in «الناس», not «الإدارة». */
const ADMIN_POWER_TABS: readonly TabKey[] = ["space", "assistant", "reports", "automation", "telegram", "settings", "archive"];

/** «لوحة التحكم» for the owner and whoever holds `board.team`, «لوحتي» for everybody else: one page, named by what the person may read on it. */
const boardLabelV2 = (subject: NavSubject): string => (subject.role === "OWNER" || subject.caps.includes("board.team") ? "nav.tab.controlPanel" : "nav.tab.boardSelf");

/**
 * THE NEW MAP (switch `navV2`). See the header. Order: الدردشة first (the app opens there, D-N1), then اليوم, الشغل, المكتبة, نتفرّج سوا, and
 * «الإدارة» last (the owner's ask of 2026-10-30 holds). Every tab is a page that exists today and serves the person it is offered to; the
 * pages of «الطلبات» / «مهامي» / the admin tabs are today's until their own phase replaces them.
 */
export const PLACES_V2: readonly PlaceDef[] = [
  { key: "chat", href: "/chat", labelKey: "nav.place.chat", icon: "chat", requires: "everyone", tabs: [] },
  // «اليوم» stays reachable from the menu even when the company's landing page is the chat: «/» alone follows the landing setting (src/app/(app)/page.tsx)
  { key: "today", href: "/?view=today", labelKey: "nav.place.today", icon: "today", requires: "everyone", tabs: [] },
  {
    key: "work",
    href: "/my-work",
    labelKey: "nav.place.work",
    icon: "work",
    requires: "everyone",
    owns: ["/tasks", "/time"],
    tabs: [
      // «القائمة» and «التقويم» are views of «مهامي» (W1.1 folds the pages in; until then they stay pages of their own and belong to this tab)
      { ...v1Tab("my-work"), also: ["/list", "/calendar"] },
      v1Tab("projects"),
      // «الطلبات» (W1.4): the inbox of everything waiting for a decision. Staff only (a guest never asks, sees or is asked). The approvals pages (list, detail, forms) stay pages of this
      // tab (`also`). It holds more than approvals (assignment requests, tickets, cards, sheets), so it leaves the map only when BOTH `approvals` and `workRequests` are off; with
      // `workRequests` off (the default) the address serves today's approvals page, so the tab never dead-ends.
      {
        key: "requests",
        href: "/requests",
        also: ["/approvals"],
        labelKey: "nav.tab.requests",
        requires: "staff",
        hideFor: (subject) => subject.off?.includes("approvals") === true && subject.off.includes("workRequests"),
      },
    ],
    more: WORK_OPTIONAL_TABS.map(optionalTab),
  },
  {
    key: "library",
    href: "/files",
    labelKey: "nav.place.library",
    icon: "library",
    requires: "everyone",
    tabs: [v1Tab("files"), v1Tab("documents"), v1Tab("knowledge")],
  },
  { key: "watch", href: "/watch", labelKey: "nav.place.watch", icon: "watch", requires: { capability: "watch.view" }, tabs: [], feature: "watch" },
  {
    key: "admin",
    labelKey: "nav.place.admin",
    icon: "admin",
    requires: "everyone",
    peopleOnly: { labelKey: "nav.place.people", icon: "team", powered: (tab, subject) => ADMIN_POWER_TABS.includes(tab.key) || tab.labelFor?.(subject) === "nav.tab.controlPanel" },
    // «الإدارة» keeps today's tabs until `controlPanelV2` (A2.1). The first four the person may open are the tabs; the rest is «المزيد».
    tabs: [
      v1Tab("team"),
      v1Tab("space"),
      { ...v1Tab("board"), labelFor: boardLabelV2 },
      v1Tab("settings"),
      v1Tab("structure"),
      v1Tab("development"),
      v1Tab("assistant"),
      v1Tab("reports"),
      v1Tab("automation"),
      v1Tab("telegram"),
      v1Tab("archive"),
    ],
  },
];

/**
 * «اللوحات» — the one place of a space of cards (the owner's ask, 2026-10-30). It is NOT in `PLACES`: a general space never
 * draws it and its map, its order and the tests that pin them stay as they were. `buildNav` puts it FIRST when the space
 * the person is in is a cards space (see `CARDS_SPACE_PLACES`). It is one page (/cards, and /cards/[id] belongs to it),
 * offered to everybody the space lets in: the cards service decides again, on the server, what each person reads.
 */
export const CARDS_PLACE: PlaceDef = {
  key: "cards",
  href: "/cards",
  labelKey: "nav.place.cards",
  icon: "cards",
  requires: "everyone",
  tabs: [],
  // «مخزون التصنيع» is a tab INSIDE a manufacturing space (drawn by the cards page and its own pages), not a place of the menu
  owns: ["/manufacturing"],
};

/**
 * What a cards space offers, after «اللوحات»: «الإدارة» only, with its own rules (a plain member sees «الفريق», a manager
 * the whole place). «اليوم» · «الدردشة» · «الشغل» · «المكتبة» · «نتفرّج سوا» are not offered THERE (still offered in every
 * other space). ⚠️ Only the menu changes: their pages and routes still answer (a link someone kept, a notification, a topic
 * opened from «أرسل»). 🔧 Nothing is removed or refused here.
 */
export const CARDS_SPACE_PLACES: readonly PlaceKey[] = ["admin"];

/** The place definitions the map is drawn from for a space of this layout: the code's map, or «اللوحات» then «الإدارة». */
function placesFor(layout: SpaceLayout | undefined, v2 = false): readonly PlaceDef[] {
  const all = v2 ? PLACES_V2 : PLACES_V1;
  if (!opensOnCards(layout)) return all;
  return [CARDS_PLACE, ...all.filter((def) => CARDS_SPACE_PLACES.includes(def.key))];
}

/** Does the company draw the new map for this person (the switch `navV2`)? */
const usesV2 = (subject: NavSubject): boolean => subject.navV2 === true;

/**
 * Every address the app had before Phase 2. Each one is still a page (`src/app/(app)/<route>/page.tsx`,
 * `[id]` being the dynamic folder) and each one still has a place or, for the profile, deliberately none.
 */
export const LEGACY_ROUTES = [
  "/",
  "/chat",
  "/my-work",
  "/projects",
  "/projects/[id]",
  "/projects/[id]/timeline",
  "/boards/[id]",
  "/tasks/[id]",
  "/list",
  "/calendar",
  "/goals",
  "/ideas",
  "/production",
  "/departments",
  "/teams",
  "/members",
  "/files",
  "/documents",
  "/crm",
  "/analytics",
  "/automation",
  "/telegram",
  "/settings",
  "/profile",
  "/u/[id]",
] as const;

// ───────────────────────────────────────── who sees what ─────────────────────────────────────────

const RANK_ORDER: Readonly<Record<NavRole, number>> = { OWNER: 50, ADMIN: 40, LEAD: 30, MEMBER: 20, GUEST: 10 };

const knownRole = (role: string): role is NavRole => Object.prototype.hasOwnProperty.call(RANK_ORDER, role);

/** `role` is `min` or above. An unknown rank is below everything. */
export function rankAtLeast(role: NavRole, min: NavRole): boolean {
  return knownRole(role) && RANK_ORDER[role] >= RANK_ORDER[min];
}

function meets(req: Requirement, subject: NavSubject): boolean {
  // an unknown rank is treated like an outsider: shown what everybody may see, nothing more
  const outsider = !knownRole(subject.role) || subject.role === "GUEST";
  if (req === "everyone") return true;
  if (req === "staff") return !outsider;
  if ("anyOf" in req) return req.anyOf.some((r) => meets(r, subject));
  if ("allOf" in req) return req.allOf.every((r) => meets(r, subject));
  // an outsider works in what is shared with them by the space's rules; staff need the box
  if ("spaceManager" in req) return !outsider && subject.spaceManager === true;
  if ("supervisor" in req) return !outsider && subject.supervisor === true;
  if ("workCapability" in req) return outsider || subject.caps.includes(req.workCapability);
  if ("capability" in req) return !outsider && subject.caps.includes(req.capability);
  return rankAtLeast(subject.role, req.rankAtLeast);
}

/** A tab (or an optional tool of «المزيد»), with the place it lives in, on the old map or the new one (undefined: no such tab there). */
function findTab(tabKey: TabKey, v2 = false): { place: PlaceDef; tab: TabDef } | undefined {
  for (const place of v2 ? PLACES_V2 : PLACES_V1) {
    const tab = [...place.tabs, ...(place.more ?? [])].find((candidate) => candidate.key === tabKey);
    if (tab) return { place, tab };
  }
  return undefined;
}

/**
 * Is this tab OFFERED to this person: the place AND the tab accept them, which is exactly when
 * `buildNav` draws it. An unknown tab is offered to nobody. It decides discoverability only (see the
 * header): a page may still serve more people than its tab is offered to, but never a guest unless
 * the tab includes guests (`offeredToGuests`).
 */
export function canOpenTab(subject: NavSubject, tabKey: TabKey): boolean {
  const found = findTab(tabKey, usesV2(subject));
  return (
    found !== undefined &&
    meets(found.place.requires, subject) &&
    meets(found.tab.requires, subject) &&
    !(found.tab.feature && subject.off?.includes(found.tab.feature)) &&
    !found.tab.hideFor?.(subject)
  );
}

/**
 * Is this tab offered to an external partner (a guest)? Whatever a guest row says, a guest holds no
 * capability, so this depends on the map alone. A page that refuses guests asks this instead of
 * repeating the rule: `if (actor.isExternal && !offeredToGuests("goals")) return <GuestNotice />`.
 */
export function offeredToGuests(tabKey: TabKey): boolean {
  // either map: a page that served a guest before the new map still does, and a tab only the new map has («الطلبات») is judged by it
  return canOpenTab({ role: "GUEST", caps: [] }, tabKey) || canOpenTab({ role: "GUEST", caps: [], navV2: true }, tabKey);
}

/** Is this place (of any kind: one page, or tabs) on this person's map? Exactly when `buildNav` draws it. */
export function canOpenPlace(subject: NavSubject, placeKey: PlaceKey): boolean {
  return buildNav(subject).places.some((drawn) => drawn.key === placeKey);
}

/** `offeredToGuests` for a place that is one page (Today, the chat, «نتفرّج سوا»). */
export function placeOfferedToGuests(placeKey: PlaceKey): boolean {
  return canOpenPlace({ role: "GUEST", caps: [] }, placeKey);
}

// ───────────────────────────────────────── the person's map ─────────────────────────────────────────

export interface NavTab {
  key: TabKey;
  href: string;
  labelKey: string;
}

export interface NavPlace {
  key: PlaceKey;
  href: string;
  labelKey: string;
  icon: NavIconKey;
  /** The tabs this person may use, in order; empty for a place that is one page. On the new map never more than `MAX_TABS`. */
  tabs: NavTab[];
  /** The new map only: what the person may open in this place beyond its tabs, under «المزيد» (always an array there, absent on the old map). */
  more?: NavTab[];
}

export interface NavModel {
  places: NavPlace[];
}

/**
 * The places this person may use, each with the tabs they may use — plain data (names, addresses and
 * dictionary keys), so the server computes it and hands it to the browser as it is.
 */
export function buildNav(subject: NavSubject): NavModel {
  const v2 = usesV2(subject);
  const places: NavPlace[] = [];
  for (const def of placesFor(subject.spaceLayout, v2)) {
    if (!meets(def.requires, subject)) continue;
    if (def.feature && subject.off?.includes(def.feature)) continue;
    if (v2) {
      const drawn = buildPlaceV2(def, subject);
      if (drawn) places.push(drawn);
      continue;
    }
    const allowed = def.tabs.filter((tab) => meets(tab.requires, subject) && !(tab.feature && subject.off?.includes(tab.feature)) && !tab.hideFor?.(subject));
    if (def.tabs.length > 0 && allowed.length === 0) continue;

    const first = allowed[0];
    const only = def.singleTabTakesLabel && allowed.length === 1 ? first : undefined;
    const onlyLabel = only ? (only.labelFor?.(subject) ?? only.labelKey) : undefined;
    const href = !first || allowed.some((tab) => tab.href === def.href) ? (def.href ?? "/") : first.href;

    places.push({
      key: def.key,
      href,
      labelKey: onlyLabel ?? def.labelKey,
      icon: only?.icon ?? def.icon,
      tabs: allowed.map((tab) => ({ key: tab.key, href: tab.href, labelKey: tab.labelFor?.(subject) ?? tab.labelKey })),
    });
  }
  return { places };
}

/** The tab a person may open: its box, its switch, and not hidden for them. */
const tabOpen = (tab: TabDef, subject: NavSubject): boolean => meets(tab.requires, subject) && !(tab.feature && subject.off?.includes(tab.feature)) && !tab.hideFor?.(subject);

const navTab = (tab: TabDef, subject: NavSubject): NavTab => ({ key: tab.key, href: tab.href, labelKey: tab.labelFor?.(subject) ?? tab.labelKey });

/**
 * One place of the NEW map for this person (null: not drawn). The core tabs come first, then the tools the owner pinned (only for a place with
 * `more`), cut to `MAX_TABS`; everything else the person may open is `more`, in the code's order — so nothing is lost and two people of the same
 * rank get the same menu.
 */
function buildPlaceV2(def: PlaceDef, subject: NavSubject): NavPlace | null {
  const core = def.tabs.filter((tab) => tabOpen(tab, subject));
  const optional = (def.more ?? []).filter((tab) => tabOpen(tab, subject));
  if (def.tabs.length > 0 && core.length + optional.length === 0) return null;

  // the owner's pins: the first two keys he chose (an unknown key, a duplicate, a core tab, a tool the person may not open: ignored)
  const pinned: TabDef[] = [];
  if (def.more) {
    const chosen = [...new Set(subject.workTabs ?? [])].filter((key) => (WORK_OPTIONAL_TABS as readonly string[]).includes(key)).slice(0, MAX_PINNED_TABS);
    for (const key of chosen) {
      const tab = optional.find((candidate) => candidate.key === key);
      if (tab) pinned.push(tab);
    }
  }
  // a person with none of the core tabs but some tools still gets tabs (the tools come up), never an empty strip with a link to a page they cannot open
  const head = core.length > 0 ? [...core, ...pinned] : [...optional];
  const drawn = head.slice(0, MAX_TABS);
  const rest = [...core, ...optional].filter((tab) => !drawn.includes(tab));

  const first = drawn[0];
  const href = !first || [...drawn, ...rest].some((tab) => tab.href === def.href) ? (def.href ?? "/") : first.href;
  const peopleOnly = def.peopleOnly && ![...core, ...optional].some((tab) => def.peopleOnly?.powered(tab, subject));
  return {
    key: def.key,
    href,
    labelKey: peopleOnly && def.peopleOnly ? def.peopleOnly.labelKey : def.labelKey,
    icon: peopleOnly && def.peopleOnly ? def.peopleOnly.icon : def.icon,
    tabs: drawn.map((tab) => navTab(tab, subject)),
    more: rest.map((tab) => navTab(tab, subject)),
  };
}

// ───────────────────────────────────────── where an address lives ─────────────────────────────────────────

interface Prefix {
  path: string;
  place: PlaceKey;
  tab: TabKey | null;
}

/** The path part of a place's address ("/?view=today" is the page "/"). */
const bareHref = (href: string): string => href.split(/[?#]/, 1)[0] || "/";

/** Every address prefix a map knows, with the place (and the tab) it belongs to. */
const prefixesOf = (places: readonly PlaceDef[]): readonly Prefix[] =>
  [...places, CARDS_PLACE].flatMap((def) => [
    ...(def.tabs.length === 0 && def.href ? [{ path: bareHref(def.href), place: def.key, tab: null }] : []),
    ...(def.owns ?? []).map((path) => ({ path, place: def.key, tab: null })),
    ...[...def.tabs, ...(def.more ?? [])].flatMap((tab) => [tab.href, ...(tab.also ?? [])].map((path) => ({ path, place: def.key, tab: tab.key }))),
  ]);

const PREFIXES_V1: readonly Prefix[] = prefixesOf(PLACES_V1);
const PREFIXES_V2: readonly Prefix[] = prefixesOf(PLACES_V2);

/** The path of an address, without its query, its hash or a trailing slash; null when it is no path of this site. */
function pathOf(pathname: string): string | null {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.startsWith("//")) return null;
  const bare = (pathname.split(/[?#]/, 1)[0] ?? "").replace(/\/+$/, "");
  return bare === "" ? "/" : bare;
}

/** `prefix` is the address itself or a folder above it ("/projects" covers "/projects/x", not "/projectsx"). */
function covers(prefix: string, path: string): boolean {
  if (prefix === "/") return path === "/";
  return path === prefix || path.startsWith(`${prefix}/`);
}

const NOWHERE = { place: null, tab: null } as const;

/**
 * The place and the tab an address belongs to: the longest known prefix wins, so "/projects/x/timeline"
 * is the projects tab of «الشغل», "/tasks/x" is «الشغل» without a tab, "/u/x" is «الفريق», and the
 * profile, the guide and the onboarding belong to no place.
 */
export function locate(pathname: string, map: "v1" | "v2" = "v1"): { place: PlaceKey | null; tab: TabKey | null } {
  const path = pathOf(pathname);
  if (!path) return { ...NOWHERE };
  let best: Prefix | null = null;
  for (const prefix of map === "v2" ? PREFIXES_V2 : PREFIXES_V1) {
    if (!covers(prefix.path, path)) continue;
    if (!best || prefix.path.length > best.path.length) best = prefix;
  }
  return best ? { place: best.place, tab: best.tab } : { ...NOWHERE };
}

/** The place an address belongs to (null: none). `map`: the old map (default) or the new one. */
export function placeOfPath(pathname: string, map: "v1" | "v2" = "v1"): PlaceKey | null {
  return locate(pathname, map).place;
}

/** The tab an address belongs to (null: none, or a page of the place that is no tab). `map`: the old map (default) or the new one. */
export function tabOfPath(pathname: string, map: "v1" | "v2" = "v1"): TabKey | null {
  return locate(pathname, map).tab;
}
