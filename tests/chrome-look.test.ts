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
}));

import { AppShell } from "@/components/app-shell";
import { Drawer } from "@/components/shell/drawer";
import { PeopleDock } from "@/components/shell/people-dock";
import { Rail } from "@/components/shell/rail";
import { ToastProvider, ToastRow } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { audienceOf } from "@/lib/guide/audience";
import { buildNav, type NavRole, type NavSubject, type PlaceKey } from "@/lib/nav/places";
import { newActionsFor } from "@/lib/nav/new-actions";
import { chatChromeOf, isChatPath } from "@/lib/nav/shell-v2";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { classTokens, classesOf, textOf } from "./ui-render";

/**
 * «يشبه تصميم المالك» — the frame (rail, page bar, drawer, toasts, floating buttons) wears the owner's Telegram-like mock-up. Every colour is a token, every
 * measure is the mock-up's: a 72 px rail with an icon over a 10.5 px label, a 56 px page bar with the title (19 px, bold) and the tabs in one row, an accent
 * drawer header, a dark toast. On the chat pages the computer draws NO global bar: the search, «جديد», the bell and the roster live in the rail.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;

const USER = { name: "أحمد الكوري", username: "ahmad", email: "ahmad@example.test", avatarUrl: null };
const SPACE = { id: "w2", name: "الشحن", emoji: "🚚" };

function render(element: ReactElement): string {
  const client = new QueryClient();
  client.setQueryData(["notifications"], { items: [], unreadCount: 0 });
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(Toasts, null, element))));
}

const who = (role: NavRole): NavSubject => ({ role, caps: [...effectiveCapabilities({ role })], navV2: true });

function shell(pathname: string, extra: Record<string, unknown> = {}): string {
  where.pathname = pathname;
  const subject = who("MEMBER");
  return render(
    createElement(
      AppShell,
      {
        space: SPACE,
        user: USER,
        nav: buildNav(subject),
        rank: "MEMBER",
        audience: audienceOf({ isExternal: false, caps: subject.caps }),
        newActions: newActionsFor(subject),
        orgName: "شركة زكي",
        navV2: true,
        ...extra,
      } as unknown as React.ComponentProps<typeof AppShell>,
      createElement("p", null, "محتوى الصفحة"),
    ),
  );
}

describe("the chat pages draw no global bar on the computer (chatChromeOf)", () => {
  const on = { navV2: true, chatBare: true, pathname: "/chat", desktop: true as boolean | null };

  it("knows a chat address", () => {
    expect(isChatPath("/chat")).toBe(true);
    expect(isChatPath("/chat/abc")).toBe(true);
    expect(isChatPath("/chat/s/w1")).toBe(true);
    expect(isChatPath("/chatter")).toBe(false);
    expect(isChatPath("/my-work")).toBe(false);
    expect(isChatPath(null)).toBe(false);
  });

  it("moves the bar's tools into the rail once the screen is known to be a computer", () => {
    expect(chatChromeOf(on)).toBe("moved");
    expect(chatChromeOf({ ...on, pathname: "/chat/abc" })).toBe("moved");
  });

  it("keeps the bar (hidden from md by CSS) while the screen is unknown, and as it is on a phone", () => {
    expect(chatChromeOf({ ...on, desktop: null })).toBe("pending");
    expect(chatChromeOf({ ...on, desktop: false })).toBe("pending");
  });

  it("changes nothing off the chat, with the new chat screen off, or on the old menu", () => {
    expect(chatChromeOf({ ...on, pathname: "/my-work" })).toBe("full");
    expect(chatChromeOf({ ...on, chatBare: false })).toBe("full");
    expect(chatChromeOf({ ...on, navV2: false })).toBe("full");
  });
});

describe("the frame on the chat pages", () => {
  it("hides the bar from md on the chat (the phone keeps it) when the new chat screen is on", () => {
    const html = shell("/chat/abc", { chatBare: true });
    expect(classesOf(html, /<header[^>]*data-shell="app-bar"[^>]*>/)).toContain("md:hidden");
  });

  it("draws the bar as before on every other page, and on the chat while the new chat screen is off", () => {
    expect(classesOf(shell("/my-work", { chatBare: true }), /<header[^>]*data-shell="app-bar"[^>]*>/)).not.toContain("md:hidden");
    expect(classesOf(shell("/chat/abc", { chatBare: false }), /<header[^>]*data-shell="app-bar"[^>]*>/)).not.toContain("md:hidden");
  });

  it("the app layout hands the new chat screen's switch to the frame", () => {
    expect(read("src/app/(app)/layout.tsx")).toMatch(/chatBare=\{[^}]*on\.chatLayoutV2/);
  });
});

describe("the rail wears the mock-up (72 px, icon over a 10.5 px label)", () => {
  const nav = buildNav(who("MEMBER"));
  const rail = (extra: Record<string, unknown> = {}) =>
    render(createElement(Rail, { nav, current: "work" as PlaceKey, pathname: "/my-work", user: USER, rank: "MEMBER" as NavRole, isGuest: false, space: SPACE, badges: { chat: 5 }, ...extra }));

  it("is 72 px wide", () => {
    expect(classesOf(rail(), /<aside[^>]*data-shell="rail"[^>]*>/)).toContain("w-[72px]");
  });

  it("the logo is the accent tile with the gold star, at the top", () => {
    const html = rail();
    const brand = /<a\b[^>]*aria-label="[^"]*"[^>]*>[\s\S]*?<\/a>/.exec(html)?.[0] ?? "";
    expect(brand).toContain("data-brand-mark");
    expect(brand).toMatch(/bg-accent\b/);
    expect(brand).toContain("zk-star");
    expect(brand).toMatch(/text-accent-2/);
  });

  it("a place is an icon over a 10.5 px label; the current one is accent on accent-soft", () => {
    const html = rail();
    const places = /<nav[^>]*data-tour="places"[^>]*>[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    const current = /<a\b[^>]*href="\/my-work"[^>]*>[\s\S]*?<\/a>/.exec(places)?.[0] ?? "";
    expect(classTokens(current)).toEqual(expect.arrayContaining(["text-accent", "text-xs", "flex-col"]));
    expect(current).toMatch(/bg-accent\/(10|12|15|\[0\.12\])/);
    const other = /<a\b[^>]*href="\/chat"[^>]*>[\s\S]*?<\/a>/.exec(places)?.[0] ?? "";
    expect(other).not.toMatch(/bg-accent\//);
    expect(other).toContain("text-fg-muted");
  });

  it("the unread number is a round accent badge, not a red one", () => {
    const html = rail();
    const badge = /<span[^>]*data-badge[^>]*>/.exec(html)?.[0] ?? "";
    expect(badge).toContain("rounded-full");
    expect(badge).toContain("bg-accent");
    expect(badge).not.toContain("bg-danger");
  });

  it("draws the tools it is given (the search, «جديد», the bell) and the roster above its foot, and nothing when it has none", () => {
    const html = rail({ tools: createElement("button", { "data-probe": "tool" }, "أداة"), dock: createElement("button", { "data-probe": "dock" }, "متصل") });
    expect(html).toContain('data-shell="rail-tools"');
    expect(html).toContain('data-probe="tool"');
    expect(html).toContain('data-probe="dock"');
    expect(rail()).not.toContain('data-shell="rail-tools"');
  });
});

describe("the roster in the rail (the bottom strip, moved)", () => {
  it("is a place-sized item with the online count, and opens the same roster", () => {
    const client = new QueryClient();
    client.setQueryData(["presence-dock", "space"], {
      meId: "u1",
      people: [
        { userId: "u1", name: "أحمد", jobTitle: null, role: "OWNER", online: true },
        { userId: "u2", name: "سارة", jobTitle: null, role: "MEMBER", online: false },
      ],
      onlineCount: 1,
      total: 2,
    });
    const html = renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(PeopleDock, { variant: "rail" } as never))));
    expect(html).toContain('data-shell="rail-dock"');
    expect(html).toContain("text-xs");
    expect(html).toContain(AR["shell.dock.online.one"]?.replace("{n}", "1") ?? "?");
    // the strip's own 40 px row is not drawn in the rail
    expect(html).not.toContain("h-10 shrink-0");
  });
});

describe("the page bar is the mock-up's (title 19 px bold + the tabs in the same row)", () => {
  const html = shell("/my-work");
  const bar = /<header[^>]*data-shell="app-bar"[^>]*>[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";

  it("the title is 19 px and bold, and the bar is at least 56 px", () => {
    const title = /<p[^>]*>الشغل<\/p>/.exec(bar)?.[0] ?? "";
    expect(classTokens(title)).toEqual(expect.arrayContaining(["text-[19px]", "font-bold"]));
    expect(bar).toMatch(/<div[^>]*class="[^"]*\bmd:min-h-14\b/);
  });

  it("the tabs of the place sit INSIDE the bar (one landmark, once), the current one accent on accent-soft", () => {
    expect(bar).toContain('data-tour="tabs"');
    expect(html.split('data-tour="tabs"').length - 1).toBe(1);
    const current = /<a\b[^>]*aria-current="page"[^>]*>/.exec(/<nav[^>]*data-tour="tabs"[^>]*>[\s\S]*?<\/nav>/.exec(bar)?.[0] ?? "")?.[0] ?? "";
    expect(classTokens(current)).toEqual(expect.arrayContaining(["text-accent"]));
  });
});

describe("the phone's drawer", () => {
  const html = render(
    createElement(Drawer, { open: true, onOpenChange: () => {}, nav: buildNav(who("MEMBER")), current: "work" as PlaceKey, pathname: "/my-work", user: USER, rank: "MEMBER" as NavRole, isGuest: false, space: SPACE, portal: false }),
  );

  it("opens with the accent header: the person on accent, in the accent's own text colour", () => {
    const head = /<div[^>]*data-shell="drawer-head"[^>]*>/.exec(html)?.[0] ?? "";
    expect(head).toContain("bg-accent");
    expect(head).toContain("text-accent-fg");
    expect(textOf(html)).toContain("أحمد الكوري");
  });
});

describe("the toast is the mock-up's dark pill", () => {
  it("dark pill: the ink on the light themes, surface-2 on the dark ones; the page colour / normal text on it; rounded", () => {
    const html = renderToStaticMarkup(
      createElement(Translations, { initial: "ar" }, createElement(ToastRow, { item: { id: 1, kind: "info", message: "تم" }, onDismiss: () => {} })),
    );
    const classes = classesOf(html, /<div[^>]*data-zk-toast[^>]*>/);
    expect(classes).toEqual(expect.arrayContaining(["bg-fg", "text-surface", "dark:bg-surface-2", "dark:text-fg", "rounded-xl"]));
    expect(classes).not.toContain("bg-surface-1");
    expect(classes).not.toContain("bg-scrim");
  });
});

describe("the toast sits under the phone's ONE-row bar (P2.1)", () => {
  it("offset by the bar's 56px row (top-14) and the notch: the bar is one row now, so the old guess is exactly right (tests/ui-feedback.test.ts pins the classes)", () => {
    const src = read("src/components/ui/toast.tsx");
    expect(src).toContain("top-14");
    expect(src).toContain("pt-[max(0.75rem,env(safe-area-inset-top))]");
  });
});

describe("the floating button is the mock-up's 56 px circle", () => {
  it("the quick chat's button is size-14 on the accent (P2.1: still, from md up; a phone with the new map does not draw it)", () => {
    const src = read("src/components/shell/quick-chat.tsx");
    expect(src).toMatch(/grid size-14 place-items-center rounded-full bg-accent/);
  });
});

describe("tokens only", () => {
  it("no hex colour and no raw palette class in the files this pass touched", () => {
    for (const file of ["src/components/shell/rail.tsx", "src/components/shell/rail-style.ts", "src/components/shell/app-bar.tsx", "src/components/shell/place-tabs.tsx", "src/components/shell/drawer.tsx", "src/components/ui/toast.tsx"]) {
      const src = read(file);
      expect(src, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, file).not.toMatch(/\b(?:bg|text|border)-(?:red|blue|green|gray|slate|zinc|yellow|white|black)(?:-\d+)?\b/);
    }
  });
});
