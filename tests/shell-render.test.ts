import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { beforeAll, describe, expect, it, vi } from "vitest";
import config from "../tailwind.config";

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
import { AvatarMenu } from "@/components/shell/avatar-menu";
import { Sidebar } from "@/components/shell/sidebar";
import { SpaceSwitcher, type OrgsResponse } from "@/components/shell/space-switcher";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { audienceOf } from "@/lib/guide/audience";
import { buildNav, type NavRole, type NavSubject } from "@/lib/nav/places";
import { newActionsFor } from "@/lib/nav/new-actions";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import type { CurrentUser } from "@/server/auth";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, textOf } from "./ui-render";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;

const USER: CurrentUser = {
  id: "u1",
  email: "ahmad@example.test",
  username: "ahmad",
  name: "أحمد الكوري",
  locale: "ar",
  mustChangePassword: false,
  transparencyPending: false,
  tv: 0,
};

const orgs = (canCreateSpaces: boolean): OrgsResponse => ({
  organizations: [
    {
      id: "o1",
      name: "زكي",
      keyPrefix: "ZK",
      role: canCreateSpaces ? "MEMBER" : "GUEST",
      canCreateSpaces,
      workspaces: [
        { id: "w1", name: "المقر", slug: "hq", emoji: "🏢", unread: 0 },
        { id: "w2", name: "الشحن", slug: "ship", emoji: "🚚", unread: 3 },
      ],
    },
  ],
});

const who = (role: NavRole): NavSubject => ({ role, caps: [...effectiveCapabilities({ role })] });

function render(element: ReactElement, canCreateSpaces = true): string {
  const client = new QueryClient();
  client.setQueryData(["orgs"], orgs(canCreateSpaces));
  client.setQueryData(["notifications"], { items: [], unreadCount: 0 });
  return renderToStaticMarkup(
    createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(Toasts, null, element))),
  );
}

function shell(role: NavRole, pathname: string, space: { id: string; name: string; emoji: string | null } | null = null): string {
  where.pathname = pathname;
  const subject = who(role);
  return render(
    createElement(AppShell, {
      space,
      user: USER,
      nav: buildNav(subject),
      rank: role,
      audience: audienceOf({ isExternal: role === "GUEST", caps: subject.caps }),
      isGuest: role === "GUEST",
      newActions: newActionsFor(subject),
      orgName: "شركة زكي",
      children: createElement("p", null, "محتوى الصفحة"),
    }),
    role !== "GUEST",
  );
}

/** The outer markup of the first element whose opening tag matches `open` (same-name nesting is counted). */
function outerOf(markup: string, open: RegExp, tag: string): string {
  const m = open.exec(markup);
  if (!m) throw new Error(`no ${open} in: ${markup.slice(0, 300)}`);
  const start = m.index;
  const re = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  re.lastIndex = start + 1;
  let depth = 1;
  for (let hit = re.exec(markup); hit; hit = re.exec(markup)) {
    depth += hit[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return markup.slice(start, hit.index + hit[0].length);
  }
  throw new Error(`unclosed <${tag}>`);
}

const bottomBar = (html: string) => outerOf(html, /<nav[^>]*class="fixed bottom-0[^"]*"[^>]*>/, "nav");
const sidebar = (html: string) => outerOf(html, /<aside\b[^>]*>/, "aside");
const sidebarPlaces = (html: string) => outerOf(sidebar(html), /<nav[^>]*data-tour="places"[^>]*>/, "nav");
const tabStrip = (html: string) => outerOf(html, /<nav[^>]*data-tour="tabs"[^>]*>/, "nav");
const hrefs = (markup: string) => [...markup.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1] as string);
const count = (markup: string, needle: string) => markup.split(needle).length - 1;
/** The opening tag of the link to `href`. */
const linkTo = (markup: string, href: string) => new RegExp(`<a\\b[^>]*href="${href.replace(/[?]/g, "\\?")}"[^>]*>`).exec(markup)?.[0] ?? "";

