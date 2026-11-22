import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/my-work",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { AppBar } from "@/components/shell/app-bar";
import { Drawer } from "@/components/shell/drawer";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { enumLabel } from "@/lib/i18n/enums";
import { audienceOf } from "@/lib/guide/audience";
import { buildNav, type NavRole, type NavSubject } from "@/lib/nav/places";
import { effectiveCapabilities } from "@/server/policy/capabilities";

/**
 * The owner's «شغلات بسيطة» (2026-11-22): a sign-out button at the very bottom of the phone's menu (no tapping the profile to find it), and the guide's button
 * at the top of every page, with a colour and a shape of its own.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;

const USER = { name: "أحمد الكوري", username: "ahmad", email: "ahmad@example.test", avatarUrl: null };
const who = (role: NavRole): NavSubject => ({ role, caps: [...effectiveCapabilities({ role })], navV2: true });

function render(element: ReactElement): string {
  const client = new QueryClient();
  client.setQueryData(["notifications"], { items: [], unreadCount: 0 });
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(Toasts, null, element))));
}

const drawer = (extra: Record<string, unknown> = {}): string =>
  render(
    createElement(Drawer, {
      open: true,
      onOpenChange: () => {},
      nav: buildNav(who("OWNER")),
      current: "work",
      pathname: "/my-work",
      user: USER,
      rank: "OWNER" as NavRole,
      isGuest: false,
      portal: false,
      ...extra,
    } as never),
  );

const appBar = (extra: Record<string, unknown> = {}): string =>
  render(
    createElement(AppBar, {
      nav: buildNav(who("OWNER")),
      place: "work",
      title: "الشغل",
      pathname: "/my-work",
      audience: audienceOf({ isExternal: false, caps: [] }),
      newActions: ["message"],
      onOpenDrawer: () => {},
      ...extra,
    } as never),
  );

const foot = (html: string): string => html.slice(html.indexOf('data-shell="drawer-foot"'));

describe("the phone's menu ends with «تسجيل الخروج»", () => {
  it("a sign-out button is the last thing in the foot, and the profile row (the avatar menu) is no longer there to open first", () => {
    const html = drawer();
    const f = foot(html);
    expect(f).toContain('data-shell="drawer-signout"');
    expect(f).toContain(AR["shell.avatar.logout"] as string);
    expect(f).not.toContain('data-tour="avatar"');
    // nothing but the button's own closing markup follows it
    const after = f.slice(f.lastIndexOf("<button", f.indexOf('data-shell="drawer-signout"')));
    expect(after.match(/<button/g)?.length).toBe(1);
    expect(after.match(/<a /g)).toBeNull();
  });

  it("it is a real button of the danger colour, one tap, 44px or more", () => {
    const btn = /<button[^>]*data-shell="drawer-signout"[^>]*class="([^"]*)"/.exec(drawer()) ?? /<button[^>]*class="([^"]*)"[^>]*data-shell="drawer-signout"/.exec(drawer());
    expect(btn).not.toBeNull();
    expect(btn?.[1]).toContain("text-danger");
    expect(btn?.[1]).toMatch(/min-h-1[12]|h-1[12]/);
  });

  it("the sign-out is ONE piece of code: the avatar menu's and the drawer's button share it (outbox cleared, chat cache wiped, device copy cleared, then /login)", () => {
    const text = read("src/components/shell/avatar-menu.tsx");
    expect(text.match(/await wipeChatCache\(\)/g)?.length).toBe(1);
    expect(text).toContain("export function SignOutButton");
    expect(text).toContain("function useLogout");
    expect(read("src/components/shell/drawer.tsx")).toContain("SignOutButton");
  });
});

describe("the guide's button: at the top of the page, coloured, with a shape", () => {
  it("the app bar draws it for the owner's guide (a filled round button of the info colour, with the guide's name)", () => {
    const html = appBar({ guide: true });
    const m = /<button[^>]*data-shell="app-bar-guide"[^>]*>/.exec(html);
    expect(m).not.toBeNull();
    expect(m?.[0]).toContain("bg-info");
    expect(m?.[0]).toContain("text-info-fg");
    expect(m?.[0]).toContain("rounded-full");
    expect(html).toContain(AR["siteGuide.open"] as string);
  });

  it("without the guide there is no button", () => {
    expect(appBar()).not.toContain("app-bar-guide");
    expect(appBar({ guide: false })).not.toContain("app-bar-guide");
  });

  it("it opens the guide through the one event the guide listens to", () => {
    const text = read("src/components/shell/app-bar.tsx");
    expect(text).toContain("GUIDE_OPEN_EVENT");
    expect(text).toContain("new Event(GUIDE_OPEN_EVENT)");
  });

  it("the frame hands the guide to the app bar", () => {
    const shellText = read("src/components/app-shell.tsx");
    expect(shellText.match(/guide=\{!isGuest && siteGuide\}/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("the drawer's row and the computer's floating button are coloured too", () => {
    const row = /<button[^>]*data-shell="drawer-guide"[^>]*>/.exec(drawer({ guide: true }));
    expect(row?.[0]).toContain("bg-info");
    const floating = read("src/components/site-guide/site-guide.tsx");
    expect(floating).toMatch(/"fixed z-50 flex h-12 w-12 items-center justify-center rounded-full[^"]*bg-info text-info-fg/);
  });
});

describe("the drawer's header: the rank beside the @name, and the small buttons side by side in ONE row (the owner, 2026-11-22)", () => {
  const head = (html: string): string => html.slice(html.indexOf('data-shell="drawer-head"'), html.indexOf('data-shell="drawer-foot"'));

  it("the @username and the rank («مالك») share one line", () => {
    const h = head(drawer());
    const line = /<div[^>]*data-shell="drawer-head-id"[^>]*>([\s\S]*?)<\/div>/.exec(h);
    expect(line).not.toBeNull();
    expect(line?.[1]).toContain("@ahmad");
    expect(line?.[1]).toContain(enumLabel("OrgRole", "OWNER"));
  });

  it("the tools row holds the online count, the light/dark button and (at the end) «إغلاق»: one row, not scattered over the corners", () => {
    const src = read("src/components/shell/drawer.tsx");
    const tools = src.indexOf('data-shell="drawer-head-tools"');
    expect(tools).toBeGreaterThan(-1);
    expect(src.indexOf("DialogPrimitive.Close", tools)).toBeGreaterThan(tools);
    expect(src.indexOf("{presence}", tools)).toBeGreaterThan(tools);
    expect(src.indexOf("<ThemeIconButton", tools)).toBeGreaterThan(tools);
    expect(src.indexOf("<NavOrderButton", tools)).toBeGreaterThan(tools);
    // nothing in the header is pinned to a corner any more
    expect(src.slice(src.indexOf('data-shell="drawer-head"'), src.indexOf("min-h-0 flex-1 overflow-y-auto"))).not.toContain("absolute");
  });

  it("the buttons are small (32px): the theme button and the count pill", () => {
    const h = head(drawer());
    const theme = /<button[^>]*data-shell="drawer-theme"[^>]*class="([^"]*)"/.exec(h) ?? /<button[^>]*class="([^"]*)"[^>]*data-shell="drawer-theme"/.exec(h);
    expect(theme?.[1]).toContain("size-8");
    expect(theme?.[1]).not.toContain("size-11");
    expect(read("src/components/shell/people-dock.tsx")).toContain('"flex h-8 items-center gap-1.5 rounded-full bg-accent-fg/15');
  });
});
