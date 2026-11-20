/**
 * The guided tours («فرجيني»). A pure module: it says which elements a tour visits and what it says
 * about each; the browser part (src/components/guide/tour-runner.tsx) draws it with driver.js.
 *
 * A tour finds its elements by a stable hook, the attribute data-tour on the element. The hooks are
 * a contract between the agents that render the elements and this guide (see the Phase 2 briefing):
 *   places       the navigation of places (bottom bar on a phone, side menu on a computer)
 *   tabs         the tab strip of the current place
 *   search       the search / quick-navigation button
 *   inbox        the notification bell
 *   new          the gold «جديد» button of the top bar (src/components/shell/new-wheel.tsx)
 *   avatar       the avatar menu
 *   theme        the theme picker (inside the avatar menu)
 *   today-tasks  the list of today's tasks on the Today page
 *   first-steps  the first-steps card
 *   quick-add    the quick-add button
 *   menu         the phone's ☰ (the new map): the app bar's, or the chat list bar's where the frame's bar is hidden
 *   more-tabs    the tab strip's «المزيد» (the new map)
 *   work-mine    «مهامي», the first tab of «الشغل»
 *   work-requests «الطلبات», the tab of what waits for a decision
 *   work-inbox   «صندوق المهام», the pinned card on the projects page
 * Most hooks are the attribute data-tour on the element. The newer ones are found by a mark another
 * package already draws (HOOK_SELECTORS), so no file of theirs is edited. A hook that is not on the
 * page (a menu that is closed, a place with a single tab, a person who cannot open the place) is
 * skipped, so a tour never points at nothing. The same list serves the old map and the new one
 * (switch navV2): what the map does not draw is simply not there.
 */

export const TOUR_HOOKS = [
  "places",
  "tabs",
  "search",
  "inbox",
  "new",
  "avatar",
  "theme",
  "today-tasks",
  "first-steps",
  "quick-add",
  "menu",
  "more-tabs",
  "work-mine",
  "work-requests",
  "work-inbox",
] as const;
export type TourHook = (typeof TOUR_HOOKS)[number];

export const TOUR_KEYS = ["shell", "today", "work"] as const;
export type TourKey = (typeof TOUR_KEYS)[number];

/** Which map the page draws: the old one (navV2 OFF) or the new one (rail and drawer). */
export type NavMode = "v1" | "v2";

export interface TourStep {
  hook: TourHook;
  titleKey: string;
  bodyKey: string;
  /** The words for the new map, when the old ones would name something that map does not have. */
  v2BodyKey?: string;
  /**
   * Which side of the element the popover prefers. Only top and bottom: the page is right-to-left,
   * and the library falls back to the sides on its own when there is no room (a desktop side menu
   * gets its popover on the content side).
   */
  side?: "top" | "bottom";
}

export const TOURS: Record<TourKey, readonly TourStep[]> = {
  // the app tour: the same shell on every page
  shell: [
    // the phone's ☰ (the new map): it carries the places mark too, and the menu stop is first so the element is told about once
    { hook: "menu", titleKey: "guide.tour.shell.menu.title", bodyKey: "guide.tour.shell.menu.body", side: "bottom" },
    { hook: "places", titleKey: "guide.tour.shell.places.title", bodyKey: "guide.tour.shell.places.body", v2BodyKey: "guide.tour.shell.places.v2.body", side: "top" },
    { hook: "tabs", titleKey: "guide.tour.shell.tabs.title", bodyKey: "guide.tour.shell.tabs.body", v2BodyKey: "guide.tour.shell.tabs.v2.body", side: "bottom" },
    { hook: "more-tabs", titleKey: "guide.tour.shell.more-tabs.title", bodyKey: "guide.tour.shell.more-tabs.body", side: "bottom" },
    { hook: "search", titleKey: "guide.tour.shell.search.title", bodyKey: "guide.tour.shell.search.body", side: "bottom" },
    { hook: "inbox", titleKey: "guide.tour.shell.inbox.title", bodyKey: "guide.tour.shell.inbox.body", side: "bottom" },
    { hook: "new", titleKey: "guide.tour.shell.new.title", bodyKey: "guide.tour.shell.new.body", side: "bottom" },
    { hook: "avatar", titleKey: "guide.tour.shell.avatar.title", bodyKey: "guide.tour.shell.avatar.body", side: "bottom" },
    { hook: "theme", titleKey: "guide.tour.shell.theme.title", bodyKey: "guide.tour.shell.theme.body", side: "bottom" },
  ],
  // the Today page's own elements
  today: [
    { hook: "today-tasks", titleKey: "guide.tour.today.today-tasks.title", bodyKey: "guide.tour.today.today-tasks.body", side: "bottom" },
    { hook: "quick-add", titleKey: "guide.tour.today.quick-add.title", bodyKey: "guide.tour.today.quick-add.body", side: "bottom" },
    { hook: "first-steps", titleKey: "guide.tour.today.first-steps.title", bodyKey: "guide.tour.today.first-steps.body", side: "bottom" },
  ],
  // «الشغل»: the three things a person does there. Each is found by a mark the work pages already draw
  work: [
    { hook: "work-mine", titleKey: "guide.tour.work.work-mine.title", bodyKey: "guide.tour.work.work-mine.body", side: "bottom" },
    { hook: "work-requests", titleKey: "guide.tour.work.work-requests.title", bodyKey: "guide.tour.work.work-requests.body", side: "bottom" },
    { hook: "work-inbox", titleKey: "guide.tour.work.work-inbox.title", bodyKey: "guide.tour.work.work-inbox.body", side: "bottom" },
  ],
};

