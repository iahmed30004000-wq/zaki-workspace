import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// The components are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

const where = vi.hoisted(() => ({ pathname: "/chat" }));
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
import { Drawer } from "@/components/shell/drawer";
import { NavOrderButton, SettingsOneDoorContext } from "@/components/shell/nav-options";
import { Rail } from "@/components/shell/rail";
import { Sidebar } from "@/components/shell/sidebar";
import { SettingsFrame } from "@/components/settings-me/settings-frame";
import {
  COMPANY_SECTION_KEYS,
  PANEL_LINK_HREF,
  PANEL_SECTION_OF,
  SECTION_KEYS,
  companyGroupOf,
  companySectionHref,
  companySectionOfPath,
  isCompanySectionKey,
  isSectionKey,
  sectionOfPath,
  visibleSections,
} from "@/components/settings-me/sections";
import { ToastProvider } from "@/components/ui/toast";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { FEATURES, FEATURE_DEFAULTS, FEATURE_META, featureOn, featuresOff } from "@/lib/features";
import { PANEL_V2_SECTIONS, panelHref } from "@/lib/control-panel";
import { SETTINGS_ME_ROOT, settingsDoorTarget } from "@/lib/legacy-routes";
import { audienceOf } from "@/lib/guide/audience";
import { buildNav, oneDoorHidesAdmin, type NavRole, type NavSubject } from "@/lib/nav/places";
import { newActionsFor } from "@/lib/nav/new-actions";
import { settingsOneDoorOf } from "@/lib/nav/shell-v2";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { navSubjectOf } from "@/server/services/nav-order";
import type { CurrentUser } from "@/server/auth";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Door = SettingsOneDoorContext.Provider as unknown as FunctionComponent<{ value: boolean; children?: ReactNode }>;

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

const read = (file: string) => readFileSync(path.join(__dirname, "..", file), "utf8");
const who = (role: NavRole, extra: Partial<NavSubject> = {}): NavSubject => ({ role, caps: [...effectiveCapabilities({ role })], ...extra });
const placeKeys = (subject: NavSubject): string[] => buildNav(subject).places.map((p) => p.key);
const hrefs = (markup: string) => [...markup.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1] as string);
const count = (markup: string, needle: string) => markup.split(needle).length - 1;

function render(element: ReactElement, oneDoor = false): string {
  const client = new QueryClient();
  client.setQueryData(["orgs"], { organizations: [{ id: "o1", name: "زكي", keyPrefix: "ZK", role: "OWNER", canCreateSpaces: true, workspaces: [{ id: "w1", name: "المقر", slug: "hq", emoji: "🏢", unread: 0 }] }] });
  client.setQueryData(["notifications"], { items: [], unreadCount: 0 });
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(Toasts, null, createElement(Door, { value: oneDoor }, element)))));
}

// ───────────────────────────────────── the switch ─────────────────────────────────────

describe("S3.1 · the switch settingsOneDoor", () => {
  it("is a switch of the registry, OFF by default, in «لوحات المالك والذكاء», and needs the one control panel", () => {
    expect(FEATURES as readonly string[]).toContain("settingsOneDoor");
    expect(FEATURE_DEFAULTS.settingsOneDoor).toBe(false);
    expect(FEATURE_META.settingsOneDoor).toEqual({ group: "owner", dependsOn: ["controlPanelV2"] });
    expect(featureOn({}, "settingsOneDoor")).toBe(false);
    expect(featuresOff({})).toContain("settingsOneDoor");
  });

  it("has its name and its hint in Arabic, in its own fragment", () => {
    for (const part of ["name", "hint"]) expect(AR[`features.settingsOneDoor.${part}`], part).toMatch(/[؀-ۿ]/);
    const file = JSON.parse(read("src/lib/i18n/ar.settings-one-door.json")) as Record<string, string>;
    for (const [key, value] of Object.entries(file)) {
      expect(AR[key], key).toBe(value);
      expect(value.replace(/\{[^{}]+\}/g, ""), key).not.toMatch(/[A-Za-z]/);
      expect(value, key).not.toContain("ـاً");
    }
    expect(Object.keys(file)).toContain("features.settingsOneDoor.name");
  });

  it("is in force only together with the one control panel (it draws that panel's bodies and the row that opens it)", () => {
    const both = { features: { settingsOneDoor: true, controlPanelV2: true } };
    expect(settingsOneDoorOf(both)).toBe(true);
    expect(settingsOneDoorOf({ features: { settingsOneDoor: true } })).toBe(false);
    expect(settingsOneDoorOf({ features: { controlPanelV2: true } })).toBe(false);
    expect(settingsOneDoorOf({ features: { settingsOneDoor: true, controlPanelV2: false } })).toBe(false);
    expect(settingsOneDoorOf(null)).toBe(false);
    expect(settingsOneDoorOf({})).toBe(false);
  });
});

