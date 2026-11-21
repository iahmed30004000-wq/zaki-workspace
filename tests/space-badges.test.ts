import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// The components are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { Drawer } from "@/components/shell/drawer";
import type { OrgsResponse } from "@/components/shell/space-switcher";
import { ToastProvider } from "@/components/ui/toast";
import { FEATURES, FEATURE_DEFAULTS, FEATURE_META, featureOn } from "@/lib/features";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { buildNav, type NavRole, type NavSubject, type PlaceKey } from "@/lib/nav/places";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { textOf } from "./ui-render";

/**
 * S5.8 «عدّاد الانتظار لكل مساحة على القائمة» — the unit side: the switch `spaceBadges`, the badge beside each OTHER space on the phone drawer, the dot on the
 * current-space header, and the pins on the source (one source for the number, one grouped read, nothing in English, colours from tokens only).
 * The database side is tests/db/space-badges.test.ts.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;

const USER = { name: "أحمد الكوري", username: "ahmad", email: "ahmad@example.test", avatarUrl: null };
const SPACE = { id: "w2", name: "الشحن", emoji: "🚚" };

type Entry = OrgsResponse["organizations"][number]["workspaces"][number];
const spaces = (rows: Entry[]): OrgsResponse => ({
  currentSpaceId: "w2",
  organizations: [{ id: "o1", name: "زكي", keyPrefix: "ZK", role: "MEMBER", canCreateSpaces: false, workspaces: rows }],
});
const row = (id: string, name: string, waiting?: number, extra: Partial<Entry> = {}): Entry => ({
  id,
  name,
  slug: id,
  emoji: null,
  holdsProjects: true,
  unread: 0,
  overdue: 0,
  ...(waiting === undefined ? {} : { waiting }),
  ...extra,
});

function drawer(data: OrgsResponse): string {
  const client = new QueryClient();
  client.setQueryData(["orgs"], data);
  client.setQueryData(["notifications"], { items: [], unreadCount: 0 });
  const subject: NavSubject = { role: "MEMBER", caps: [...effectiveCapabilities({ role: "MEMBER" })], navV2: true };
  const element: ReactElement = createElement(Drawer, {
    open: true,
    onOpenChange: () => {},
    portal: false,
    nav: buildNav(subject),
    current: "chat" as PlaceKey,
    pathname: "/chat",
    user: USER,
    rank: "MEMBER" as NavRole,
    isGuest: false,
    space: SPACE,
  });
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(Toasts, null, element))));
}

const dropdown = (html: string): string => /<div data-shell="space-dropdown">[\s\S]*?<nav\b/.exec(html)?.[0] ?? "";
const rowOf = (html: string, name: string): string => new RegExp(`<a\\b[^>]*>(?:(?!</a>)[\\s\\S])*${name}(?:(?!</a>)[\\s\\S])*</a>`).exec(html)?.[0] ?? "";

describe("the switch `spaceBadges`", () => {
  it("is a real switch: OFF by default, in «المهام والشغل», it needs «الطلبات» and the new menu, and has its two lines with the ⚠️ and the 🔧", () => {
    expect(FEATURES).toContain("spaceBadges");
    expect(FEATURE_DEFAULTS.spaceBadges).toBe(false);
    expect(featureOn({}, "spaceBadges")).toBe(false);
    expect(featureOn({ features: { spaceBadges: true } }, "spaceBadges")).toBe(true);
    expect(FEATURE_META.spaceBadges.group).toBe("work");
    expect([...(FEATURE_META.spaceBadges.dependsOn ?? [])].sort()).toEqual(["navV2", "workRequests"]);
    expect(AR["features.spaceBadges.name"]).toMatch(/[؀-ۿ]/);
    const hint = AR["features.spaceBadges.hint"] as string;
    expect(hint).toMatch(/[؀-ۿ]/);
    expect(hint).toContain("⚠️");
    expect(hint).toContain("🔧");
    expect(hint).toContain("بانتظار قرارك");
  });
});

describe("the drawer's spaces (phone)", () => {
  const data = spaces([row("w1", "الشركة", 0), row("w2", "الشحن", 9), row("w3", "التسويق", 3), row("w4", "المخزن", 4, { overdue: 2 })]);

  it("each OTHER space wears a small waiting badge with its number; a zero draws nothing; the space the person is in draws none (its number is on «الشغل»)", () => {
    const html = drawer(data);
    expect(rowOf(html, "التسويق")).toContain('data-count="waiting"');
    expect(textOf(rowOf(html, "التسويق"))).toContain("3");
    expect(rowOf(html, "المخزن")).toContain('data-count="waiting"');
    expect(rowOf(html, "الشركة")).not.toContain('data-count="waiting"');
    expect(rowOf(html, "الشحن")).not.toContain('data-count="waiting"');
    // the overdue pill of the same row is still there beside it
    expect(rowOf(html, "المخزن")).toContain('data-count="overdue"');
  });

  it("a screen reader gets the number with the space's name, in Arabic", () => {
    const html = drawer(data);
    expect(AR["navv2.space.waiting"]).toMatch(/[؀-ۿ]/);
    expect(html).toContain((AR["navv2.space.waiting"] as string).replace("{name}", "التسويق").replace("{n}", "3"));
    expect(html).not.toContain((AR["navv2.space.waiting"] as string).replace("{name}", "الشركة").replace("{n}", "0"));
  });

  it("the current-space header wears ONE small dot when the other spaces hold something waiting (the sum: 3 + 4 = 7), and the sum is for a screen reader", () => {
    const html = drawer(data);
    const head = /<button\b[^>]*aria-controls="drawer-space-list"[\s\S]*?<\/button>/.exec(html)?.[0] ?? "";
    expect(head).toContain('data-shell="space-waiting-dot"');
    expect(head.match(/data-shell="space-waiting-dot"/g)?.length).toBe(1);
    expect(head).toContain((AR["navv2.space.waiting_elsewhere"] as string).replace("{n}", "7"));
  });

  it("no dot when nothing waits elsewhere (only the current space has something), and none when the answer has no numbers (the switch is off)", () => {
    const only = drawer(spaces([row("w1", "الشركة", 0), row("w2", "الشحن", 9), row("w3", "التسويق", 0)]));
    expect(only).not.toContain("space-waiting-dot");
    expect(only).not.toContain('data-count="waiting"');
    const off = drawer(spaces([row("w1", "الشركة"), row("w2", "الشحن"), row("w3", "التسويق", undefined, { unread: 2 })]));
    expect(off).not.toContain("space-waiting-dot");
    expect(off).not.toContain('data-count="waiting"');
    expect(dropdown(off)).toContain('data-count="unread"');
  });

  it("the old pills are untouched (unread and overdue still draw as before)", () => {
    const html = drawer(data);
    expect(rowOf(html, "المخزن")).toContain('data-count="overdue"');
    const plain = drawer(spaces([row("w1", "الشركة", undefined, { unread: 4 }), row("w2", "الشحن", undefined, { unread: 3 })]));
    expect(plain).toContain('data-count="unread"');
  });
});

describe("source pins", () => {
  it("the number is ONE source: the route asks `waitingBySpace` of the requests inbox (behind the switches, a failure degrades), nothing is counted there itself", () => {
    const route = read("src/app/api/workspaces/route.ts");
    expect(route).toContain("waitingBySpace");
    expect(route).toContain('"spaceBadges"');
    expect(route).toContain('"workRequests"');
    expect(route).not.toMatch(/approvalRequest|taskAssignRequest|db\.card/);
  });

  it("the inbox counts every kind with ONE grouped read (no pass per space), and the page's own filters are shared with it", () => {
    const src = read("src/server/services/work-requests.ts");
    const body = /export async function waitingBySpace[\s\S]*?\n}\n/.exec(src)?.[0] ?? "";
    expect(body).not.toBe("");
    expect(body).toContain("groupBy");
    expect(body).not.toMatch(/spaces\.map\(|spaceIds\.map\(|for \(const .* of (spaces|spaceIds)/);
    expect(body).not.toContain("sectionsOf(");
    expect(body).not.toContain("workRequestsOf(");
    // the filters the lists use are the ones it counts with
    expect(src).toMatch(/function assignmentsWhere/);
    expect(src).toMatch(/function cardsWhere/);
    expect(src).toMatch(/function sheetsWhere/);
    const approvals = read("src/server/services/approvals.ts");
    expect(approvals).toContain("waitingCountBySpace");
    expect(approvals).toContain('GROUP BY r."workspaceId"');
  });

  it("only the spaces the person works in are counted (the gate is the inbox's own `workSpacesOf`)", () => {
    const body = /export async function waitingBySpace[\s\S]*?\n}\n/.exec(read("src/server/services/work-requests.ts"))?.[0] ?? "";
    expect(body).toContain("c.spaces()");
    expect(read("src/server/services/work-requests.ts")).toMatch(/spaces: lazy\(\(\) => workSpacesOf\(actor\)\)/);
    expect(body).toMatch(/isExternal|GUEST/);
  });

  it("the badge uses colour tokens only (no raw colours, no physical sides) and no English word is on screen", () => {
    const src = read("src/components/shell/space-switcher.tsx");
    const block = /export function CountPills[\s\S]*?\n}\n/.exec(src)?.[0] ?? "";
    expect(block).toContain('data-count="waiting"');
    expect(block).toMatch(/bg-warn\b/);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:bg|text|border)-(?:red|green|blue|amber|yellow|orange|slate|gray|zinc|white|black)\b/);
    expect(block).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-\d/);
    for (const key of ["features.spaceBadges.name", "features.spaceBadges.hint", "navv2.space.waiting", "navv2.space.waiting_elsewhere"]) {
      expect(AR[key], key).toBeTruthy();
      expect((AR[key] as string).replace(/\{[a-z]+\}/g, ""), key).not.toMatch(/[A-Za-z]/);
    }
  });
});
