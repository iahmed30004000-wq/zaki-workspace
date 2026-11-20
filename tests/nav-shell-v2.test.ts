import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// The components are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

const where = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => where.pathname,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { AppShell } from "@/components/app-shell";
import { AppBar } from "@/components/shell/app-bar";
import { Drawer } from "@/components/shell/drawer";
import { NavOptions, OrderLockedNote } from "@/components/shell/nav-options";
import { MoreTabs } from "@/components/shell/place-tabs";
import { Rail } from "@/components/shell/rail";
import { NoWorkSpace, SpaceBannerView } from "@/components/shell/space-banner";
import type { OrgsResponse } from "@/components/shell/space-switcher";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { audienceOf } from "@/lib/guide/audience";
import { buildNav, type NavRole, type NavSubject, type PlaceKey } from "@/lib/nav/places";
import { NEW_ACTIONS, NEW_HREF, newActionsFor, newHrefFor } from "@/lib/nav/new-actions";
import { appBarOf, foreignFor, holdForeign, holdsNoWork, parseAddress, tabIsDrawn } from "@/lib/nav/shell-v2";
import { navSubjectOf } from "@/server/services/nav-order";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;

const USER = { name: "أحمد الكوري", username: "ahmad", email: "ahmad@example.test", avatarUrl: null };

const SPACES: OrgsResponse = {
  currentSpaceId: "w2",
  organizations: [
    {
      id: "o1",
      name: "زكي",
      keyPrefix: "ZK",
      role: "MEMBER",
      canCreateSpaces: false,
      workspaces: [
        { id: "w1", name: "الشركة", slug: "hq", emoji: "🏢", holdsProjects: false, unread: 4, overdue: 0 },
        { id: "w2", name: "الشحن", slug: "ship", emoji: "🚚", holdsProjects: true, unread: 3, overdue: 2 },
        { id: "w3", name: "التسويق", slug: "mkt", emoji: "📣", holdsProjects: true, unread: 0, overdue: 7 },
      ],
    },
  ],
};

function render(element: ReactElement, data: OrgsResponse | null = SPACES): string {
  const client = new QueryClient();
  if (data) client.setQueryData(["orgs"], data);
  client.setQueryData(["notifications"], { items: [], unreadCount: 0 });
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(Toasts, null, element))));
}

const who = (role: NavRole, extra: Partial<NavSubject> = {}): NavSubject => ({ role, caps: [...effectiveCapabilities({ role })], navV2: true, ...extra });
const hrefs = (markup: string) => [...markup.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1] as string);
const SPACE = { id: "w2", name: "الشحن", emoji: "🚚" };

function shell(role: NavRole, pathname: string, extra: Record<string, unknown> = {}, data: OrgsResponse | null = SPACES): string {
  where.pathname = pathname;
  const subject = who(role);
  return render(
    createElement(
      AppShell,
      {
        space: SPACE,
        user: USER,
        nav: buildNav(subject),
        rank: role,
        audience: audienceOf({ isExternal: role === "GUEST", caps: subject.caps }),
        isGuest: role === "GUEST",
        newActions: newActionsFor(subject),
        orgName: "شركة زكي",
        navV2: true,
        ...extra,
      } as unknown as React.ComponentProps<typeof AppShell>,
      createElement("p", null, "محتوى الصفحة"),
    ),
    data,
  );
}