describe("the frame for the owner, on a project page", () => {
  const html = shell("OWNER", "/projects");

  it("the bottom bar (phone) holds the six places, in order, each linking to its landing page", () => {
    const bar = bottomBar(html);
    expect(hrefs(bar)).toEqual(["/", "/chat", "/my-work", "/files", "/watch", "/members"]);
    for (const key of ["nav.place.today", "nav.place.chat", "nav.place.work", "nav.place.library", "nav.place.watch", "nav.place.admin"]) expect(bar, key).toContain(AR[key] as string);
  });

  it("the side menu (computer) holds the same six places", () => {
    expect(hrefs(sidebarPlaces(html))).toEqual(["/", "/chat", "/my-work", "/files", "/watch", "/members"]);
  });

  it("both are in the page and CSS shows one: the bottom bar below md, the side menu from md", () => {
    const bar = /<nav[^>]*class="(fixed bottom-0[^"]*)"/.exec(html)?.[1]?.split(" ") ?? [];
    expect(bar).toContain("md:hidden");
    const aside = /<aside[^>]*class="([^"]*)"/.exec(html)?.[1]?.split(" ") ?? [];
    expect(aside).toEqual(expect.arrayContaining(["hidden", "md:flex"]));
  });

  it("marks «الشغل» as the current place (inside it, not its landing page) in both", () => {
    for (const nav of [bottomBar(html), sidebarPlaces(html)]) {
      expect(linkTo(nav, "/my-work")).toContain('aria-current="true"');
      expect(count(nav, "aria-current=")).toBe(1);
    }
  });

  it("shows «الشغل»'s twelve tabs above the page, «المشاريع» as the current page", () => {
    const strip = tabStrip(html);
    expect(hrefs(strip)).toEqual(["/my-work", "/projects", "/list", "/calendar", "/goals", "/ideas", "/production", "/departments", "/tickets", "/campaigns", "/crm", "/approvals", "/checkins"]);
    expect(linkTo(strip, "/projects")).toContain('aria-current="page"');
    expect(strip).toContain(`aria-label="${AR["shell.tabs"]?.replace("{place}", AR["nav.place.work"] as string)}"`);
  });

  it("carries every tour hook of the contract: places twice (bar and menu), tabs, search, inbox, avatar twice", () => {
    expect(count(html, 'data-tour="places"')).toBe(2);
    expect(count(html, 'data-tour="tabs"')).toBe(1);
    expect(count(html, 'data-tour="search"')).toBe(1);
    expect(count(html, 'data-tour="inbox"')).toBe(1);
    expect(count(html, 'data-tour="new"')).toBe(1); // «جديد», the shell tour's stop since «نجمة وطريق»
    expect(count(html, 'data-tour="avatar"')).toBe(2);
    // the search hook is around the palette's button
    expect(outerOf(html, /<div[^>]*data-tour="search"[^>]*>/, "div")).toContain(`aria-label="${AR["pal.open"]}"`);
  });

  it("the side menu's 88px header carries the theme's ornament (the sidebar place), never the list of places", () => {
    const aside = sidebar(html);
    expect(aside).toContain("zk-decor zk-decor-sidebar");
    expect(aside).toMatch(/class="relative isolate flex h-\[88px\][^"]*overflow-hidden/);
    expect(sidebarPlaces(html)).not.toContain("zk-decor");
  });

  it("«نجمة وطريق»: the wordmark in Lalezar (the space's name, «زاكي» before one is known), the company's name under it, a link home", () => {
    const aside = sidebar(html);
    expect(aside).toMatch(/<span aria-hidden="true" class="zk-wordmark[^"]*"><bdi>زاكي<\/bdi><\/span>/);
    expect(aside).toContain("<bdi>شركة زكي</bdi>");
    expect(linkTo(aside, "/")).toContain(`aria-label="${AR["app.brand"]}"`);
    expect(aside.split(">")[0]).toContain("zk-side-rule");
  });

  it("the side menu's header wears the «Z» mark beside the lettering (the owner's screenshot, 2026-10-30: «اللوجو مش موجود»)", () => {
    const aside = sidebar(html);
    expect(aside).toContain("data-brand-mark");
    expect(aside).toMatch(/data-brand-mark[^>]*aria-hidden="true"[^>]*><svg[^>]*viewBox="0 0 100 100"/);
    // the mark sits inside the link home, before the lettering
    const open = linkTo(aside, "/");
    const link = aside.slice(aside.indexOf(open), aside.indexOf("</a>", aside.indexOf(open)));
    expect(link.indexOf("data-brand-mark")).toBeGreaterThan(-1);
    expect(link.indexOf("data-brand-mark")).toBeLessThan(link.indexOf("zk-wordmark"));
  });

  it("the space you are in is written where «زاكي» was, in the same lettering (the owner's ask, 2026-10-25)", () => {
    const aside = sidebar(shell("OWNER", "/my-work", { id: "w1", name: "العمل", emoji: "🛠️" }));
    expect(aside).toMatch(/<span aria-hidden="true" class="zk-wordmark[^"]*"><bdi>العمل<\/bdi><\/span>/);
    expect(aside).not.toMatch(/class="zk-wordmark[^"]*"><bdi>زاكي/);
    expect(linkTo(aside, "/")).toContain('aria-label="العمل"');
    // a long name steps down a size so it fits
    const long = sidebar(shell("OWNER", "/my-work", { id: "w2", name: "مصاريف المكتب الرئيسي", emoji: null }));
    expect(/class="zk-wordmark([^"]*)"/.exec(long)?.[1]?.split(" ")).toContain("text-2xl");
  });

  it("the current place is washed in gold and marked with a star; the others are not", () => {
    const current = outerOf(sidebarPlaces(html), /<a\b[^>]*href="\/my-work"[^>]*>/, "a");
    expect(current).toMatch(/class="[^"]*\bbg-accent-2\/10\b/);
    expect(current).toMatch(/<span aria-hidden="true" class="zk-star[^"]*text-accent-2/);
    expect(count(sidebarPlaces(html), "zk-star")).toBe(1);
  });

  it("«دليل زاكي» waits at the bottom of the side menu", () => {
    expect(linkTo(sidebar(html), "/guide")).toMatch(/border-dashed border-accent-2/);
    expect(sidebar(html)).toContain(AR["shell.guide"]);
  });

  it("a short window: the list of places scrolls in the middle and the guide / install / fold / profile block stays pinned below it", () => {
    const aside = sidebar(html);
    // the menu is as tall as the window, so only the middle gives way
    expect(aside).toMatch(/^<aside[^>]*class="[^"]*\bh-full\b[^"]*\bmin-h-0\b/);
    const places = sidebarPlaces(html);
    expect(places).toMatch(/^<nav[^>]*class="[^"]*\bmin-h-0\b[^"]*\bflex-1\b[^"]*\boverflow-y-auto\b/);
    const footer = outerOf(aside, /<div[^>]*data-sidebar="footer"[^>]*>/, "div");
    expect(footer).toMatch(/^<div[^>]*class="[^"]*\bshrink-0\b/);
    // the block holds the guide, the install and fold buttons and the person; the list holds none of them
    expect(hrefs(footer)).toContain("/guide");
    expect(footer).toContain(AR["shell.sidebar.collapse"] as string);
    expect(footer).toContain(AR["shell.avatar.open"]?.replace("{name}", USER.name) as string);
    expect(places).not.toContain("/guide");
    expect(places).not.toContain(AR["shell.sidebar.collapse"] as string);
    // and it comes AFTER the list in the page, never inside it, and nothing between them can take its room
    expect(aside.indexOf(places)).toBeGreaterThanOrEqual(0);
    expect(aside.indexOf(footer)).toBeGreaterThan(aside.indexOf(places) + places.length - 1);
    // «الإدارة» is the last place of that list, after «نتفرّج سوا»
    expect(hrefs(places).slice(-2)).toEqual(["/watch", "/members"]);
    // a window shorter than 760px takes tighter rows, so the six places fit before any scrolling
    const source = readFileSync(path.resolve(__dirname, "../src/components/shell/sidebar.tsx"), "utf8");
    expect(source).toContain("[@media(max-height:760px)]:h-9");
  });

  it("the top bar names the place but never as a heading: the page's own h1 is the only one", () => {
    const header = outerOf(html, /<header\b[^>]*>/, "header");
    expect(header).toMatch(/<p class="hidden[^"]*md:block[^"]*">الشغل<\/p>/);
    expect(html).not.toMatch(/<h1\b/);
  });

  it("offers the spaces and «+» in the side menu, and the spaces at the end of «الشغل»'s strip for the phone", () => {
    const aside = sidebar(html);
    expect(aside).toContain(AR["shell.spaces.mine"]);
    expect(aside).toContain(`aria-label="${AR["ws.new"]}"`);
    expect(tabStrip(html)).toContain(`aria-label="${AR["shell.spaces.open"]}"`);
  });

  it("has the «؟» help, the search «وين بدك تروح؟», the bell, «ليل / نهار», «جديد» and the avatar in the top bar (not the old light/dark toggle)", () => {
    const header = outerOf(html, /<header\b[^>]*>/, "header");
    expect(header).toContain(`aria-label="${AR["guide.help.open"]}"`);
    expect(AR["pal.open"]).toBe("وين بدك تروح؟");
    expect(header).toContain(`aria-label="${AR["pal.open"]}"`);
    expect(header).toContain(`aria-label="${AR["notif.title"]}"`);
    expect(header).toContain(`aria-label="${AR["shell.avatar.open"]?.replace("{name}", USER.name)}"`);
    expect(header).toContain(`role="group" aria-label="${AR["shell.theme.aria"]}"`);
    expect(header).toContain(`aria-label="${AR["shell.new.open"]}"`);
    expect(html).not.toContain(`aria-label="${AR["top.theme"]}"`);
  });

  it("«ليل / نهار» is on a phone too (no hidden wrapper), and «جديد» is gold with the scrim's text", () => {
    const header = outerOf(html, /<header\b[^>]*>/, "header");
    const group = /<div[^>]*role="group" aria-label="[^"]*"[^>]*>/.exec(header)?.[0] ?? "";
    expect(group).not.toMatch(/\bhidden\b/);
    expect(header).not.toMatch(/<div class="hidden sm:block"><div[^>]*role="group"/);
    const opener = /<button[^>]*aria-label="جديد"[^>]*>/.exec(header)?.[0] ?? "";
    expect(opener).toMatch(/\bbg-accent-2\b/);
    expect(opener).toMatch(/\btext-scrim\b/);
    expect(opener).toContain('aria-haspopup="dialog"');
  });

  it("respects the notch and the home indicator: the top bar, the bottom bar, and the room left for the bar", () => {
    expect(html).toMatch(/<header[^>]*class="[^"]*pt-\[env\(safe-area-inset-top\)\]/);
    expect(bottomBar(html)).toMatch(/^<nav[^>]*pb-\[env\(safe-area-inset-bottom\)\]/);
    expect(html).toContain("pb-[calc(3.5rem+1px+env(safe-area-inset-bottom))] md:pb-0");
    for (const [tag] of bottomBar(html).matchAll(/<a\b[^>]*>/g)) expect(tag).toMatch(/\bh-14\b/);
  });

  it("has a way to skip to the content, and the content is the page's", () => {
    expect(html).toMatch(/<a href="#zk-main"[^>]*>انتقل إلى المحتوى<\/a>/);
    expect(html).toMatch(/<main id="zk-main"[^>]*>.*محتوى الصفحة/s);
  });

  it("gives every «Z» mark its own gradient id (the phone bar draws one; the side menu wears the wordmark now)", () => {
    const ids = [...html.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ids).size).toBe(ids.length);
    for (const [, ref] of html.matchAll(/url\(#([^)]+)\)/g)) expect(ids, ref).toContain(ref);
  });
});