const ATTRIBUTE = "data-tour";

/** The CSS selector of a hook's own mark: the attribute data-tour. */
export function hookSelector(hook: TourHook): string {
  return `[${ATTRIBUTE}="${hook}"]`;
}

/**
 * Hooks found by a mark another package draws (so their files stay as they are): the ☰ of the app bar and of the chat's list bar, «المزيد», and the
 * «الشغل» stops, found by the address of their tab and by the inbox card's own mark. Every one of these marks is pinned against its source in
 * tests/guide-tours.test.ts.
 */
const HOOK_SELECTORS: Partial<Record<TourHook, readonly string[]>> = {
  menu: ['[data-shell="drawer-open"]', "[data-chat-drawer-open]"],
  "more-tabs": ['[data-shell="more-tabs"]'],
  "work-mine": [`[${ATTRIBUTE}="tabs"] a[href="/my-work"]`],
  "work-requests": [`[${ATTRIBUTE}="tabs"] a[href="/requests"]`],
  "work-inbox": ['[data-work-inbox="pinned"]'],
};

/** Every selector that can point at a hook's element, in the order they are tried. */
export function hookSelectors(hook: TourHook): readonly string[] {
  return HOOK_SELECTORS[hook] ?? [hookSelector(hook)];
}

/** The steps of a tour whose element is on the page, in the tour's order. */
export function planTour(key: TourKey, has: (hook: TourHook) => boolean): TourStep[] {
  return (TOURS[key] ?? []).filter((step) => has(step.hook));
}

/** What the tour library is given for one step: the element, and the words in Arabic. */
export interface PlannedStep<E> {
  element: E;
  popover: { title: string; description: string; side?: "top" | "bottom"; align: "center" };
}

/**
 * The steps ready for the library: each present element paired with its title and body, each
 * missing element left out. `find` is asked once per step, in order (the browser passes a lookup of
 * the visible element; a test passes a fake). `mode` picks the new map's words where a step has them.
 * An element that two hooks point at (the phone's ☰ carries the places mark too) is told about once,
 * by the first step that reaches it.
 */
export function resolveTourSteps<E>(
  key: TourKey,
  t: (key: string) => string,
  find: (hook: TourHook) => E | null,
  mode: NavMode = "v1",
): PlannedStep<E>[] {
  const out: PlannedStep<E>[] = [];
  const visited = new Set<E>();
  for (const step of TOURS[key] ?? []) {
    const element = find(step.hook);
    if (element === null || element === undefined) continue;
    if (visited.has(element)) continue;
    visited.add(element);
    const bodyKey = mode === "v2" && step.v2BodyKey ? step.v2BodyKey : step.bodyKey;
    out.push({
      element,
      // centred, not "start": start means the physical left edge in the library, which is the wrong end in Arabic
      popover: { title: t(step.titleKey), description: t(bodyKey), ...(step.side ? { side: step.side } : {}), align: "center" },
    });
  }
  return out;
}

/** The front pages of «الشغل»: «فرجيني» on one of them opens the «الشغل» tour (the page's help names the app tour; see tourForPath). */
const WORK_PAGES: readonly string[] = ["/my-work", "/projects", "/requests"];

/**
 * The tour «فرجيني» opens on this page. The page's help names a tour (the app tour on every work page); on the front pages of «الشغل» the place's own
 * tour is the more useful one, so the app tour is swapped for it. A tour asked for by name (the today tour, the «الشغل» tour) is never swapped.
 */
export function tourForPath(tour: TourKey, pathname: string): TourKey {
  if (tour !== "shell") return tour;
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return WORK_PAGES.includes(clean) ? "work" : tour;
}

/**
 * The tour that has something to show on this page, or null: the one tourForPath picks when any of its elements is there, else the one that was
 * asked for (a person who cannot open the place has none of its tabs, and gets the app tour instead of a failure).
 */
export function chooseTour(tour: TourKey, pathname: string, has: (hook: TourHook) => boolean): TourKey | null {
  for (const candidate of [tourForPath(tour, pathname), tour]) {
    if (planTour(candidate, has).length > 0) return candidate;
  }
  return null;
}

/** The place a tour is about (null: the frame, which every person has). */
const TOUR_AREAS: Record<TourKey, string | null> = { shell: null, today: "today", work: "work" };

/**
 * The tours to offer a person whose menu holds these places (NavModel.places keys): the tour of an area they cannot open is not offered, so nobody is
 * walked through a place the menu does not show them.
 */
export function toursOffered(placeKeys: readonly string[]): TourKey[] {
  return TOUR_KEYS.filter((key) => {
    const area = TOUR_AREAS[key];
    return area === null || placeKeys.includes(area);
  });
}
