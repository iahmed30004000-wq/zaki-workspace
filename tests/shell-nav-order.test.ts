import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { BottomNav } from "@/components/shell/bottom-nav";
import { PlaceTabs } from "@/components/shell/place-tabs";
import { Sidebar } from "@/components/shell/sidebar";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { audienceOf } from "@/lib/guide/audience";
import { buildNav, type NavRole, type NavSubject } from "@/lib/nav/places";
import { applyNavOrder, type NavOrder } from "@/lib/nav/order";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import type { CurrentUser } from "@/server/auth";

/**
 * «ترتيبي», on screen: the person's saved order is applied on the side menu, the phone's bar and the tab strip alike
 * (the server hands it to the shell, so the very first markup already has it); the reorder mode shows a grip on every
 * row; with no order, and outside the mode, nothing differs from the code's order.
 */

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;

const USER: CurrentUser = { id: "u1", email: "a@example.test", username: "a", name: "أحمد", locale: "ar", mustChangePassword: false, transparencyPending: false, tv: 0 };
const who = (role: NavRole): NavSubject => ({ role, caps: [...effectiveCapabilities({ role })] });

function render(element: ReactElement): string {
  const client = new QueryClient();
  client.setQueryData(["orgs"], { organizations: [] });
  client.setQueryData(["notifications"], { items: [], unreadCount: 0 });
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(Toasts, null, element))));
}

function shell(role: NavRole, pathname: string, navOrder?: NavOrder | null): string {
  where.pathname = pathname;
  const subject = who(role);
  return render(
    createElement(AppShell, {
      user: USER,
      nav: buildNav(subject),
      navOrder,
      rank: role,
      audience: audienceOf({ isExternal: role === "GUEST", caps: subject.caps }),
      isGuest: role === "GUEST",
      children: createElement("p", null, "x"),
    }),
  );
}

function outerOf(markup: string, open: RegExp, tag: string): string {
  const m = open.exec(markup);
  if (!m) throw new Error(`no ${open} in: ${markup.slice(0, 300)}`);
  const re = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  re.lastIndex = m.index + 1;
  let depth = 1;
  for (let hit = re.exec(markup); hit; hit = re.exec(markup)) {
    depth += hit[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return markup.slice(m.index, hit.index + hit[0].length);
  }
  throw new Error(`unclosed <${tag}>`);
}
const bottomBar = (html: string) => outerOf(html, /<nav[^>]*class="fixed bottom-0[^"]*"[^>]*>/, "nav");
const sidebarPlaces = (html: string) => outerOf(outerOf(html, /<aside\b[^>]*>/, "aside"), /<nav[^>]*data-tour="places"[^>]*>/, "nav");
const tabStrip = (html: string) => outerOf(html, /<nav[^>]*data-tour="tabs"[^>]*>/, "nav");
const hrefs = (markup: string) => [...markup.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1] as string);
/** How many rows carry a grip (a button named «اسحب لتحريك …»). */
const grips = (markup: string) => markup.split(`aria-label="${(AR["navorder.grip"] as string).split("{label}")[0]}`).length - 1;

const DEFAULT_PLACE_HREFS = ["/", "/chat", "/my-work", "/files", "/watch", "/members"];
const DEFAULT_WORK_TABS = ["/my-work", "/projects", "/list", "/calendar", "/goals", "/ideas", "/production", "/departments", "/tickets", "/campaigns", "/crm", "/approvals", "/checkins"];

describe("no saved order: the code's order, exactly as before", () => {
  const html = shell("OWNER", "/projects");
  it("the bar, the menu and the strip are in the default order and carry no grip and no reorder bar", () => {
    expect(hrefs(bottomBar(html))).toEqual(DEFAULT_PLACE_HREFS);
    expect(hrefs(sidebarPlaces(html))).toEqual(DEFAULT_PLACE_HREFS);
    expect(hrefs(tabStrip(html))).toEqual(DEFAULT_WORK_TABS);
    expect(html).not.toContain(AR["navorder.mode"] as string);
    expect(grips(html)).toBe(0);
  });

  it("the menu's footer offers «ترتيب» (a deliberate switch), and nothing in the lists starts a drag by itself", () => {
    expect(html).toContain("data-nav-order-toggle");
    expect(html).toContain(`>${AR["navorder.toggle"]}<`);
    expect(sidebarPlaces(html)).not.toContain("data-sort-id");
    expect(bottomBar(html)).not.toContain("data-sort-id");
  });
});