describe("the frame for a plain member", () => {
  it("calls the admin place «الإدارة» (the team and «لوحتي», on by rank: two tabs) and shows the tab strip for it", () => {
    const html = shell("MEMBER", "/members");
    const bar = bottomBar(html);
    expect(hrefs(bar)).toEqual(["/", "/chat", "/my-work", "/files", "/watch", "/members"]);
    expect(bar).toContain(AR["nav.place.admin"]);
    expect(linkTo(bar, "/members")).toContain('aria-current="page"');
    expect(html).toContain('data-tour="tabs"');
    expect(tabStrip(html)).toContain(AR["nav.tab.boardSelf"]);
  });

  it("on Today: Today is the current page and there is no tab strip", () => {
    const html = shell("MEMBER", "/");
    expect(linkTo(bottomBar(html), "/")).toContain('aria-current="page"');
    expect(html).not.toContain('data-tour="tabs"');
  });

  it("on a task: «الشغل» is current, its tabs show, none of them is the page", () => {
    const html = shell("MEMBER", "/tasks/abc");
    expect(linkTo(bottomBar(html), "/my-work")).toContain('aria-current="true"');
    expect(tabStrip(html)).not.toContain("aria-current");
  });

  it("on the profile, or on a page they are not offered (the settings), nothing of the strip and no wrong mark", () => {
    const profile = shell("MEMBER", "/profile");
    expect(bottomBar(profile)).not.toContain("aria-current");
    expect(profile).not.toContain('data-tour="tabs"');
    const settings = shell("MEMBER", "/settings");
    expect(linkTo(bottomBar(settings), "/members")).toContain('aria-current="true"');
  });

  it("the library has two tabs now (الملفات and المستندات), so it shows its strip", () => {
    const html = shell("MEMBER", "/files");
    expect(html).toContain('data-tour="tabs"');
    expect(hrefs(tabStrip(html))).toEqual(["/files", "/documents"]);
  });
});