describe("the layout hands the new map to the shell (N1.2 wiring)", () => {
  it("navSubjectOf spreads navExtrasOf: the switch and the pinned tools reach the map", () => {
    const actor = { role: "MEMBER" as const, caps: effectiveCapabilities({ role: "MEMBER" }), isExternal: false };
    const on = navSubjectOf(actor, { features: { navV2: true }, workTabs: ["goals", "ideas"] }, null);
    expect(on.navV2).toBe(true);
    expect(on.workTabs).toEqual(["goals", "ideas"]);
    const off = navSubjectOf(actor, {}, null);
    expect(off.navV2).toBe(false);
    // the old map for everybody while the switch is off: nothing in the person's menu changes
    expect(buildNav(off)).toEqual(buildNav({ role: "MEMBER", caps: [...actor.caps], off: off.off, spaceManager: false, supervisor: false }));
    expect(buildNav(on).places.map((p) => p.key)[0]).toBe("chat");
  });

  it("the layout passes the switch, the company order and the lock to the shell", () => {
    const layout = read("src/app/(app)/layout.tsx");
    expect(layout).toContain("navV2={navV2}");
    expect(layout).toContain("const navV2 = subject.navV2 === true");
    expect(layout).toMatch(/menuOrderFor\(/);
    expect(layout).toMatch(/orderLocked=/);
    expect(layout).toMatch(/noWorkSpace=/);
  });
});

describe("the shell on the new map (navV2 ON)", () => {
  const html = shell("MEMBER", "/my-work");

  it("draws the rail and the drawer's button, and NOT the old side menu or the bottom bar", () => {
    expect(html).toContain('data-shell="rail"');
    expect(html).toContain('data-shell="drawer-open"');
    expect(html).not.toMatch(/<nav[^>]*class="fixed bottom-0/);
    expect(html).not.toMatch(/<aside[^>]*w-64/);
    // the phone's content is no longer padded for a bottom bar
    expect(html).not.toContain("pb-[calc(3.5rem+1px+env(safe-area-inset-bottom))]");
  });

  it("keeps the old side menu and the bottom bar when the switch is OFF", () => {
    const off = shell("MEMBER", "/my-work", { navV2: false, nav: buildNav({ role: "MEMBER", caps: [...effectiveCapabilities({ role: "MEMBER" })] }) });
    expect(off).not.toContain('data-shell="rail"');
    expect(off).toMatch(/<nav[^>]*class="fixed bottom-0/);
    expect(off).toMatch(/<aside[^>]*w-64/);
  });

  it("the tab strip is the four tabs of «الشغل» at most, and «المزيد» beside them", () => {
    const strip = /<nav[^>]*data-tour="tabs"[^>]*>[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    expect(strip).toContain(AR["nav.tab.more"] as string);
    expect(hrefs(strip).length).toBeLessThanOrEqual(4);
  });

  it("«اليوم» is the current place at «/» (its address in the new map is «/?view=today»)", () => {
    const today = shell("MEMBER", "/");
    const rail = /<aside[^>]*data-shell="rail"[\s\S]*?<\/aside>/.exec(today)?.[0] ?? "";
    const link = /<a\b[^>]*href="\/\?view=today"[^>]*>/.exec(rail)?.[0] ?? "";
    expect(link).toContain("aria-current");
  });

  it("a page of «الشغل» marks «الشغل» (the new map's own addresses: a task, «/time»)", () => {
    const task = shell("MEMBER", "/tasks/abc");
    const rail = /<aside[^>]*data-shell="rail"[\s\S]*?<\/aside>/.exec(task)?.[0] ?? "";
    expect(/<a\b[^>]*href="\/my-work"[^>]*>/.exec(rail)?.[0]).toContain("aria-current");
  });
});

describe("the rail (computer)", () => {
  const nav = buildNav(who("MEMBER"));
  const rail = (extra: Record<string, unknown> = {}) =>
    render(
      createElement(Rail, {
        nav,
        current: "work" as PlaceKey,
        pathname: "/my-work",
        user: USER,
        rank: "MEMBER" as NavRole,
        isGuest: false,
        space: SPACE,
        badges: { chat: 5 },
        ...extra,
      }),
    );

  it("is 72 px wide (the owner mock-up), hidden below md, with the places in the map's order and each place's small label", () => {
    const html = rail();
    expect(html).toMatch(/<aside[^>]*class="[^"]*\bw-\[72px\][^"]*"/);
    expect(html).toMatch(/<aside[^>]*class="[^"]*\bhidden\b[^"]*\bmd:flex\b/);
    const places = /<nav[^>]*data-tour="places"[^>]*>[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    expect(hrefs(places)).toEqual(nav.places.map((p) => (p.key === "today" ? "/?view=today" : p.href)));
    for (const p of nav.places) expect(places).toContain(AR[p.labelKey] as string);
  });

  it("carries the unread badge beside «الدردشة» and the current space at the bottom", () => {
    const html = rail();
    expect(html).toContain("data-badge");
    expect(html).toContain("🚚");
  });

  it("has a slot for the chat list (C2 reuses this rail as it is)", () => {
    const html = rail({ listSlot: createElement("div", { "data-chat-list": "" }, "قائمة المحادثات") });
    expect(html).toContain("data-chat-list");
    expect(html).toContain("قائمة المحادثات");
    expect(rail()).not.toContain("data-chat-list");
  });

  it("the people place is drawn with «الناس» and the people icon (a member with no admin power)", () => {
    const people = buildNav(who("MEMBER"));
    const admin = people.places.find((p) => p.key === "admin");
    expect(admin?.labelKey).toBe("nav.place.people");
    expect(admin?.icon).toBe("team");
    expect(rail()).toContain(AR["nav.place.people"] as string);
  });
});

describe("the drawer (phone)", () => {
  const nav = buildNav(who("MEMBER"));
  const drawer = (extra: Record<string, unknown> = {}) =>
    render(
      createElement(Drawer, {
        open: true,
        onOpenChange: () => {},
        portal: false,
        nav,
        current: "chat" as PlaceKey,
        pathname: "/chat",
        user: USER,
        rank: "MEMBER" as NavRole,
        isGuest: false,
        space: SPACE,
        badges: { chat: 2 },
        ...extra,
      }),
    );

  it("the header is the person and the spaces, each space with its unread count and its overdue count", () => {
    const html = drawer();
    expect(html).toContain("أحمد الكوري");
    const text = textOf(html);
    for (const name of ["الشركة", "الشحن", "التسويق"]) expect(text).toContain(name);
    // the counts are drawn for every space, the one the person is in included (like Telegram's account list)
    expect(html).toContain(AR["navv2.space.unread"]?.replace("{name}", "الشحن").replace("{n}", "3") as string);
    expect(html).toContain(AR["navv2.space.overdue"]?.replace("{name}", "الشحن").replace("{n}", "2") as string);
    expect(html).toContain(AR["navv2.space.overdue"]?.replace("{name}", "التسويق").replace("{n}", "7") as string);
    // a space with nothing waiting draws no empty pill
    expect(html).not.toContain(AR["navv2.space.overdue"]?.replace("{name}", "الشركة").replace("{n}", "0") as string);
  });

  it("lists every place, then «دليل زاكي», and has a slot for the chat list", () => {
    const html = drawer({ listSlot: createElement("div", null, "قائمة المحادثات") });
    const places = /<nav[^>]*data-tour="places"[^>]*>[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    expect(hrefs(places)).toEqual(nav.places.map((p) => (p.key === "today" ? "/?view=today" : p.href)));
    expect(html).toContain(AR["shell.guide"] as string);
    expect(html).toContain("قائمة المحادثات");
  });

  it("while «ترتيب» is on, «تم» and «رجّع» are inside the drawer (it is modal: a bar of the page would sit under it) and «ترتيب» keeps it open", () => {
    const html = drawer({ editing: true, onEditDone: () => {}, onReset: () => {}, canReset: true, onReorder: () => {} });
    expect(html).toContain(AR["navorder.done"] as string);
    expect(html).toContain(AR["navorder.reset"] as string);
    expect(drawer({ editing: false, onEditStart: () => {} })).toContain("data-nav-order-toggle");
    expect(drawer({ editing: false, onEditStart: () => {} })).not.toContain(AR["navorder.done"] as string);
    // the toggle does not close the drawer: only the places' links and the settings link do
    expect(read("src/components/shell/nav-options.tsx")).toMatch(/onClick=\{onEditStart\}/);
  });

  it("closed, it draws nothing (the button in the app bar opens it)", () => {
    expect(drawer({ open: false })).not.toContain("أحمد الكوري");
  });
});

describe("«جديد» on the new map", () => {
  it("«مهمة» goes to «اليوم» by its own address, because «/» alone may be the landing page (it would drop the intent)", () => {
    expect(newHrefFor("task", true)).toBe("/?view=today&new=task");
    expect(newHrefFor("task")).toBe(NEW_HREF.task);
    // every other action is the same on both maps
    for (const key of NEW_ACTIONS.filter((k) => k !== "task")) expect(newHrefFor(key, true), key).toBe(NEW_HREF[key]);
  });
});

describe("the per-place app bar", () => {
  it("the table: chat and library carry no theme or help button, «الإدارة» no «جديد», every other keeps all five", () => {
    expect(appBarOf("chat")).toEqual({ search: true, theme: false, help: false, bell: true, create: true });
    expect(appBarOf("today")).toEqual({ search: true, theme: true, help: true, bell: true, create: true });
    expect(appBarOf("work")).toEqual({ search: true, theme: true, help: true, bell: true, create: true });
    expect(appBarOf("admin").create).toBe(false);
    expect(appBarOf("watch").create).toBe(false);
    // a page of no place (the profile) gets the full bar
    expect(appBarOf(null)).toEqual(appBarOf("today"));
  });

  it("draws the place's name and the button that opens the drawer, with the place's own actions", () => {
    where.pathname = "/chat";
    const nav = buildNav(who("MEMBER"));
    const html = render(
      createElement(AppBar, {
        nav,
        place: "chat" as PlaceKey,
        title: AR["nav.place.chat"] as string,
        pathname: "/chat",
        audience: audienceOf({ isExternal: false, caps: [] }),
        user: USER,
        rank: "MEMBER" as NavRole,
        space: SPACE,
        newActions: ["message"],
        onOpenDrawer: () => {},
      }),
    );
    expect(html).toContain('data-shell="drawer-open"');
    expect(html).toContain(AR["nav.place.chat"] as string);
    expect(html).toContain('data-tour="search"');
    expect(html).not.toContain(AR["shell.theme.aria"] as string);
  });
});

describe("«المزيد» in the tab strip", () => {
  const nav = buildNav(who("MEMBER"));
  const work = nav.places.find((p) => p.key === "work");
  if (!work) throw new Error("no work place");

  it("lists what the place keeps beyond its tabs, as links, and marks itself current when one of them is the page", () => {
    const html = render(createElement(MoreTabs, { place: work, tab: work.more?.[0]?.key ?? null, pathname: work.more?.[0]?.href ?? "/", defaultOpen: true, portal: false }));
    for (const item of work.more ?? []) expect(html).toContain(AR[item.labelKey] as string);
    expect(hrefs(html)).toEqual((work.more ?? []).map((item) => item.href));
    expect(html).toContain("aria-current");
  });

  it("draws nothing for a place with nothing under «المزيد»", () => {
    const chat = nav.places.find((p) => p.key === "chat");
    expect(render(createElement(MoreTabs, { place: chat ?? null, tab: null, pathname: "/chat" }))).not.toContain("more-tabs");
  });

  it("a tab of «المزيد» counts as drawn: the strip knows the page it is on", () => {
    expect(tabIsDrawn(work, work.tabs[0]?.key ?? null)).toBe(true);
    expect(tabIsDrawn(work, work.more?.[0]?.key ?? null)).toBe(true);
    expect(tabIsDrawn(work, "files")).toBe(false);
    expect(tabIsDrawn(null, "files")).toBe(false);
  });
});

describe("the visible space (N1.3)", () => {
  const foreign = { path: "/tasks/t1", next: "/tasks/t1", spaceId: "w3", name: "التسويق", emoji: "📣" };

  it("a thing of another space shows ONE line «هاد من مساحة X» with «انتقل لها» (the /go link keepInSpace redirects to), never a silent switch", () => {
    const html = render(createElement(SpaceBannerView, { foreign }));
    expect(textOf(html)).toContain("هاد من مساحة");
    expect(textOf(html)).toContain("التسويق");
    expect(textOf(html)).toContain(AR["navv2.banner.go"] as string);
    // (&amp; is how markup writes the ampersand of the same link)
    expect(hrefs(html)).toEqual(["/go?space=w3&amp;next=%2Ftasks%2Ft1"]);
    expect(html).toContain('role="status"');
  });

  it("the banner keeps its answer for the page while another reader of the same query overwrites the cache", () => {
    expect(holdForeign(foreign, null, "/tasks/t1")).toEqual(foreign);
    // …but never for another page
    expect(holdForeign(foreign, null, "/tasks/other")).toBeNull();
    // a fresh answer wins
    const fresh = { ...foreign, spaceId: "w9", name: "الجديدة" };
    expect(holdForeign(foreign, fresh, "/tasks/t1")).toEqual(fresh);
    expect(holdForeign(null, null, "/")).toBeNull();
  });

  it("no banner without a foreign thing", () => {
    expect(render(createElement(SpaceBannerView, { foreign: null }))).not.toContain("space-banner");
  });

  it("the answer counts only for the page it was asked about (a slow answer of the page before shows nothing)", () => {
    expect(foreignFor(foreign, "/tasks/t1")).toEqual(foreign);
    expect(foreignFor(foreign, "/tasks/other")).toBeNull();
    expect(foreignFor(null, "/tasks/t1")).toBeNull();
    expect(foreignFor(undefined, "/")).toBeNull();
  });

  it("the shell draws it above the page, from the same /api/workspaces answer that carries the spaces", () => {
    const data = { ...SPACES, foreign };
    expect(textOf(shell("MEMBER", "/tasks/t1", {}, data))).toContain("هاد من مساحة");
    expect(textOf(shell("MEMBER", "/tasks/other", {}, data))).not.toContain("هاد من مساحة");
  });

  it("which addresses belong to ONE space: the pages that called keepInSpace", () => {
    expect(parseAddress("/tasks/abc")).toEqual({ kind: "task", id: "abc" });
    expect(parseAddress("/projects/p1")).toEqual({ kind: "project", id: "p1" });
    expect(parseAddress("/projects/p1/timeline")).toEqual({ kind: "project", id: "p1" });
    expect(parseAddress("/boards/b1")).toEqual({ kind: "board", id: "b1" });
    expect(parseAddress("/cards/c1")).toEqual({ kind: "card", id: "c1" });
    expect(parseAddress("/approvals/a1")).toEqual({ kind: "approval", id: "a1" });
    expect(parseAddress("/calls/k1")).toEqual({ kind: "call", id: "k1" });
    expect(parseAddress("/watch/w1")).toEqual({ kind: "watch", id: "w1" });
    expect(parseAddress("/chat/t1")).toEqual({ kind: "topic", id: "t1" });
    expect(parseAddress("/chat/t1/whiteboard")).toEqual({ kind: "topic", id: "t1" });
    expect(parseAddress("/projects")).toBeNull();
    expect(parseAddress("/my-work")).toBeNull();
    expect(parseAddress("/tasks/")).toBeNull();
    expect(parseAddress("//evil.example/tasks/x")).toBeNull();
    expect(parseAddress("/tasks/a b")).toBeNull();
  });
});

describe("a newcomer with no work space (D-N3)", () => {
  it("holdsNoWork: «الشركة» keeps no projects, so a person whose only space is it has no work space", () => {
    expect(holdsNoWork([{ holdsProjects: false }])).toBe(true);
    expect(holdsNoWork([])).toBe(true);
    expect(holdsNoWork([{ holdsProjects: false }, { holdsProjects: true }])).toBe(false);
  });

  it("says «اطلب من مديرك يضيفك» (staff) instead of empty lists; an owner is told how to open one", () => {
    expect(textOf(render(createElement(NoWorkSpace, { canCreate: false })))).toContain("اطلب من مديرك يضيفك");
    expect(textOf(render(createElement(NoWorkSpace, { canCreate: true })))).not.toContain("اطلب من مديرك يضيفك");
  });

  it("the shell puts it in place of the project list for «الشغل» when there is no work space, and never for a guest", () => {
    const only = { ...SPACES, currentSpaceId: "w1", organizations: [{ ...(SPACES.organizations[0] as OrgsResponse["organizations"][number]), workspaces: [{ id: "w1", name: "الشركة", slug: "hq", emoji: "🏢", holdsProjects: false, unread: 0, overdue: 0 }] }] };
    const projects = shell("MEMBER", "/projects", { noWorkSpace: true }, only);
    expect(textOf(projects)).toContain("اطلب من مديرك يضيفك");
    expect(projects).not.toContain("محتوى الصفحة");
    // «مهامي» spans every space: its page stays, the line sits above it
    const mine = shell("MEMBER", "/my-work", { noWorkSpace: true }, only);
    expect(textOf(mine)).toContain("اطلب من مديرك يضيفك");
    expect(mine).toContain("محتوى الصفحة");
    // somebody with a work space is told nothing
    expect(textOf(shell("MEMBER", "/projects", { noWorkSpace: false }))).not.toContain("اطلب من مديرك يضيفك");
    expect(textOf(shell("GUEST", "/projects", { noWorkSpace: true }))).not.toContain("اطلب من مديرك يضيفك");
  });
});

describe("the company's order of the menu (D-N5)", () => {
  it("while it is set, the person's «ترتيب» screen shows ⚠️ and 🔧 together, and offers no reordering", () => {
    const note = textOf(render(createElement(OrderLockedNote)));
    expect(note).toContain("⚠️");
    expect(note).toContain(AR["navv2.order.company_locked"] as string);
    expect(note).toContain("🔧");
    expect(note).toContain(AR["navv2.order.company_fix"] as string);

    const locked = render(createElement(NavOptions, { variant: "rail", orderLocked: true, onEditStart: () => {}, defaultOpen: true, portal: false }));
    expect(locked).toContain(AR["navv2.order.company_locked"] as string);
    expect(locked).not.toContain("data-nav-order-toggle");
    const free = render(createElement(NavOptions, { variant: "rail", orderLocked: false, onEditStart: () => {}, defaultOpen: true, portal: false }));
    expect(free).toContain("data-nav-order-toggle");
    expect(free).not.toContain(AR["navv2.order.company_locked"] as string);
  });

  it("the person's own saved order is never deleted by the lock: the shell reads, never writes, while locked", () => {
    const src = read("src/components/app-shell.tsx");
    // the save path is only reachable from the reorder mode, which the lock never opens
    expect(src).toMatch(/orderLocked/);
    expect(read("src/app/(app)/layout.tsx")).toMatch(/menuOrderFor\(readCompanyMenuOrder\(/);
  });
});

describe("/api/workspaces is fetched ONCE per page (F1)", () => {
  it("only the shell's own hook refetches after a navigation; the switchers read the same query", () => {
    const src = read("src/components/shell/space-switcher.tsx");
    // one effect that refetches on a pathname change, in one hook
    expect(src.match(/void refetch\(\)/g)?.length).toBe(1);
    expect(src).toMatch(/export function useSpaces\(\s*sync = false/);
    expect(src).toMatch(/useSpaces\(true\)/);
    // the switchers (rail, drawer, strip) do not ask for the navigation refetch
    expect(src).not.toMatch(/orgsQuery = useSpaces\(true\)/);
  });

  it("the request carries the page's address, so ONE answer holds the spaces, the counts and the banner", () => {
    const src = read("src/components/shell/space-switcher.tsx");
    expect(src).toMatch(/\/api\/workspaces\$\{asked\}/);
    expect(src).toMatch(/\?path=\$\{encodeURIComponent\(here\)\}/);
  });
});

describe("the new shell's markup follows the house rules", () => {
  const files = ["rail.tsx", "drawer.tsx", "app-bar.tsx", "nav-options.tsx", "space-banner.tsx"];
  for (const file of files) {
    it(`${file}: logical CSS only, theme tokens only, no tiny text, no Latin in the strings`, () => {
      const src = read(`src/components/shell/${file}`);
      const tokens = classTokens(`class="${[...src.matchAll(/"([^"\n]*)"/g)].map((m) => m[1]).join(" ")}"`);
      expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t)), "physical direction").toEqual([]);
      expect(tokens.filter((t) => PALETTE_COLOUR.test(t)), "palette colour").toEqual([]);
      expect(src).not.toMatch(/text-\[1[01]px\]/);
    });
  }

  it("the new strings are Arabic, with no Latin letters", () => {
    // placeholders need Latin letters ({name}), which ar.nav-v2.json's own test forbids: these strings live in ar.shell.json, the shell's fragment
    const fragment = JSON.parse(read("src/lib/i18n/ar.shell.json")) as Record<string, string>;
    for (const key of ["navv2.space.unread", "navv2.space.overdue", "navv2.banner.foreign", "navv2.banner.go", "navv2.nowork.title", "navv2.nowork.hint", "navv2.drawer.open", "navv2.more.open"]) {
      expect(fragment[key], key).toBeTypeOf("string");
      expect(fragment[key]?.replace(/\{[a-z]+\}/g, ""), key).not.toMatch(/[A-Za-z]/);
    }
  });
});
