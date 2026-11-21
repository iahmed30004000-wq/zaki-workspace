/**
 * N1.2 + N1.3 — the pure rules of the new shell (switch `navV2`). No React, no Next, no server imports: the browser's shell and the server's
 * `/api/workspaces` read the same rules, and the tests read them directly.
 */

import { featureOn } from "../features";
import type { NavPlace, PlaceKey, TabKey } from "./places";

/** What the app bar of a place draws. The search is the palette; «جديد» is the wheel (its own list of actions comes from the server). */
export interface AppBarSlots {
  search: boolean;
  /** «ليل / نهار» (still in the avatar menu's «المظهر» for everybody). */
  theme: boolean;
  /** «؟»: the help of the page (still in «دليل زاكي»). */
  help: boolean;
  bell: boolean;
  create: boolean;
}

const FULL: Readonly<AppBarSlots> = { search: true, theme: true, help: true, bell: true, create: true };

/**
 * The app bar of each place: its name, the search and the actions that make sense THERE. The chat and the library are dense screens: they keep the
 * search, the bell and «جديد» and leave «ليل / نهار» and «؟» to the avatar menu and the guide. «الإدارة» and «نتفرّج سوا» have nothing to create from
 * the bar. A page of no place (the profile) gets the full bar.
 */
export function appBarOf(place: PlaceKey | null): Readonly<AppBarSlots> {
  switch (place) {
    case "chat":
    case "library":
    case "cards":
      return { search: true, theme: false, help: false, bell: true, create: true };
    case "watch":
    case "admin":
      return { search: true, theme: true, help: true, bell: true, create: false };
    default:
      return FULL;
  }
}

/** Is this address one of the chat's (`/chat`, `/chat/<id>`, `/chat/s/<space>`)? */
export function isChatPath(pathname: string | null | undefined): boolean {
  return pathname === "/chat" || (pathname ?? "").startsWith("/chat/");
}

/**
 * The chat on a computer has no global bar and no bottom strip: the list column is the page's own bar (the owner's mock-up: the logo at the top of the
 * rail, the page's title and tools inside the page). What those two carried — the search, «جديد», the bell, the roster of who is online — moves into
 * the rail, so nothing is lost. This says which of the three states the frame is in:
 *
 *  - `full`     nothing changes (not the chat, the new chat screen is off, or the old menu is on: it has no rail to move things to);
 *  - `moved`    the screen is known to be a computer: the bar and the strip are not drawn, the rail holds their tools;
 *  - `pending`  the screen is not known yet (server render, first paint) or is a phone: the bar is drawn but hidden from `md` up by CSS, so a computer never
 *               flashes it, and a phone keeps it. Exactly one copy of each tool is ever mounted (two palettes would both answer Ctrl+K).
 */
export function chatChromeOf(input: { navV2: boolean; chatBare: boolean; pathname: string | null | undefined; desktop: boolean | null }): "full" | "moved" | "pending" {
  if (!input.navV2 || !input.chatBare || !isChatPath(input.pathname)) return "full";
  return input.desktop === true ? "moved" : "pending";
}

/** Is this tab one the place draws — as a tab or under «المزيد»? A page of the place that is neither marks no tab. */
export function tabIsDrawn(place: Pick<NavPlace, "tabs" | "more"> | null | undefined, tab: TabKey | null): boolean {
  if (!place || !tab) return false;
  return place.tabs.some((item) => item.key === tab) || (place.more ?? []).some((item) => item.key === tab);
}

// ───────────────────────────────────────── the visible space (N1.3) ─────────────────────────────────────────

/** A page of ONE thing that lives in another space of the person's: what the banner says. `path` is the page it was asked for, `next` where the button goes. */
export interface ForeignSpace {
  path: string;
  next: string;
  spaceId: string;
  name: string;
  emoji: string | null;
}

