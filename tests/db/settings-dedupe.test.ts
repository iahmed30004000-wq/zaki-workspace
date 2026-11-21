import "./scoping-react";
import { describe, expect, it, vi } from "vitest";

const where = vi.hoisted(() => ({ pathname: "/settings/me" }));
// the pages call redirect() / notFound(); the client parts call useRouter() / usePathname(): no running Next app is needed here
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => where.pathname,
}));

import type { Prisma } from "@prisma/client";
import OwnerPage from "@/app/(app)/owner/page";
import AnalyticsPage from "@/app/(app)/analytics/page";
import SettingsPage from "@/app/(app)/settings/page";
import ProfilePage from "@/app/(app)/profile/page";
import SpacesPage from "@/app/(app)/spaces/page";
import CurrentSpacePage from "@/app/(app)/spaces/current/page";
import SpaceSettingsPage from "@/app/(app)/spaces/[id]/settings/page";
import AssistantSettingsPage from "@/app/(app)/owner/assistant/settings/page";
import SettingsMeLayout from "@/app/(app)/settings/me/layout";
import SettingsMeSectionPage from "@/app/(app)/settings/me/[section]/page";
import { withFeature, type FeatureKey } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { SettingsOneDoorContext } from "@/components/shell/nav-options";
import { getFirstSteps } from "@/server/services/first-steps";
import { requireActor } from "@/server/policy/actor";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { db, loginAs, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { readable, resolveServerTree } from "./today-helpers";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Door = SettingsOneDoorContext.Provider as unknown as FunctionComponent<{ value: boolean; children?: ReactNode }>;

/**
 * S3.3 — the duplicates of the findings (section A) are gone while «الإعدادات» is ONE door (switch `settingsOneDoor`), against a real PostgreSQL.
 *
 * What this pins:
 *  - every thing the findings name has ONE home: the feature switches, the company's name, the box's health, the system tokens, the AI connection, the reports and the space's people editor are each
 *    drawn on exactly one page of everything the owner can open (the walk renders them all and counts), and every old address that used to hold a copy leads to that home (no 404, no silent drop);
 *  - the links inside the moved bodies point at their home (the integrations' parts stay inside the settings frame), the spaces' board of «إعدادات الشركة» is a list with a gear;
 *  - the theme has ONE home (settings › «المظهر واللغة»), the guide none outside «المساعدة» (the first-steps card), «الناس» and «الأرشيف» keep one meaning and one name;
 *  - nobody gets a page they were not given: an admin's pages are the panel's own, the guard is untouched (the section pages still answer 404 where they did).
 * OFF (and the door without the panel) every one of these is today's, which the older tests of the area keep pinning untouched.
 */

async function setFeature(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

async function world(opts: { door?: boolean } = {}) {
  const t = await makeTeam();
  const lead = await makeUser({ orgId: t.org.id, role: "LEAD", name: "ليلى" });
  const space = await makeWorkspace(t.org.id, [{ userId: t.admin.id, role: "ADMIN" }, { userId: t.member.id }], "المبيعات");
  if (opts.door) {
    await setFeature(t.org.id, "settingsOneDoor", true);
    await setFeature(t.org.id, "controlPanelV2", true);
  }
  await setFeature(t.org.id, "ownerAssistant", true);
  await setFeature(t.org.id, "navV2", true);
  return { ...t, lead, space };
}

type World = Awaited<ReturnType<typeof world>>;
type Person = "owner" | "admin" | "lead" | "member" | "guest";

async function as(w: World, who: Person) {
  await loginAs(w[who].id);
}

type Outcome = { kind: "rendered"; text: string; markup: string } | { kind: "redirect"; to: string } | { kind: "not-found" };

/** Opens a page the way Next does: an element, a redirect or «not found» (anything else is a thrown error and fails the test). `door`: the app shell's context (the frame provides it once). */
async function open(page: () => Promise<React.ReactNode | void> | React.ReactNode, door = true): Promise<Outcome> {
  try {
    const tree = await resolveServerTree((await page()) as React.ReactNode);
    const markup = renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Toasts, null, createElement(Door, { value: door }, tree as ReactElement)))));
    return { kind: "rendered", markup, text: readable(markup) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("NEXT_REDIRECT:")) return { kind: "redirect", to: message.slice("NEXT_REDIRECT:".length) };
    if (message === "NEXT_NOT_FOUND") return { kind: "not-found" };
    throw err;
  }
}