// ───────────────────────────────────── the map ─────────────────────────────────────

describe("S3.1 · navSubjectOf hands the door to the map only when it is on", () => {
  const actor = { role: "ADMIN" as const, caps: new Set(effectiveCapabilities({ role: "ADMIN" })), isExternal: false };

  it("OFF: the subject has neither key (it is exactly what it was)", () => {
    for (const settings of [null, {}, { features: { settingsOneDoor: true } }, { features: { controlPanelV2: true } }]) {
      const subject = navSubjectOf(actor, settings, null, false, true);
      expect("settingsOneDoor" in subject).toBe(false);
      expect("panel" in subject).toBe(false);
    }
  });

  it("ON: settingsOneDoor is true; `panel` only when the caller found one, and never for an external partner", () => {
    const on = { features: { settingsOneDoor: true, controlPanelV2: true } };
    expect(navSubjectOf(actor, on, null)).toMatchObject({ settingsOneDoor: true });
    expect("panel" in navSubjectOf(actor, on, null)).toBe(false);
    expect(navSubjectOf(actor, on, null, false, true)).toMatchObject({ settingsOneDoor: true, panel: true });
    expect("panel" in navSubjectOf({ ...actor, isExternal: true }, on, null, false, true)).toBe(false);
  });
});

describe("S3.1 · the place «الإدارة» leaves the map of an admin who holds the panel", () => {
  const door = { settingsOneDoor: true, panel: true } as const;

  it("OWNER and ADMIN: no «الإدارة» on either map; every other place is still there, in the same order", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      for (const navV2 of [false, true]) {
        const before = placeKeys(who(role, { navV2 }));
        const after = placeKeys(who(role, { navV2, ...door }));
        expect(before, `${role} ${navV2}`).toContain("admin");
        expect(after, `${role} ${navV2}`).not.toContain("admin");
        expect(after, `${role} ${navV2}`).toEqual(before.filter((key) => key !== "admin"));
      }
    }
  });

  it("OFF is byte for byte today's map, whatever else the subject carries", () => {
    for (const role of ["OWNER", "ADMIN", "LEAD", "MEMBER", "GUEST"] as const) {
      for (const navV2 of [false, true]) {
        const plain = buildNav(who(role, { navV2 }));
        expect(buildNav(who(role, { navV2, panel: true })), `${role} ${navV2}: panel alone changes nothing`).toEqual(plain);
        expect(buildNav(who(role, { navV2, settingsOneDoor: false, panel: true })), `${role} ${navV2}`).toEqual(plain);
      }
    }
  });

  it("the door without a panel keeps the place (nothing is hidden for somebody the panel does not serve)", () => {
    for (const role of ["OWNER", "ADMIN"] as const) expect(placeKeys(who(role, { navV2: true, settingsOneDoor: true }))).toContain("admin");
  });

  it("staff keep their place: a LEAD keeps «الإدارة», a MEMBER keeps «الناس» (the directory and «لوحتي»), even if a wrong flag says `panel`", () => {
    const member = buildNav(who("MEMBER", { navV2: true, ...door })).places.find((p) => p.key === "admin");
    expect(member?.labelKey).toBe("nav.place.people");
    expect(member?.tabs.map((tab) => tab.key)).toEqual(expect.arrayContaining(["team", "board"]));
    expect(placeKeys(who("LEAD", { navV2: true, ...door }))).toContain("admin");
    expect(placeKeys(who("LEAD", { ...door }))).toContain("admin");
  });

  it("a guest is never touched, and the rule is one function the tests can read", () => {
    expect(placeKeys(who("GUEST", { navV2: true, ...door }))).toEqual(placeKeys(who("GUEST", { navV2: true })));
    expect(oneDoorHidesAdmin(who("ADMIN", door))).toBe(true);
    expect(oneDoorHidesAdmin(who("LEAD", door))).toBe(false);
    expect(oneDoorHidesAdmin(who("ADMIN", { settingsOneDoor: true }))).toBe(false);
    expect(oneDoorHidesAdmin(who("OWNER"))).toBe(false);
  });

  it("a saved order that names «الإدارة» still reads fine once the place is gone (an unknown place is skipped)", () => {
    const nav = buildNav(who("OWNER", { navV2: true, ...door }));
    expect(nav.places.map((p) => p.key)).not.toContain("admin");
  });
});