describe("the frame for an external partner (guest)", () => {
  const html = shell("GUEST", "/my-work");

  it("Today, Chat, Work and the library (its documents tab alone) are visible to a guest; company-only areas stay hidden", () => {
    // the library opens on «المستندات» for a partner: the files tab is for staff
    expect(hrefs(bottomBar(html))).toEqual(["/", "/chat", "/my-work", "/documents"]);
    expect(hrefs(sidebarPlaces(html))).toEqual(["/", "/chat", "/my-work", "/documents"]);
    for (const href of ["/files", "/members", "/crm", "/departments", "/production", "/settings", "/analytics", "/goals", "/ideas"]) {
      expect(hrefs(html), href).not.toContain(href);
    }
  });

  // goals and ideas are the team's own (WP-ACCESS, docs/PHASE0-AUDIT.md R10): a guest is offered only the four
  // tabs about their own work, مهامي · المشاريع · القائمة · التقويم
  it("four work tabs (no goals, no ideas), «مهامي» current", () => {
    const strip = tabStrip(html);
    expect(hrefs(strip)).toEqual(["/my-work", "/projects", "/list", "/calendar"]);
    expect(linkTo(strip, "/my-work")).toContain('aria-current="page"');
  });

  it("is offered no «جديد» at all (an external partner starts nothing company-wide)", () => {
    expect(html).not.toContain(`aria-label="${AR["shell.new.open"]}"`);
  });

  it("is never offered to open a space", () => {
    expect(html).not.toContain(`aria-label="${AR["ws.new"]}"`);
    const menu = render(createElement(SpaceSwitcher, { variant: "sidebar", isGuest: true, defaultOpen: true, portal: false }), false);
    expect(menu).not.toContain(AR["ws.new"]);
    expect(menu).toContain("المقر");
  });

  it("still has every tour hook that applies", () => {
    for (const hook of ["places", "tabs", "search", "inbox", "avatar"]) expect(html, hook).toContain(`data-tour="${hook}"`);
  });
});