const panel = (searchParams: Record<string, string> = {}, door = true) => open(() => OwnerPage({ searchParams }), door);
const section = (key: string, searchParams: Record<string, string> = {}, door = true) => {
  where.pathname = `/settings/me/${key}`;
  return open(() => SettingsMeSectionPage({ params: { section: key }, searchParams }), door);
};
const frame = (door = true) => {
  where.pathname = "/settings/me";
  return open(() => SettingsMeLayout({ children: createElement("p", null, "المحتوى") }), door);
};
const queryOf = (href: string): Record<string, string> => Object.fromEntries(new URLSearchParams(href.split("?")[1] ?? ""));
const hrefs = (markup: string): string[] => [...markup.matchAll(/href="([^"]*)"/g)].map((m) => (m[1] as string).replace(/&amp;/g, "&"));
const markupOf = (out: Outcome): string => (out.kind === "rendered" ? out.markup : "");

/** Follows what a redirect points at, to the page it opens. */
async function follow(to: string, door = true): Promise<Outcome> {
  if (to.startsWith("/owner")) return panel(queryOf(to), door);
  const match = /^\/settings\/me\/([a-z]+)/.exec(to);
  if (match) return section(match[1] as string, queryOf(to), door);
  throw new Error(`a redirect to somewhere unknown: ${to}`);
}

describe("S3.3 · ON: every duplicate has ONE home (the walk counts them on every page the owner can open)", () => {
  const MARKERS: { name: string; home: string; has: (markup: string, w: World) => boolean }[] = [
    { name: "the feature switches", home: "features", has: (m) => m.includes("data-feature-group=") },
    { name: "the company's name form", home: "company", has: (m, w) => m.includes(`value="${w.org.name}"`) },
    { name: "the box's health", home: "company", has: (m) => m.includes("data-server-health") },
    { name: "the system tokens", home: "company", has: (m) => m.includes('aria-labelledby="systok-title"') },
    { name: "the AI connection (the key's form)", home: "integrations?part=ai", has: (m) => m.includes('data-testid="ai-key"') },
    { name: "the reports", home: "reports", has: (m) => m.includes('data-testid="cp-reports-section"') },
  ];

  /** Every page of the settings frame and of the panel the owner can open, by name. */
  async function everyPage(): Promise<Record<string, Outcome>> {
    const pages: Record<string, Outcome> = {};
    for (const key of ["company", "features", "spaces"]) pages[key] = await section(key);
    for (const part of ["automation", "telegram", "ai"]) pages[`integrations?part=${part}`] = await section("integrations", { part });
    pages["overview"] = await panel();
    for (const part of ["accounts", "templates", "activity"]) pages[`people?part=${part}`] = await panel({ s: "people", part });
    pages["reports"] = await panel({ s: "reports" });
    for (const part of ["structure", "development"]) pages[`structure?part=${part}`] = await panel({ s: "structure", part });
    pages["archive"] = await panel({ s: "archive" });
    pages["assistant"] = await panel({ s: "assistant" });
    for (const key of ["account", "chat", "language", "help", "menu"]) pages[`me/${key}`] = await section(key);
    return pages;
  }

  it("each one is drawn on exactly one page, and it is the page the old copies lead to", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    const pages = await everyPage();
    for (const [name, out] of Object.entries(pages)) expect(out.kind, name).toBe("rendered");
    for (const marker of MARKERS) {
      const where = Object.entries(pages)
        .filter(([, out]) => marker.has(markupOf(out), w))
        .map(([name]) => name);
      expect(where, marker.name).toEqual([marker.home]);
    }
  });

  it("the old pages that held a copy lead to the home: /settings, /analytics, /owner?v=reports, /owner?v=ai, /owner/assistant/settings", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    // /settings (the switches, the name, the health, the tokens of the old page) → the first company section
    expect(await open(() => SettingsPage())).toEqual({ kind: "redirect", to: "/settings/me/company" });
    expect(await open(() => AnalyticsPage({}))).toEqual({ kind: "redirect", to: "/owner?s=reports" });
    expect(await panel({ v: "reports" })).toEqual({ kind: "redirect", to: "/owner?s=reports" });
    expect(await panel({ v: "ai" })).toEqual({ kind: "redirect", to: "/settings/me/integrations?part=ai" });
    expect(await open(() => AssistantSettingsPage({}))).toEqual({ kind: "redirect", to: "/settings/me/integrations?part=ai" });
    // the old panel sections that were settings
    for (const [s, to] of [["features", "/settings/me/features"], ["company", "/settings/me/company"], ["spaces", "/settings/me/spaces"], ["integrations", "/settings/me/integrations"]] as const) {
      const out = await panel({ s });
      expect(out, s).toEqual({ kind: "redirect", to });
      expect((await follow(to)).kind, to).toBe("rendered");
    }
  });

  it("an admin sees the same single homes, only the ones the panel offers: the AI form and the switches stay the owner's (404 for them), nothing is drawn twice", async () => {
    const w = await world({ door: true });
    await as(w, "admin");
    const spaces = await section("spaces");
    const integrations = await section("integrations", { part: "automation" });
    expect(spaces.kind).toBe("rendered");
    expect(integrations.kind).toBe("rendered");
    expect((await section("features")).kind).toBe("not-found");
    expect((await section("company")).kind).toBe("not-found");
    expect((await section("integrations", { part: "ai" })).kind).toBe("not-found");
    for (const out of [spaces, integrations]) {
      expect(markupOf(out)).not.toContain("data-feature-group=");
      expect(markupOf(out)).not.toContain('data-testid="ai-key"');
    }
  });
});