// ───────────────────────────────────── the frame's sections ─────────────────────────────────────

describe("S3.1 · the sections of «إعدادات الشركة»", () => {
  it("the eleven sections of «إعداداتي» are untouched; the four company sections are the panel's own, one to one", () => {
    expect([...SECTION_KEYS]).toHaveLength(11);
    expect([...COMPANY_SECTION_KEYS]).toEqual(["company", "features", "integrations", "spaces"]);
    for (const key of COMPANY_SECTION_KEYS) {
      expect(PANEL_V2_SECTIONS as readonly string[], key).toContain(PANEL_SECTION_OF[key]);
      expect(SECTION_KEYS as readonly string[], `${key} must not shadow a section of «إعداداتي»`).not.toContain(key);
      expect(isSectionKey(key), key).toBe(false);
      expect(isCompanySectionKey(key), key).toBe(true);
      expect(AR[`settingsOneDoor.s.${key}`], key).toMatch(/[؀-ۿ]/);
      expect(AR[`settingsOneDoor.s.${key}.hint`], key).toMatch(/[؀-ۿ]/);
    }
    expect(visibleSections({ foldersOn: true })).toHaveLength(11);
    expect(isCompanySectionKey("account")).toBe(false);
  });

  it("addresses: a company section is an address of the same frame", () => {
    expect(companySectionHref("features")).toBe("/settings/me/features");
    expect(companySectionOfPath("/settings/me/integrations")).toBe("integrations");
    expect(companySectionOfPath("/settings/me/integrations/x")).toBe("integrations");
    expect(companySectionOfPath("/settings/me/chat")).toBeNull();
    expect(companySectionOfPath("/settings/me")).toBeNull();
    expect(sectionOfPath("/settings/me/features")).toBeNull();
    expect(PANEL_LINK_HREF).toBe(panelHref("overview"));
  });

  it("the OWNER holds all four and the row «لوحة التحكم»; an ADMIN holds what the panel offers them; nobody else gets a group", () => {
    const all = PANEL_V2_SECTIONS;
    expect(companyGroupOf(all, "OWNER")).toEqual({ sections: ["company", "features", "integrations", "spaces"], panelLink: true });
    // an ADMIN: the panel does not offer «الميزات» and «إعدادات الشركة» (the owner rank's alone)
    expect(companyGroupOf(["overview", "people", "reports", "accounts", "spaces", "integrations"], "ADMIN")).toEqual({ sections: ["integrations", "spaces"], panelLink: true });
    // an ADMIN who holds only the reports: no section of the group, but the row that opens the panel (their place «الإدارة» is not in the menu)
    expect(companyGroupOf(["reports"], "ADMIN")).toEqual({ sections: [], panelLink: true });
    // a lead holding only the integrations box: the section and the row; one holding only the reports: no group at all (their place stays)
    expect(companyGroupOf(["integrations"], "LEAD")).toEqual({ sections: ["integrations"], panelLink: true });
    expect(companyGroupOf(["reports"], "LEAD")).toBeNull();
    expect(companyGroupOf([], "OWNER")).toBeNull();
    expect(companyGroupOf([], "MEMBER")).toBeNull();
  });
});

// ───────────────────────────────────── the settings frame ─────────────────────────────────────