describe("a saved order is applied on the first paint, everywhere", () => {
  const order: NavOrder = {
    places: ["library", "chat", "today", "work", "watch", "admin"],
    tabs: { work: ["crm", "calendar", "my-work", "projects", "list", "goals", "ideas", "production", "departments", "tickets", "campaigns", "approvals", "checkins"] },
  };
  const html = shell("OWNER", "/projects", order);

  it("the phone's bar and the computer's menu both follow the places' order, with every address as it was", () => {
    const expected = ["/files", "/chat", "/", "/my-work", "/watch", "/members"];
    expect(hrefs(bottomBar(html))).toEqual(expected);
    expect(hrefs(sidebarPlaces(html))).toEqual(expected);
  });

  it("the tab strip follows the tabs' order, and the current tab is still marked", () => {
    const strip = tabStrip(html);
    expect(hrefs(strip).slice(0, 4)).toEqual(["/crm", "/calendar", "/my-work", "/projects"]);
    expect([...hrefs(strip)].sort()).toEqual([...DEFAULT_WORK_TABS].sort());
    expect(/<a\b[^>]*href="\/projects"[^>]*>/.exec(strip)?.[0]).toContain('aria-current="page"');
  });

  it("«الإدارة» is still there, with its tabs, when it is put first", () => {
    const first = shell("OWNER", "/members", { places: ["admin", "today", "chat", "work", "library", "watch"], tabs: { admin: ["settings", "team", "space", "reports", "automation", "telegram", "archive"] } });
    expect(hrefs(bottomBar(first))[0]).toBe("/members");
    expect(hrefs(tabStrip(first)).slice(0, 2)).toEqual(["/settings", "/members"]);
  });

  it("an order never shows a guest a place or tab they are not offered", () => {
    const guest = shell("GUEST", "/my-work", {
      places: ["admin", "watch", "library", "work", "chat", "today"],
      tabs: { work: ["crm", "goals", "calendar", "list", "projects", "my-work"] },
    });
    for (const part of [bottomBar(guest), sidebarPlaces(guest)]) {
      // the library (its «المستندات» tab, the only one a partner is offered) is theirs too, so it follows the saved order
      expect(hrefs(part)).toEqual(["/documents", "/my-work", "/chat", "/"]);
    }
    expect(hrefs(tabStrip(guest))).toEqual(["/calendar", "/list", "/projects", "/my-work"]);
  });

  it("an order that names things this person has no access to cannot break the frame", () => {
    const odd = shell("MEMBER", "/", { places: ["nope", "chat", "today", "work", "library", "watch", "admin"], tabs: { nowhere: ["x"] } } as NavOrder);
    expect(hrefs(bottomBar(odd))[0]).toBe("/chat");
    expect(hrefs(bottomBar(odd))).toHaveLength(buildNav(who("MEMBER")).places.length);
  });
});

describe("the reorder mode: a grip on every row, links off", () => {
  const nav = buildNav(who("OWNER"));
  const props = (editing: boolean) => ({ editing, onEditStart: () => {}, onEditDone: () => {}, onReorder: () => {}, onReset: () => {}, canReset: true });

  it("the side menu: one grip per place, the rows are not links, and «تم» / «رجّع الترتيب الأصلي» replace «ترتيب»", () => {
    where.pathname = "/";
    const html = render(
      createElement(Sidebar, {
        nav,
        current: "today",
        pathname: "/",
        user: { name: "أحمد", username: "a", email: "a@example.test", avatarUrl: null },
        rank: "OWNER",
        isGuest: false,
        collapsed: false,
        onToggle: () => {},
        ...props(true),
      }),
    );
    const places = sidebarPlaces(html);
    expect(grips(places)).toBe(nav.places.length);
    expect(hrefs(places)).toEqual([]);
    expect(places).toContain(`aria-roledescription="${AR["navorder.role"]}"`);
    expect(places.match(/data-sort-id="[a-z]+"/g)).toHaveLength(nav.places.length);
    expect(html).toContain(AR["navorder.reset"] as string);
    expect(html).toContain(`>${AR["navorder.done"]}<`);
    expect(html).not.toContain("data-nav-order-toggle");
    // each grip points at the list's instructions (dnd-kit adds their text in the browser, once it has mounted)
    expect(places).toContain('aria-describedby="nav-places-side"');
  });

  it("the phone's bar: one grip per place, a bar with the two buttons above it", () => {
    const html = render(createElement(BottomNav, { places: nav.places, current: "today", pathname: "/", ...props(true) }));
    const bar = bottomBar(html);
    expect(grips(bar)).toBe(nav.places.length);
    expect(hrefs(bar)).toEqual([]);
    expect(html).toContain(AR["navorder.reset"] as string);
    expect(html.indexOf(AR["navorder.reset"] as string)).toBeLessThan(html.indexOf("<nav"));
  });

  it("the tab strip: one grip per tab, and the strip names what it orders", () => {
    const work = nav.places.find((p) => p.key === "work")!;
    where.pathname = "/projects";
    const html = render(createElement(PlaceTabs, { place: work, tab: "projects", pathname: "/projects", editing: true, onReorder: () => {} }));
    expect(grips(html)).toBe(work.tabs.length);
    expect(hrefs(html)).toEqual([]);
    expect(html).toContain((AR["navorder.tabs_label"] as string).replace("{place}", AR["nav.place.work"] as string));
  });

  it("outside the mode a place still links to its page, the bar has no grips and no reorder buttons", () => {
    const html = render(createElement(BottomNav, { places: nav.places, current: "today", pathname: "/", ...props(false) }));
    expect(hrefs(bottomBar(html))).toEqual(DEFAULT_PLACE_HREFS);
    expect(grips(html)).toBe(0);
    expect(html).not.toContain(AR["navorder.reset"] as string);
  });

  it("«رجّع الترتيب الأصلي» is disabled while there is nothing saved to give back", () => {
    const html = render(createElement(BottomNav, { places: nav.places, current: "today", pathname: "/", ...props(true), canReset: false }));
    expect(new RegExp(`<button[^>]*disabled=""[^>]*>${AR["navorder.reset"]}`).test(html)).toBe(true);
  });
});

describe("the server's pure step and the shell agree", () => {
  it("applyNavOrder on the server's map gives the order the shell draws", () => {
    const order: NavOrder = { places: ["watch", "admin", "today", "chat", "work", "library"], tabs: {} };
    const keys = applyNavOrder(buildNav(who("OWNER")), order).places.map((p) => p.key);
    expect(keys.slice(0, 2)).toEqual(["watch", "admin"]);
  });
});