describe("S3.3 · ON: links inside the moved bodies stay inside the settings frame", () => {
  it("the parts of «التكاملات» are addresses of the frame, never of the panel; «بيانات الشركة» links to the switches in the frame", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    const integrations = await section("integrations", { part: "automation" });
    const parts = hrefs(markupOf(integrations)).filter((h) => h.includes("part="));
    expect(parts.length).toBeGreaterThanOrEqual(3);
    for (const h of parts) expect(h, h).toMatch(/^\/settings\/me\/integrations\?part=(automation|telegram|ai)$/);
    expect(hrefs(markupOf(integrations)).filter((h) => h.startsWith("/owner?s=integrations"))).toEqual([]);
    const company = await section("company");
    expect(hrefs(markupOf(company))).toContain("/settings/me/features");
    expect(hrefs(markupOf(company)).filter((h) => h.startsWith("/owner?s=features"))).toEqual([]);
  });

  it("OFF-side proof: the same bodies drawn by the panel itself (no door) keep the panel's own addresses", async () => {
    const w = await world({ door: false });
    await setFeature(w.org.id, "controlPanelV2", true);
    await as(w, "owner");
    const out = await panel({ s: "integrations", part: "automation" }, false);
    expect(hrefs(markupOf(out)).filter((h) => h.startsWith("/owner?s=integrations")).length).toBeGreaterThanOrEqual(3);
  });
});

describe("S3.3 · ON: space people are edited in ONE place, the space's own settings; the rest are links", () => {
  it("the spaces' board of «إعدادات الشركة» has a gear to each space's settings and no copy of rename, archive, delete or the people", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    const out = await section("spaces");
    const markup = markupOf(out);
    expect(hrefs(markup)).toContain(`/spaces/${w.space.id}/settings`);
    expect(markup).not.toContain(`${AR["spaces.card.actions"]}: المبيعات`);
    expect(markup).not.toContain(`${AR["spaces.delete.open"]}: المبيعات`);
    expect(markup).not.toContain("data-ws-members-panel");
  });

  it("the space's settings page holds the people editor, once, under the name «أعضاء المساحة»; «الناس» is not the tab's name", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    const out = await open(() => SpaceSettingsPage({ params: { id: w.space.id }, searchParams: { tab: "people" } }));
    const markup = markupOf(out);
    expect(markup.split("data-ws-members-panel").length - 1).toBe(1);
    expect(markup).toContain(`>${AR["spset.tab.people.one"]}<`);
    expect(markup).not.toContain(`>${AR["spset.tab.people"]}<`);
  });

  it("/spaces/current and /spaces lead to it (no second people editor, no dead end)", async () => {
    const w = await world({ door: true });
    await as(w, "admin");
    // the admin is in the space «المبيعات» as its manager: the old address of «المساحة» opens the settings page
    const here = await open(() => CurrentSpacePage());
    expect(["redirect", "rendered"]).toContain(here.kind);
    if (here.kind === "redirect") expect(here.to).toMatch(/^\/spaces\/[^/]+\/settings$/);
    expect(await open(() => SpacesPage({}))).toEqual({ kind: "redirect", to: "/settings/me/spaces" });
  });
});

describe("S3.3 · ON: the settings frame has no second door to the panel (its place is in the menu)", () => {
  it("the owner and an admin get the company's sections and no row to /owner; OFF nothing of the frame changes", async () => {
    const w = await world({ door: true });
    for (const who of ["owner", "admin"] as const) {
      await as(w, who);
      const f = await frame();
      expect(hrefs(markupOf(f)), who).not.toContain("/owner");
      expect(markupOf(f), who).not.toContain("data-settings-panel-link");
      expect(hrefs(markupOf(f)).some((h) => h.startsWith("/settings/me/integrations")), who).toBe(true);
    }
    const off = await world({});
    await as(off, "owner");
    expect(markupOf(await frame(false))).not.toContain("data-settings-groups");
  });
});