const rail = (collapsed: boolean, role: NavRole = "OWNER") =>
  render(
    createElement(Sidebar, {
      nav: buildNav(who(role)),
      current: "work",
      pathname: "/projects",
      user: USER,
      rank: role,
      isGuest: role === "GUEST",
      collapsed,
      onToggle: () => {},
    }),
  );

describe("the side menu folded to an icon rail", () => {
  const html = rail(true);

  it("is 72px wide; the places keep their names for a screen reader and as a tooltip", () => {
    expect(/<aside[^>]*class="([^"]*)"/.exec(html)?.[1]?.split(" ")).toContain("w-[72px]");
    const places = outerOf(html, /<nav[^>]*data-tour="places"[^>]*>/, "nav");
    for (const key of ["nav.place.today", "nav.place.work", "nav.place.admin"]) {
      expect(places, key).toContain(`title="${AR[key]}"`);
      expect(places, key).toMatch(new RegExp(`<span class="[^"]*sr-only[^"]*">${AR[key]}</span>`));
    }
  });

  it("the mark is still a named link home, the toggle says it unfolds, the spaces are one icon button", () => {
    expect(linkTo(html, "/")).toContain(`aria-label="${AR["app.brand"]}"`);
    expect(html).toContain(`aria-label="${AR["shell.sidebar.expand"]}"`);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(`aria-label="${AR["shell.spaces.open"]}"`);
    expect(html).not.toContain(`aria-label="${AR["ws.new"]}"`); // «+» lives in the menu when folded
  });

  it("unfolded: 256px, the toggle says it folds", () => {
    const open = rail(false);
    expect(/<aside[^>]*class="([^"]*)"/.exec(open)?.[1]?.split(" ")).toContain("w-64");
    expect(open).toContain(`aria-label="${AR["shell.sidebar.collapse"]}"`);
    expect(open).toContain('aria-expanded="true"');
  });
});