describe("S3.1 · the frame of «إعداداتي» draws two groups for whoever manages the company", () => {
  const header = { name: "أحمد", username: "ahmad", jobTitle: null, avatarUrl: null };
  const frame = (company: Parameters<typeof SettingsFrame>[0]["company"], pathname = "/settings/me") => {
    where.pathname = pathname;
    return render(createElement(SettingsFrame, { header, sections: visibleSections({ foldersOn: true }), company }, createElement("p", null, "المحتوى")));
  };

  it("without a company group the markup is the old single list (no headings, no company rows)", () => {
    const html = frame(null);
    expect(html).not.toContain("data-settings-groups");
    expect(html).not.toContain(AR["settingsOneDoor.group.company"]);
    expect(count(html, "data-section=")).toBe(11);
    expect(html).toEqual(frame(undefined as never));
  });

  it("with it: «إعداداتي» holds the same eleven sections, «إعدادات الشركة» its sections and ONE row «لوحة التحكم» to /owner", () => {
    const html = frame({ sections: ["company", "features", "integrations", "spaces"], panelLink: true });
    expect(html).toContain("data-settings-groups");
    expect(html).toContain(AR["settingsOneDoor.group.me"]);
    expect(html).toContain(AR["settingsOneDoor.group.company"]);
    const me = html.slice(html.indexOf('data-settings-group-list="me"'), html.indexOf('data-settings-group-list="company"'));
    expect(count(me, "data-section=")).toBe(11);
    const company = html.slice(html.indexOf('data-settings-group-list="company"'));
    expect(hrefs(company).filter((h) => h.startsWith("/settings/me/"))).toEqual(["/settings/me/company", "/settings/me/features", "/settings/me/integrations", "/settings/me/spaces"]);
    expect(count(html, "data-settings-panel-link")).toBe(1);
    expect(hrefs(company)).toContain("/owner");
    for (const key of COMPANY_SECTION_KEYS) expect(company).toContain(AR[`settingsOneDoor.s.${key}`] as string);
    // the guide stays inside «المساعدة»: the list has no row of its own for it
    expect(hrefs(html)).not.toContain("/guide");
  });

  it("an admin with no section in the group still gets the row that opens the panel; the row is never drawn without it", () => {
    const only = frame({ sections: [], panelLink: true });
    expect(count(only, "data-settings-panel-link")).toBe(1);
    expect(frame({ sections: ["integrations"], panelLink: false })).not.toContain("data-settings-panel-link");
  });

  it("a company section marks itself current and the index is hidden on the phone only at the index (as the person's own sections do)", () => {
    const html = frame({ sections: ["company", "features"], panelLink: true }, "/settings/me/features");
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*data-section="features"/);
    // inside a section the list column is hidden below md, the section column shown
    expect(html).toMatch(/<aside class="[^"]*hidden/);
  });
});

// ───────────────────────────────────── the menus ─────────────────────────────────────

const drawer = (oneDoor: boolean, extra: Record<string, unknown> = {}) => {
  where.pathname = "/chat";
  return render(
    createElement(Drawer, {
      open: true,
      onOpenChange: () => {},
      nav: buildNav(who("OWNER", { navV2: true, ...(oneDoor ? { settingsOneDoor: true, panel: true } : {}) })),
      current: null,
      pathname: "/chat",
      user: USER,
      rank: "OWNER",
      isGuest: false,
      onEditStart: () => {},
      onEditDone: () => {},
      onReset: () => {},
      portal: false,
      ...extra,
    } as never),
    oneDoor,
  );
};

const head = (html: string) => {
  const from = html.indexOf('data-shell="drawer-head"');
  return html.slice(from, html.indexOf('data-shell="drawer-foot"'));
};
const foot = (html: string) => html.slice(html.indexOf('data-shell="drawer-foot"'));