/** The banner's thing, only when the answer is for the page on screen (a slow answer of the page before shows nothing). */
export function foreignFor(foreign: ForeignSpace | null | undefined, pathname: string): ForeignSpace | null {
  return foreign && foreign.path === pathname ? foreign : null;
}

/**
 * The banner keeps the answer it had for THIS page: two other readers (the projects toolbar, the ideas form) fetch `/api/workspaces` without an address
 * under the same query key, and their answer would otherwise blank the banner until the shell's next refetch. A fresh answer for the page wins; an answer
 * held for another page is dropped.
 */
export function holdForeign(held: ForeignSpace | null, fresh: ForeignSpace | null, pathname: string): ForeignSpace | null {
  return fresh ?? (held && held.path === pathname ? held : null);
}

export type AddressKind = "task" | "project" | "board" | "card" | "approval" | "call" | "watch" | "topic";

const ADDRESSES: readonly { kind: AddressKind; re: RegExp }[] = [
  { kind: "task", re: /^\/tasks\/([A-Za-z0-9_-]+)$/ },
  { kind: "project", re: /^\/projects\/([A-Za-z0-9_-]+)(?:\/timeline)?$/ },
  { kind: "board", re: /^\/boards\/([A-Za-z0-9_-]+)$/ },
  { kind: "card", re: /^\/cards\/([A-Za-z0-9_-]+)$/ },
  { kind: "approval", re: /^\/approvals\/([A-Za-z0-9_-]+)$/ },
  { kind: "call", re: /^\/calls\/([A-Za-z0-9_-]+)$/ },
  { kind: "watch", re: /^\/watch\/([A-Za-z0-9_-]+)$/ },
  { kind: "topic", re: /^\/chat\/([A-Za-z0-9_-]+)(?:\/whiteboard)?$/ },
];

/**
 * The pages that are ONE thing of ONE space — the very pages that call `keepInSpace` — read from an address (query and hash ignored). `null` for every
 * other page (a list, a place's landing page, an address that is not a path of this site).
 */
export function parseAddress(pathname: string): { kind: AddressKind; id: string } | null {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.startsWith("//") || pathname.length > 300) return null;
  const bare = (pathname.split(/[?#]/, 1)[0] ?? "").replace(/\/+$/, "");
  for (const { kind, re } of ADDRESSES) {
    const id = re.exec(bare)?.[1];
    if (id) return { kind, id };
  }
  return null;
}

/**
 * D-N3: «الشركة» (HQ) keeps no projects, so a person whose spaces are only it — or none — has no work space. `holdsProjects` is what
 * `/api/workspaces` says per space (`false` for HQ).
 */
export function holdsNoWork(spaces: readonly { holdsProjects?: boolean }[]): boolean {
  return !spaces.some((space) => space.holdsProjects !== false);
}

// ───────────────────────────────────────── the phone's chrome (P2.1) ─────────────────────────────────────────

/**
 * P2.1 — the drawer's row «المرشد» (the owner's guide) tells the guide to open its panel with this window event: on a phone the compass does not float over the
 * page, so the drawer is where it lives. The guide (src/components/site-guide/site-guide.tsx) is its own lazy chunk and the drawer cannot import it, so the name is here.
 */
export const GUIDE_OPEN_EVENT = "zaki:guide-open";

// ───────────────────────────────────────── ONE «الإعدادات» door (S3.1) ─────────────────────────────────────────

/**
 * Is «الإعدادات» ONE door for this company? Its own switch `settingsOneDoor` AND the one control panel (`controlPanelV2`): the company group of the settings frame draws the panel's section
 * bodies and the row that opens the panel, so without the panel the switch changes nothing (the owner can only turn it on while the panel is on, `FEATURE_META`; one already on stays harmless
 * if the panel is switched off later). Pure: the layout, the pages and the tests read it from `Organization.settings`.
 */
export function settingsOneDoorOf(orgSettings: unknown): boolean {
  return featureOn(orgSettings, "settingsOneDoor") && featureOn(orgSettings, "controlPanelV2");
}