describe("the avatar menu", () => {
  const open = (user: Partial<CurrentUser> = {}, rank: NavRole = "OWNER") =>
    render(createElement(AvatarMenu, { user: { ...USER, ...user }, rank, defaultOpen: true, portal: false }));

  it("says who is signed in: the name, @username and the rank in Arabic", () => {
    const html = open();
    expect(html).toContain("أحمد الكوري");
    expect(html).toContain("@ahmad");
    expect(html).toContain(AR["role.owner"]);
    expect(open({}, "LEAD")).toContain(AR["role.lead"]);
    expect(open({}, "GUEST")).toContain(AR["role.guest"]);
  });

  it("shows the e-mail when there is no username", () => {
    const html = open({ username: null });
    expect(html).toContain("ahmad@example.test");
    expect(html).not.toContain("@ahmad<");
  });

  it("offers exactly: the theme, the guide, the account, and signing out (no placeholder for what does not exist yet)", () => {
    const html = open();
    const items = [...html.matchAll(/<(?:div|a)\b[^>]*role="menuitem"[^>]*>(.*?)<\/(?:div|a)>/gs)].map((m) => textOf(m[1] as string));
    expect(items).toEqual([AR["theme.picker"], AR["guide.title"], AR["shell.avatar.account"], AR["shell.avatar.logout"]]);
    expect(linkTo(html, "/guide")).toContain('role="menuitem"');
    expect(linkTo(html, "/profile")).toContain('role="menuitem"');
    expect(html).toContain("text-danger");
  });

  it("the trigger is the guide's «avatar» stop, named with the person", () => {
    const html = open();
    expect(html).toMatch(/<button[^>]*data-tour="avatar"[^>]*aria-label="حسابك: أحمد الكوري"/);
  });
});