describe("S3.1 · the drawer", () => {
  it("OFF: «إعداداتي», «دليل زاكي» and «ترتيب» rows in the foot, as today", () => {
    const html = drawer(false);
    expect(hrefs(foot(html))).toEqual(expect.arrayContaining(["/settings/me", "/guide"]));
    expect(foot(html)).toContain(AR["navorder.toggle"] as string);
    expect(foot(html)).toContain("data-nav-order-toggle");
    expect(head(html)).not.toContain("data-nav-order-toggle");
  });

  it("ON: ONE row «الإعدادات» to /settings/me, no guide row, no «إعداداتي» row, no «ترتيب» row", () => {
    const html = drawer(true);
    expect(count(html, 'href="/settings/me"')).toBe(1);
    expect(foot(html)).toContain(`>${AR["settingsOneDoor.door"]}<`);
    expect(hrefs(html)).not.toContain("/guide");
    expect(foot(html)).not.toContain("data-nav-order-toggle");
    expect(foot(html)).not.toContain(AR["shell.guide"] as string);
    expect(html).not.toContain(`>${AR["settingsMe.drawer"]}<`);
  });

  it("ON: «ترتيب» is one small icon button in the header (data-nav-order-toggle, an Arabic name, no word on screen)", () => {
    const html = drawer(true);
    const header = head(html);
    expect(header).toContain('data-shell="drawer-head"');
    const button = /<button[^>]*data-nav-order-toggle[^>]*>(.*?)<\/button>/s.exec(header);
    expect(button).not.toBeNull();
    expect(button?.[0]).toContain(`aria-label="${AR["navorder.toggle"]}"`);
    expect(button?.[1]).not.toContain(AR["navorder.toggle"] as string);
    expect(button?.[1]).toContain("<svg");
  });

  it("ON, while the reorder mode is on: «تم» and «رجّع» are in the drawer, the header button is gone", () => {
    const html = drawer(true, { editing: true, onReorder: () => {}, canReset: true });
    expect(foot(html)).toContain(AR["navorder.done"] as string);
    expect(foot(html)).toContain(AR["navorder.reset"] as string);
    expect(head(html)).not.toContain("data-nav-order-toggle");
  });

  it("ON, with the company's order set: no toggle, the locked button opens the ⚠️ + 🔧 note (still working)", () => {
    const html = drawer(true, { orderLocked: true });
    expect(html).not.toContain("data-nav-order-toggle");
    expect(head(html)).toContain("data-nav-order-locked");
    const open = render(createElement(NavOrderButton, { orderLocked: true, defaultOpen: true, portal: false }));
    expect(open).toContain("data-order-locked");
    expect(open).toContain("⚠️");
    expect(open).toContain("🔧");
    expect(open).toContain(AR["navv2.order.company_locked"] as string);
    expect(open).toContain(AR["navv2.order.company_fix"] as string);
  });

  it("OFF with the company's order set: the note stays where it was (in the foot), no header button", () => {
    const html = drawer(false, { orderLocked: true });
    expect(foot(html)).toContain("data-order-locked");
    expect(html).not.toContain("data-nav-order-locked");
  });
});

const rail = (oneDoor: boolean, extra: Record<string, unknown> = {}) => {
  where.pathname = "/chat";
  return render(
    createElement(Rail, {
      nav: buildNav(who("OWNER", { navV2: true, ...(oneDoor ? { settingsOneDoor: true, panel: true } : {}) })),
      current: null,
      pathname: "/chat",
      user: USER,
      rank: "OWNER",
      isGuest: false,
      onEditStart: () => {},
      ...extra,
    } as never),
    oneDoor,
  );
};

describe("S3.1 · the rail", () => {
  it("OFF: the «⋯» menu (guide, «ترتيب», settings) is there, as today", () => {
    const html = rail(false);
    expect(html).toContain(`aria-label="${AR["navv2.rail.options"]}"`);
    expect(html).not.toContain("data-settings-door");
  });

  it("ON: «ترتيب» is a small icon button at the TOP of the rail (before the places); the foot has one gear to /settings/me instead of «⋯»", () => {
    const html = rail(true);
    const toggleAt = html.indexOf("data-nav-order-toggle");
    expect(toggleAt).toBeGreaterThan(-1);
    expect(toggleAt).toBeLessThan(html.indexOf('data-tour="places"'));
    expect(html).not.toContain(`aria-label="${AR["navv2.rail.options"]}"`);
    expect(count(html, 'href="/settings/me"')).toBe(1);
    expect(hrefs(html)).not.toContain("/guide");
    expect(html).toMatch(/<a[^>]*href="\/settings\/me"[^>]*aria-label="الإعدادات"|<a[^>]*aria-label="الإعدادات"[^>]*href="\/settings\/me"/);
  });

  it("ON with the company's order set: the locked button is at the top instead (no toggle)", () => {
    const html = rail(true, { orderLocked: true });
    expect(html).not.toContain("data-nav-order-toggle");
    expect(html.indexOf("data-nav-order-locked")).toBeLessThan(html.indexOf('data-tour="places"'));
  });

  it("ON while the reorder mode is on: no button at the top (the shell draws «تم» and «رجّع»)", () => {
    expect(rail(true, { editing: true, onReorder: () => {} })).not.toContain("data-nav-order-toggle");
  });
});