describe("S3.3 · ON: the theme and the digits have one home each, the guide only «المساعدة»", () => {
  it("the language section holds the theme and the digits, the chat section holds neither (a link says where); the section's name follows", async () => {
    const w = await world({ door: true });
    await as(w, "member");
    const language = markupOf(await section("language"));
    const chat = markupOf(await section("chat"));
    expect(language).toContain('id="c-theme"');
    expect(language).toContain('id="l-digits"');
    expect(language).toContain(AR["settingsMe.s.language.one"] as string);
    expect(chat).not.toContain('id="c-theme"');
    expect(hrefs(chat)).toContain("/settings/me/language");
    expect(chat).not.toContain(AR["settingsMe.s.chat.hint"] as string);
  });

  it("OFF both are exactly today's: the theme in the chat section, the old names", async () => {
    const w = await world({});
    await as(w, "member");
    const language = markupOf(await section("language", {}, false));
    const chat = markupOf(await section("chat", {}, false));
    expect(language).not.toContain('id="c-theme"');
    expect(chat).toContain('id="c-theme"');
    expect(language).toContain(AR["settingsMe.s.language.hint"] as string);
  });

  it("the guide: «المساعدة» keeps the one link; the first-steps card has no step for it (ON), and keeps it (OFF)", async () => {
    const on = await world({ door: true });
    await as(on, "member");
    const help = markupOf(await section("help"));
    expect(hrefs(help)).toContain("/guide");
    const steps = (await getFirstSteps(await requireActor())).steps;
    expect(steps.map((s) => s.id)).not.toContain("open-guide");
    expect(steps.find((s) => s.id === "theme")?.href).toBe("/settings/me/language");

    const off = await world({});
    await as(off, "member");
    const oldSteps = (await getFirstSteps(await requireActor())).steps;
    expect(oldSteps.map((s) => s.id)).toContain("open-guide");
    expect(oldSteps.find((s) => s.id === "theme")?.href).toBe("/guide/themes");
    // the switch without the panel it needs is not the door either
    const half = await world({});
    await setFeature(half.org.id, "settingsOneDoor", true);
    await as(half, "member");
    expect((await getFirstSteps(await requireActor())).steps.map((s) => s.id)).toContain("open-guide");
  });
});

describe("S3.3 · ON: «الناس» keeps one meaning and «الأرشيف» one name", () => {
  it("the activity part's table is «نشاط الناس»; the panel's navigation and the archive section say «الأرشيف»", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    const activity = markupOf(await panel({ s: "people", part: "activity" }));
    expect(activity).toContain(AR["cpv2.dd.people.activity_title"] as string);
    // the table's own title (the section's title above it, «الناس», stays: it is the section)
    const table = activity.slice(activity.indexOf('data-testid="ob-people"'));
    expect(table).toMatch(/^[^>]*><h2[^>]*>نشاط الناس<\/h2>/);
    const archive = markupOf(await panel({ s: "archive" }));
    expect(archive).toMatch(/data-panel-section="archive"[^>]*>الأرشيف</);
    expect(archive).toContain(`>${AR["cpv2.dd.nav.archive"]}<`);
    expect(archive).not.toContain("الأرشيف والرقابة");
    // the section's name is the only title: the body does not repeat it as «أرشيف المحادثات»
    expect(archive).not.toMatch(new RegExp(`<h2[^>]*>${AR["archive.title"]}</h2>`));
    expect(archive).toContain(AR["archive.subtitle"] as string);
  });

  it("OFF the panel is the eleven-section one with its old names", async () => {
    const w = await world({});
    await setFeature(w.org.id, "controlPanelV2", true);
    await as(w, "owner");
    const out = markupOf(await panel({ s: "archive" }, false));
    expect(out).toContain("الأرشيف والرقابة");
    expect(out).toMatch(new RegExp(`<h2[^>]*>${AR["archive.title"]}</h2>`));
  });
});

describe("S3.3 · the guard is untouched: nobody gets a page by the move", () => {
  it("a lead, a member and a guest are refused the company's sections and the panel as before", async () => {
    const w = await world({ door: true });
    for (const who of ["lead", "member", "guest"] as const) {
      await as(w, who);
      for (const key of ["company", "features", "integrations", "spaces"]) expect((await section(key)).kind, `${who} ${key}`).toBe("not-found");
    }
    // the archive is the owner rank's: an admin who types it gets «not found» (a member is sent to their own board, as always)
    await as(w, "admin");
    expect((await panel({ s: "archive" })).kind).toBe("not-found");
    await as(w, "member");
    expect((await panel({ s: "archive" })).kind).toBe("redirect");
    await as(w, "guest");
    expect((await open(() => ProfilePage())).kind).toBe("redirect");
  });
});