describe("the space switcher", () => {
  it("wears the name of the space you are in, and lists every space as a way INTO it (its «اليوم»), with what waits there", () => {
    const html = render(createElement(SpaceSwitcher, { variant: "sidebar", current: { id: "w1", name: "المقر", emoji: "🏢" }, defaultOpen: true, portal: false }));
    // the button says where you are, not «مساحات العمل»
    expect(html).toMatch(/<button[^>]*>.*<bdi>المقر<\/bdi>.*<\/button>/s);
    expect(html).not.toContain(`<bdi>${AR["top.workspaces"]}</bdi>`);
    // folded to an icon, the button still says it
    const rail = render(createElement(SpaceSwitcher, { variant: "rail", current: { id: "w1", name: "المقر", emoji: "🏢" } }));
    expect(rail).toMatch(/<button[^>]*aria-label="أنت في المقر — بدّل المساحة"/);
    // each space is entered through /go; the current one is marked, the other says what waits there
    expect(linkTo(html, "/go\?space=w1")).toContain('aria-current="true"');
    expect(linkTo(html, "/go\?space=w2")).toContain('aria-label="الشحن: 3 بانتظارك"');
    expect(html).not.toContain("/projects?workspace=");
    expect(html).toContain(AR["ws.new"]);
    // «كل المساحات» is the owner's and the admins' only
    expect(html).not.toContain(AR["shell.spaces.all"]);
    const forOwner = render(createElement(SpaceSwitcher, { variant: "sidebar", canOverview: true, defaultOpen: true, portal: false }));
    expect(linkTo(forOwner, "/spaces")).toContain('role="menuitem"');
  });

  it("without the right to open a space: the list, no «new space»", () => {
    const html = render(createElement(SpaceSwitcher, { variant: "strip", defaultOpen: true, portal: false }), false);
    expect(html).toContain("الشحن");
    expect(html).not.toContain(AR["ws.new"]);
  });
});

const ALL = (): Record<string, string> => ({
  owner: shell("OWNER", "/projects"),
  ownerSettings: shell("OWNER", "/settings"),
  member: shell("MEMBER", "/members"),
  memberToday: shell("MEMBER", "/"),
  guest: shell("GUEST", "/my-work"),
  avatar: render(createElement(AvatarMenu, { user: USER, rank: "ADMIN", defaultOpen: true, portal: false })),
  avatarSidebar: render(createElement(AvatarMenu, { user: USER, rank: "ADMIN", variant: "sidebar" })),
  avatarRail: render(createElement(AvatarMenu, { user: USER, rank: "ADMIN", variant: "rail" })),
  switcher: render(createElement(SpaceSwitcher, { variant: "sidebar", defaultOpen: true, portal: false })),
  switcherRail: render(createElement(SpaceSwitcher, { variant: "rail" })),
  rail: rail(true),
  railGuest: rail(true, "GUEST"),
});