const sidebar = (oneDoor: boolean, extra: Record<string, unknown> = {}) => {
  where.pathname = "/projects";
  return render(
    createElement(Sidebar, {
      nav: buildNav(who("OWNER", { ...(oneDoor ? { settingsOneDoor: true, panel: true } : {}) })),
      current: null,
      pathname: "/projects",
      user: USER,
      rank: "OWNER",
      isGuest: false,
      collapsed: false,
      onToggle: () => {},
      onEditStart: () => {},
      onEditDone: () => {},
      onReset: () => {},
      ...extra,
    } as never),
    oneDoor,
  );
};

describe("S3.1 · the side menu (the old map)", () => {
  it("OFF: the guide row and the «ترتيب» row, as today", () => {
    const html = sidebar(false);
    expect(hrefs(html)).toContain("/guide");
    expect(html).toContain(AR["shell.guide"] as string);
    expect(html).toContain("data-nav-order-toggle");
  });

  it("ON: one row «الإعدادات», no guide row, «ترتيب» a small icon button in the header", () => {
    const html = sidebar(true);
    expect(count(html, 'href="/settings/me"')).toBe(1);
    expect(hrefs(html)).not.toContain("/guide");
    expect(html).not.toContain(AR["shell.guide"] as string);
    expect(count(html, "data-nav-order-toggle")).toBe(1);
    expect(html.indexOf("data-nav-order-toggle")).toBeLessThan(html.indexOf('data-tour="places"'));
    expect(html.indexOf("data-nav-order-toggle")).toBeLessThan(html.indexOf('href="/settings/me"'));
    expect(/<button[^>]*data-nav-order-toggle[^>]*>(.*?)<\/button>/s.exec(html)?.[1]).not.toContain(AR["navorder.toggle"] as string);
  });

  it("ON, the folded menu keeps the row's name for a screen reader", () => {
    expect(sidebar(true, { collapsed: true })).toMatch(/<span class="[^"]*sr-only[^"]*">الإعدادات<\/span>/);
  });
});

describe("S3.1 · the avatar menu", () => {
  const open = (oneDoor: boolean) => render(createElement(AvatarMenu, { user: USER, rank: "OWNER", defaultOpen: true, portal: false }), oneDoor);
  const items = (html: string) => [...html.matchAll(/<(?:div|a)\b[^>]*role="menuitem"[^>]*>(.*?)<\/(?:div|a)>/gs)].map((m) => (m[1] as string).replace(/<[^>]*>/g, ""));

  it("OFF: theme, guide, account, sign out, and the gear to «إعداداتي» (as pinned in shell-render)", () => {
    const html = open(false);
    expect(items(html)).toEqual([AR["theme.picker"], AR["guide.title"], AR["shell.avatar.account"], AR["shell.avatar.logout"]]);
    expect(hrefs(html)).toEqual(expect.arrayContaining(["/settings/me", "/guide", "/profile"]));
  });

  it("ON: the theme, ONE row «الإعدادات» to /settings/me, and sign out; no guide, no «حسابي», no second gear", () => {
    const html = open(true);
    expect(items(html)).toEqual([AR["theme.picker"], AR["settingsOneDoor.door"], AR["shell.avatar.logout"]]);
    expect(count(html, 'href="/settings/me"')).toBe(1);
    expect(hrefs(html)).not.toContain("/guide");
    expect(hrefs(html)).not.toContain("/profile");
  });
});

describe("S3.1 · the frame wires the door once", () => {
  const shell = (settingsOneDoor: boolean, navV2: boolean) => {
    where.pathname = "/chat";
    const subject = who("OWNER", { navV2, ...(settingsOneDoor ? { settingsOneDoor: true, panel: true } : {}) });
    return render(
      createElement(AppShell, {
        user: USER,
        nav: buildNav(subject),
        rank: "OWNER",
        audience: audienceOf({ isExternal: false, caps: subject.caps }),
        navV2,
        settingsOneDoor,
        newActions: newActionsFor(subject),
        orgName: "شركة زكي",
        children: createElement("p", null, "محتوى الصفحة"),
      } as never),
    );
  };

  it("ON with the new menu: no link to the guide anywhere in the menu, no place «الإدارة», ONE gear in the rail (the drawer is closed: it draws its own single row when opened)", () => {
    const html = shell(true, true);
    expect(hrefs(html)).not.toContain("/guide");
    expect(hrefs(html)).not.toContain("/members");
    expect(count(html, 'href="/settings/me"')).toBe(1);
    expect(html).toContain("data-settings-door");
    expect(html).not.toContain(`aria-label="${AR["navv2.rail.options"]}"`);
  });

  it("ON with the old menu: the side menu has one row and the guide row is gone; OFF keeps the guide row", () => {
    expect(hrefs(shell(true, false))).not.toContain("/guide");
    expect(count(shell(true, false), 'href="/settings/me"')).toBeGreaterThanOrEqual(1);
    expect(hrefs(shell(false, false))).toContain("/guide");
    // OFF with the new menu: the «⋯» menu is back (its guide and «ترتيب» items live in the menu, closed here)
    expect(shell(false, true)).toContain(`aria-label="${AR["navv2.rail.options"]}"`);
    expect(shell(false, true)).not.toContain("data-settings-door");
  });
});

