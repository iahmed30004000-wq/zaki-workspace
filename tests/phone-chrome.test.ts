import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// The components are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

const where = vi.hoisted(() => ({ pathname: "/my-work" }));
vi.mock("next/navigation", () => ({
  usePathname: () => where.pathname,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { AppShell } from "@/components/app-shell";
import { AppBar } from "@/components/shell/app-bar";
import { Drawer } from "@/components/shell/drawer";
import { DrawerChromeContext } from "@/components/shell/nav-options";
import { PeopleDock, type PresenceRosterDto } from "@/components/shell/people-dock";
import { QuickChat } from "@/components/shell/quick-chat";
import { SiteGuide } from "@/components/site-guide/site-guide";
import { paletteCommands } from "@/components/command-palette";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { audienceOf } from "@/lib/guide/audience";
import { buildNav, type NavRole, type NavSubject, type PlaceKey } from "@/lib/nav/places";
import { newActionsFor } from "@/lib/nav/new-actions";
import { GUIDE_OPEN_EVENT } from "@/lib/nav/shell-v2";
import { effectiveCapabilities } from "@/server/policy/capabilities";

/**
 * P2.1 — the phone's chrome on the new map (`navV2`): ONE app bar row (☰, the title, a search icon, the bell, «+»), the presence bar out of the page and into the
 * drawer's header as a dot and a count, no round bubbles over the page, ONE assistant button that is not over the content, no stale bottom-bar offsets.
 * Phone only (below `md`) and only where the drawer exists; the old map and the computer are untouched.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Chrome = DrawerChromeContext.Provider as unknown as FunctionComponent<{ value: boolean; children?: ReactNode }>;

const USER = { name: "أحمد الكوري", username: "ahmad", email: "ahmad@example.test", avatarUrl: null };
const SPACE = { id: "w2", name: "الشحن", emoji: "🚚" };
const ROSTER: PresenceRosterDto = {
  people: [
    { userId: "u1", name: "سلمى عبيد", jobTitle: "محاسبة", role: "MEMBER", online: true },
    { userId: "u2", name: "أحمد زكي", jobTitle: null, role: "OWNER", online: true },
    { userId: "u3", name: "ليان مراد", jobTitle: "مبيعات", role: "MEMBER", online: true },
    { userId: "u4", name: "رنا حداد", jobTitle: null, role: "MEMBER", online: false },
  ],
  onlineCount: 3,
  total: 4,
};

function render(element: ReactElement, roster: PresenceRosterDto | null = ROSTER): string {
  const client = new QueryClient();
  client.setQueryData(["notifications"], { items: [], unreadCount: 0 });
  if (roster) client.setQueryData(["presence-dock", "space"], roster);
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(Toasts, null, element))));
}

const who = (role: NavRole, extra: Partial<NavSubject> = {}): NavSubject => ({ role, caps: [...effectiveCapabilities({ role })], navV2: true, ...extra });
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

function appBar(place: PlaceKey = "work", extra: Record<string, unknown> = {}): string {
  return render(
    createElement(AppBar, {
      nav: buildNav(who("MEMBER")),
      place,
      title: AR[`nav.place.${place}`] as string,
      pathname: "/my-work",
      audience: audienceOf({ isExternal: false, caps: [] }),
      user: USER,
      rank: "MEMBER" as NavRole,
      space: SPACE,
      newActions: ["message"],
      onOpenDrawer: () => {},
      ...extra,
    } as never),
  );
}

function shell(extra: Record<string, unknown> = {}, pathname = "/my-work", role: NavRole = "MEMBER"): string {
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
  );
}

function drawer(extra: Record<string, unknown> = {}): string {
  return render(
    createElement(Drawer, {
      open: true,
      onOpenChange: () => {},
      nav: buildNav(who("OWNER")),
      current: "work" as PlaceKey,
      pathname: "/my-work",
      user: USER,
      rank: "OWNER" as NavRole,
      isGuest: false,
      space: SPACE,
      portal: false,
      ...extra,
    } as never),
  );
}

const headOf = (html: string): string => html.slice(html.indexOf('data-shell="drawer-head"'), html.indexOf('data-shell="drawer-foot"'));

describe("the app bar on a phone: ☰, the title, a search icon, the bell, «+» (one row)", () => {
  const html = appBar();

  it("the search is ONE palette with an icon trigger on a phone and the wide bar from md up (never two palettes: both would answer Ctrl+K)", () => {
    expect(count(html, 'data-tour="search"')).toBe(1);
    const wrapper = /<div[^>]*data-tour="search"[^>]*>[\s\S]*?<\/div>/.exec(html)?.[0] ?? "";
    // the icon-only trigger is for phones, the wide one for md and up; both open the same palette
    expect(wrapper).toMatch(/<button[^>]*data-palette-trigger="icon"[^>]*class="[^"]*md:hidden/);
    expect(wrapper).toMatch(/<button[^>]*data-palette-trigger="bar"[^>]*class="[^"]*max-md:hidden/);
    expect(count(wrapper, `aria-label="${AR["pal.open"]}"`)).toBe(2);
    // the search no longer takes a line of its own under the title on a phone
    expect(html).not.toMatch(/data-tour="search"[^>]*class="[^"]*basis-full/);
  });

  it("the wide theme toggle and «؟» are for the computer only: their wrappers are hidden below md", () => {
    const theme = /<div[^>]*data-phone-hidden="theme"[^>]*>[\s\S]*?role="switch"/.exec(html);
    expect(theme?.[0]).toMatch(/class="[^"]*max-md:hidden/);
    const help = /<div[^>]*data-phone-hidden="help"[^>]*>[\s\S]*?؟/.exec(html);
    expect(help?.[0]).toMatch(/class="[^"]*max-md:hidden/);
    // …and the bell and «+» are not inside a hidden wrapper
    const actions = /<div[^>]*data-shell="app-bar-actions"[^>]*>/.exec(html)?.[0] ?? "";
    expect(actions).not.toContain("flex-wrap");
    expect(actions).toContain("shrink-0");
    expect(html.slice(html.indexOf('data-shell="app-bar-actions"'))).toContain(`aria-label="${AR["notif.title"]}"`);
  });

  it("the title may be cut (min-w-0 truncate) on a phone instead of pushing the actions onto another row", () => {
    const title = /<p[^>]*class="([^"]*)"[^>]*>\s*الشغل\s*<\/p>/.exec(html)?.[1] ?? "";
    expect(title).toContain("min-w-0");
    expect(title).toContain("truncate");
    expect(title).not.toMatch(/(^|\s)shrink-0(\s|$)/);
    expect(title).toContain("md:shrink-0");
  });

  it("every control keeps a 44px target", () => {
    expect(html).toMatch(/data-palette-trigger="icon"[^>]*class="[^"]*size-11/);
  });
});

describe("the presence bar leaves the phone's page and becomes a dot and a count in the drawer's header", () => {
  it("the strip is hidden below md (the computer keeps it)", () => {
    const out = render(createElement(PeopleDock, { enabled: true, hideOnPhone: true }));
    const root = /<div[^>]*class="([^"]*h-10[^"]*)"/.exec(out)?.[1] ?? "";
    expect(root).toContain("max-md:hidden");
    // without the prop (the old map) nothing changes
    const old = render(createElement(PeopleDock, { enabled: true }));
    expect(/<div[^>]*class="([^"]*h-10[^"]*)"/.exec(old)?.[1] ?? "").not.toContain("max-md:hidden");
  });

  it("the drawer variant is one small button: a green dot and the number, named in Arabic, no 40px row", () => {
    const out = render(createElement(PeopleDock, { enabled: true, variant: "drawer" }));
    const button = /<button[^>]*data-shell="drawer-presence"[^>]*>([\s\S]*?)<\/button>/.exec(out);
    expect(button).not.toBeNull();
    expect(button?.[0]).toContain("bg-ok");
    expect(button?.[1]).toContain(">3<");
    // the roster behind it still says who is online (the name of the count, in Arabic)
    expect(button?.[0]).toContain("3 متصلين");
    expect(out).not.toContain("h-10");
    expect(out).not.toContain("border-t");
  });

  it("a guest (enabled false) or an empty roster draws nothing", () => {
    expect(render(createElement(PeopleDock, { enabled: false, variant: "drawer" }))).not.toContain("drawer-presence");
    expect(render(createElement(PeopleDock, { enabled: true, variant: "drawer" }), { people: [], onlineCount: 0, total: 0 })).not.toContain("drawer-presence");
  });

  it("the drawer's header carries what the shell hands in as `presence`", () => {
    const out = drawer({ presence: createElement(PeopleDock, { enabled: true, variant: "drawer" }) });
    const head = headOf(out);
    expect(head).toContain('data-shell="drawer-presence"');
    expect(drawer({})).not.toContain("drawer-presence");
  });

  it("the shell hides the strip on a phone with the new map, and with the old map keeps it as it was", () => {
    const v2 = shell({ peopleDock: true });
    expect(/<div[^>]*class="([^"]*h-10[^"]*)"/.exec(v2)?.[1] ?? "").toContain("max-md:hidden");
    const old = shell({ navV2: false, peopleDock: true });
    expect(/<div[^>]*class="([^"]*h-10[^"]*)"/.exec(old)?.[1] ?? "").not.toContain("max-md:hidden");
  });

  it("the shell source hands the dot to the drawer and draws no strip for a phone's chat", () => {
    const src = read("src/components/app-shell.tsx");
    expect(src).toMatch(/presence=\{<PeopleDock variant="drawer"/);
    expect(src).toContain("hideOnPhone");
  });
});

describe("the theme toggle on a phone is an icon in the drawer's header", () => {
  it("one icon switch (role switch, an Arabic name, no word on screen) beside the presence dot", () => {
    const head = headOf(drawer({}));
    const button = /<button[^>]*data-shell="drawer-theme"[^>]*>([\s\S]*?)<\/button>/.exec(head);
    expect(button).not.toBeNull();
    expect(button?.[0]).toContain('role="switch"');
    expect(button?.[0]).toContain(`aria-label="${AR["themeSwitch.aria"]}"`);
    expect(button?.[1]).toContain("<svg");
    expect(button?.[1]).not.toContain(AR["themeSwitch.aria"] as string);
  });

  it("the dead phone cap of the effect switch is gone: the inline sizes always won, and the bar draws the effect switch from md only", () => {
    const css = read("src/components/theme/switch-fx/switch-fx.css");
    expect(css).not.toContain("@media (max-width: 767px)");
  });
});

describe("no round bubble over a phone's page", () => {
  const quick = (v2: boolean) =>
    render(createElement(Chrome, { value: v2 }, createElement(QuickChat, { enabled: true })));

  it("the quick chat's bubble is not drawn below md with the new map (and drops the old bottom-bar offset)", () => {
    const out = quick(true);
    expect(out).toContain('aria-expanded="false"');
    const root = /<div[^>]*class="([^"]*fixed[^"]*)"/.exec(out)?.[1] ?? "";
    expect(root).toContain("max-md:hidden");
    expect(root).not.toContain("3.5rem");
    expect(root).toContain("bottom-[18px]");
  });

  it("with the old map the bottom bar still exists, so the offset above it stays", () => {
    const root = /<div[^>]*class="([^"]*fixed[^"]*)"/.exec(quick(false))?.[1] ?? "";
    expect(root).toContain("bottom-[calc(3.5rem+0.75rem+env(safe-area-inset-bottom))]");
    expect(root).not.toContain("max-md:hidden");
  });
});

describe("ONE assistant button: the compass is in the drawer on a phone and floats only from md up", () => {
  const guide = (v2: boolean) => render(createElement(Chrome, { value: v2 }, createElement(SiteGuide, { enabled: true })));

  it("floating, it is hidden below md and clear of the rail; no stale 3.5rem anywhere in the file", () => {
    const root = /<button[^>]*class="([^"]*fixed[^"]*)"/.exec(guide(true))?.[1] ?? "";
    expect(root).toContain("max-md:hidden");
    expect(root).toContain("md:start-[calc(72px+18px)]");
    // with the old map the button sits above the bottom bar as it did
    const old = /<button[^>]*class="([^"]*fixed[^"]*)"/.exec(guide(false))?.[1] ?? "";
    expect(old).toContain("bottom-[calc(3.5rem+0.75rem+env(safe-area-inset-bottom))]");
    expect(old).not.toContain("max-md:hidden");
    const v2Root = /<button[^>]*class="([^"]*fixed[^"]*)"/.exec(guide(true))?.[1] ?? "";
    expect(v2Root).not.toContain("3.5rem");
  });

  it("the drawer has the row «المرشد» for the owner (a guide is handed in) and no row without it", () => {
    const out = drawer({ guide: true });
    const row = /<button[^>]*data-shell="drawer-guide"[^>]*>([\s\S]*?)<\/button>/.exec(out);
    expect(row).not.toBeNull();
    expect(row?.[1]).toContain(AR["siteGuide.open"] as string);
    expect(row?.[1]).toContain(AR["phoneChrome.guide_hint"] as string);
    expect(drawer({})).not.toContain("drawer-guide");
  });

  it("the row opens the guide through one event the guide listens to", () => {
    expect(typeof GUIDE_OPEN_EVENT).toBe("string");
    const guideSrc = read("src/components/site-guide/site-guide.tsx");
    expect(guideSrc).toContain("GUIDE_OPEN_EVENT");
    expect(guideSrc).toMatch(/addEventListener\(GUIDE_OPEN_EVENT/);
    expect(read("src/components/shell/drawer.tsx")).toMatch(/dispatchEvent\(new Event\(GUIDE_OPEN_EVENT\)\)/);
    expect(read("src/components/app-shell.tsx")).toMatch(/guide=\{!isGuest && siteGuide\}/);
  });

  it("the guide's open panel has no stale bottom-bar offset with the new map", () => {
    const src = read("src/components/site-guide/site-guide.tsx");
    expect(src).toMatch(/drawerChrome \? "bottom-\[calc\(0\.5rem\+env\(safe-area-inset-bottom\)\)\]"/);
  });
});

describe("room at the bottom for what still floats", () => {
  it("with the new map the page keeps room under it from md up while the quick chat or the guide floats over it", () => {
    expect(shell({ quickChat: true }, "/my-work")).toMatch(/<main[^>]*class="[^"]*md:pb-24/);
    expect(shell({ quickChat: false, siteGuide: true }, "/my-work")).toMatch(/<main[^>]*class="[^"]*md:pb-24/);
  });

  it("no room is kept when nothing floats (a guest, switches off) and none on the chat's own screen", () => {
    expect(shell({ quickChat: false, siteGuide: false }, "/my-work")).not.toMatch(/<main[^>]*class="[^"]*md:pb-24/);
    expect(shell({ quickChat: true }, "/my-work", "GUEST")).not.toMatch(/<main[^>]*class="[^"]*md:pb-24/);
    expect(shell({ quickChat: true }, "/chat")).not.toMatch(/<main[^>]*class="[^"]*md:pb-24/);
  });

  it("the old map's page is not given the room (as before)", () => {
    expect(shell({ navV2: false, quickChat: true }, "/my-work")).not.toMatch(/<main[^>]*class="[^"]*md:pb-24/);
  });
});

describe("toasts sit under the one-row bar", () => {
  it("the stack starts at the bar's one 56px row plus the notch (top-14 + the inset): exactly the bar's height now that the search line and the wrapped actions are gone", () => {
    const src = read("src/components/ui/toast.tsx");
    expect(src).toContain("top-14");
    expect(src).toContain("pt-[max(0.75rem,env(safe-area-inset-top))]");
    // the bar is one row: the same 44px targets as the toast's own, with 6px above and below
    expect(read("src/components/shell/app-bar.tsx")).toContain("py-1.5");
    // the action button of the forward sheet still works
    expect(src).toContain("data-toast-action");
  });
});

describe("«؟» and the guide with the one settings door", () => {
  const nav = buildNav(who("OWNER"));
  const guideHref = (opts?: { oneDoor?: boolean }) => paletteCommands(nav, opts).find((c) => c.id === "guide")?.href;

  it("the palette's guide entry opens the guide as today, and with settingsOneDoor ON the settings «المساعدة»", () => {
    expect(guideHref()).toBe("/guide");
    expect(guideHref({ oneDoor: false })).toBe("/guide");
    expect(guideHref({ oneDoor: true })).toBe("/settings/me/help");
  });
});

describe("the new strings", () => {
  it("are Arabic, registered, and have no Latin word", () => {
    for (const key of ["phoneChrome.tools", "phoneChrome.guide_hint", "phoneChrome.online_label"]) {
      expect(AR[key], key).toBeTruthy();
      expect((AR[key] ?? "").replace(/{[a-z]+}/g, ""), key).not.toMatch(/[A-Za-z]/);
    }
  });
});