describe("every frame follows the rules of the interface", () => {
  const all = ALL();
  const markups = Object.entries(all);

  it("no English word on screen or in an accessible name (the product name, the key names and the person's own @username / e-mail excepted)", () => {
    for (const [name, html] of markups) {
      const spoken = [...html.matchAll(/(?:aria-label|title|placeholder)="([^"]*)"/g)].map((m) => m[1] as string);
      for (const text of [textOf(html), ...spoken]) {
        const interfaceText = text.replace(USER.email as string, "").replace(`@${USER.username}`, "").replace(/Zaki Workspace|Ctrl|Esc/g, "");
        expect(interfaceText, name).not.toMatch(/[A-Za-z]{2,}/);
      }
    }
  });

  it("theme tokens only (no palette colour, black or white) and logical CSS only", () => {
    for (const [name, html] of markups) {
      const tokens = classTokens(html);
      expect(tokens.filter((c) => PALETTE_COLOUR.test(c)), name).toEqual([]);
      expect(tokens.filter((c) => PHYSICAL_UTILITY.test(c.split(":").pop() as string)), name).toEqual([]);
      expect(html, name).not.toMatch(/style="[^"]*(?:#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()/);
    }
  });

  it("every button and every link has an Arabic name", () => {
    let checked = 0;
    for (const [name, html] of markups) {
      for (const m of html.matchAll(/<(button|a)\b[^>]*>(.*?)<\/\1>/gs)) {
        const whole = m[0];
        const inner = textOf(m[2] as string);
        const named = /[؀-ۿ]/.test(inner) || /Zaki Workspace/.test(inner) || /aria-label="[^"]*(?:[؀-ۿ]|Zaki Workspace)/.test(whole);
        expect(named, `${name}: ${whole.slice(0, 160)}`).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(60);
  });

  it("every control is thumb-sized: no button left at the 32-40px sizes", () => {
    const small = /(^|\s)(h|size)-(8|9|10)(\s|$)/;
    for (const [name, html] of markups) {
      for (const [tag] of html.matchAll(/<(?:button|input)\b[^>]*>/g)) {
        const cls = /class="([^"]*)"/.exec(tag)?.[1] ?? "";
        expect(small.test(cls), `${name}: ${tag.slice(0, 140)}`).toBe(false);
      }
    }
  });

  describe("Tailwind really generates every class (a typo, or an arbitrary value it cannot read, would silently do nothing)", () => {
    // the markup escapes "&" in an arbitrary variant ([&::-webkit-scrollbar]); Tailwind reads the source spelling
    const tokens = classTokens(Object.values(all).join("\n")).map((token) => token.replace(/&amp;/g, "&"));
    let css = "";
    beforeAll(async () => {
      const result = await postcss([tailwindcss({ ...config, content: [{ raw: tokens.join(" "), extension: "html" }] })]).process("@tailwind utilities;", { from: undefined });
      css = result.css;
    });
    const escapeSelector = (token: string) => token.replace(/[^a-zA-Z0-9_-]/g, (c) => (c === "," ? "\\2c " : `\\${c}`));
    const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hasRule = (token: string) => new RegExp(`\\.${escapeRegExp(escapeSelector(token))}(?![\\w\\\\-])`).test(css);
    /** Not Tailwind's: the decoration's zk-* classes and the icon library's markers. */
    const custom = (token: string) => /^zk-/.test(token) || /^lucide(-|$)/.test(token);

    it("every class has a rule", () => {
      expect(tokens.length).toBeGreaterThan(150);
      expect(tokens.filter((t) => !custom(t) && !hasRule(t))).toEqual([]);
    });

    it("the safe-area paddings are real CSS: env() kept intact inside calc()", () => {
      expect(css).toContain("padding-bottom: calc(3.5rem + 1px + env(safe-area-inset-bottom))");
      expect(css).toContain("padding-top: env(safe-area-inset-top)");
    });
  });
});

describe("the source of the frame", () => {
  const ROOT = path.resolve(__dirname, "..");
  const files = [
    "src/components/app-shell.tsx",
    "src/components/command-palette.tsx",
    "src/components/notification-bell.tsx",
    "src/app/(app)/layout.tsx",
    ...readdirSync(path.join(ROOT, "src/components/shell")).map((f) => `src/components/shell/${f}`),
  ];

  it("the old light/dark toggle and its package are gone from the frame", () => {
    for (const file of files) expect(readFileSync(path.join(ROOT, file), "utf8"), file).not.toMatch(/next-themes/);
  });

  it("no hard-coded colour: no hex, no rgb()/hsl(), no palette class", () => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(path.join(ROOT, file), "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(line) || PALETTE_COLOUR.test(line)) offenders.push(`${file}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("no physical left/right utility in the source either", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = readFileSync(path.join(ROOT, file), "utf8");
      for (const m of code.matchAll(/className=(?:"([^"]*)"|\{[^}]*?"([^"]*)")/g)) {
        for (const token of ((m[1] ?? m[2]) as string).split(/\s+/)) {
          if (token && PHYSICAL_UTILITY.test(token.split(":").pop() as string)) offenders.push(`${file}: ${token}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the frame keeps off the notch on both sides (review C item 11: `.zk-safe-x` existed and nothing used it)", () => {
  it("the top bar, the bottom bar and the page area carry the side safe-area padding", () => {
    const html = shell("MEMBER", "/");
    expect(/<header [^>]*>/.exec(html)?.[0]).toContain("zk-safe-x");
    expect(bottomBar(html).split(">")[0]).toContain("zk-safe-x");
    expect(/<main id="zk-main"[^>]*>/.exec(html)?.[0]).toContain("zk-safe-x");
  });
});