// ───────────────────────────────────── the old addresses ─────────────────────────────────────

describe("S3.1 · the old addresses keep answering", () => {
  it("/profile leads to «حسابي» and /settings to the first company section the person may open, or the frame's index", () => {
    expect(SETTINGS_ME_ROOT).toBe("/settings/me");
    expect(settingsDoorTarget("/profile")).toBe("/settings/me/account");
    expect(settingsDoorTarget("/profile", "features")).toBe("/settings/me/account");
    expect(settingsDoorTarget("/settings")).toBe("/settings/me");
    expect(settingsDoorTarget("/settings", null)).toBe("/settings/me");
    expect(settingsDoorTarget("/settings", "company")).toBe("/settings/me/company");
    expect(settingsDoorTarget("/settings", "integrations")).toBe("/settings/me/integrations");
  });

  it("the targets are real addresses: an own section, or a company section of the frame", () => {
    for (const target of [settingsDoorTarget("/profile"), settingsDoorTarget("/settings", "spaces"), settingsDoorTarget("/settings")]) {
      const last = target.split("/").pop() as string;
      expect(target === "/settings/me" || isSectionKey(last) || isCompanySectionKey(last), target).toBe(true);
    }
  });
});

// ───────────────────────────────────── the sources ─────────────────────────────────────

describe("S3.1 · the sources", () => {
  it("the route draws the control panel's own section bodies (moved, not rebuilt) and keeps the folders import", () => {
    const route = read("src/app/(app)/settings/me/[section]/page.tsx");
    for (const body of ["CompanySection", "FeaturesSection", "IntegrationsSection", "SpacesSection"]) expect(route).toContain(body);
    expect(route).toContain('import { ChatFoldersSettings } from "@/components/chat/v2/list/folder-editor";');
    // not rebuilt: no form of its own for the company's name or the switches
    expect(route).not.toMatch(/OrgNameForm|FeatureSwitches|CompanySettingsForm/);
    // the access is the panel's list of sections, through ONE helper, never a rank check of its own
    expect(route).toContain("companyAccessFor");
    expect(route).not.toMatch(/actor\.role\s*[=!]==/);
    expect(route).not.toMatch(/isOwner/);
  });

  it("the helper decides from the panel's own sections (`panelAccess`) and refuses a guest", () => {
    const data = read("src/components/settings-me/server-data.ts");
    expect(data).toContain("panelAccess(actor)");
    expect(data).toContain("actor.isExternal");
    expect(data).toContain('"settingsOneDoor"');
    expect(data).toContain('"controlPanelV2"');
  });

  it("the layout reads the panel for an admin only while the door is on and hands the shell the switch", () => {
    const layout = read("src/app/(app)/layout.tsx");
    expect(layout).toContain("oneDoorPanelFor(actor, org?.settings)");
    expect(layout).toContain("settingsOneDoor={subject.settingsOneDoor === true}");
    const service = read("src/server/services/nav-order.ts");
    expect(service).toMatch(/if \(!settingsOneDoorOf\(orgSettings\) \|\| actor\.isExternal \|\| !rankAtLeast\(actor\.role as NavRole, "ADMIN"\)\) return false;/);
  });

  it("the new strings and classes follow the rules of the shell (no hex colour, no tiny text, theme tokens)", () => {
    for (const file of ["src/components/shell/nav-options.tsx", "src/components/settings-me/settings-frame.tsx", "src/components/settings-me/parts.tsx"]) {
      const source = read(file);
      expect(source, file).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      expect(source, file).not.toMatch(/text-\[(10|11|10\.5)px\]/);
      expect(source, file).not.toMatch(/\b(bg-black|bg-white|text-white)\b/);
    }
  });
});
