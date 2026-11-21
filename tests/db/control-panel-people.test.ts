import "./scoping-react";
import { describe, expect, it, vi } from "vitest";

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
  usePathname: () => "/owner",
}));

import type { Prisma } from "@prisma/client";
import OwnerPage from "@/app/(app)/owner/page";
import AnalyticsPage from "@/app/(app)/analytics/page";
import MembersPage from "@/app/(app)/members/page";
import SpacesPage from "@/app/(app)/spaces/page";
import StructurePage from "@/app/(app)/structure/page";
import DevelopmentPage from "@/app/(app)/development/page";
import AutomationPage from "@/app/(app)/automation/page";
import TelegramPage from "@/app/(app)/telegram/page";
import ArchivePage from "@/app/(app)/archive/page";
import AssistantPage from "@/app/(app)/owner/assistant/page";
import AssistantSettingsPage from "@/app/(app)/owner/assistant/settings/page";
import SettingsMeSectionPage from "@/app/(app)/settings/me/[section]/page";
import { withFeature, type FeatureKey } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { PANEL_ONE_NAV, PEOPLE_PARTS, myBoardHref } from "@/lib/control-panel";
import { PANEL_REDIRECT_ADDRESSES, panelRedirectHref } from "@/lib/legacy-routes";
import { requireActor } from "@/server/policy/actor";
import { panelAccess, panelOneDoorOn, panelRedirectFor } from "@/server/services/control-panel";
import { visibleNavFor } from "@/server/services/nav-order";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { db, loginAs, makeTeam, makeUser } from "./helpers";
import { readable, resolveServerTree } from "./today-helpers";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;

/**
 * S3.2 — «لوحة التحكم» as its own place with ONE navigation, and «الناس» as ONE section (switch `settingsOneDoor`), against a real PostgreSQL.
 *
 * What this pins:
 *  - OFF (and ON without the one control panel it needs): the panel is the eleven-section list it was, `/members` still leads to «الحسابات والصلاحيات»;
 *  - ON: the panel draws ONE list of six entries for the owner (the capability guard is the panel's own: an admin gets «الناس» and «التقارير», a team lead the overview and the people,
 *    a member nothing, a guest «not found»); «الناس» is one section whose parts (accounts, templates, activity) each hold the old body, a part a person may not open is «not found»;
 *  - every old address still opens the right place with its query: `/members?new=person` lands on the part, `/analytics` on the reports, the settings addresses on «إعدادات الشركة»;
 *    the walk follows each redirect and the target answers (no dead end);
 *  - the place «لوحة التحكم» is the slot of an admin who holds the panel, and nobody else's map changes.
 */

async function setFeature(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

async function world(opts: { door?: boolean; panel?: boolean } = {}) {
  const t = await makeTeam();
  const lead = await makeUser({ orgId: t.org.id, role: "LEAD", name: "ليلى" });
  const partner = await makeUser({ orgId: t.org.id, role: "OWNER", name: "الشريك" });
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: t.org.id, userId: partner.id } }, data: { primaryOwner: false } });
  if (opts.door) await setFeature(t.org.id, "settingsOneDoor", true);
  if (opts.panel ?? opts.door) await setFeature(t.org.id, "controlPanelV2", true);
  await setFeature(t.org.id, "ownerAssistant", true);
  await setFeature(t.org.id, "navV2", true);
  return { ...t, lead, partner };
}

type World = Awaited<ReturnType<typeof world>>;
type Person = "owner" | "admin" | "lead" | "member" | "guest" | "partner";

async function as(w: World, who: Person) {
  await loginAs(w[who].id);
}

type Outcome = { kind: "rendered"; text: string; markup: string } | { kind: "redirect"; to: string } | { kind: "not-found" };

/** Opens a page the way Next does: an element, a redirect or «not found» (anything else is a thrown error and fails the test). */
async function open(page: () => Promise<React.ReactNode | void> | React.ReactNode): Promise<Outcome> {
  try {
    const tree = await resolveServerTree((await page()) as React.ReactNode);
    const markup = renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Toasts, null, tree as ReactElement))));
    return { kind: "rendered", markup, text: readable(markup) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("NEXT_REDIRECT:")) return { kind: "redirect", to: message.slice("NEXT_REDIRECT:".length) };
    if (message === "NEXT_NOT_FOUND") return { kind: "not-found" };
    throw err;
  }
}

const owner = (searchParams: Record<string, string> = {}) => open(() => OwnerPage({ searchParams }));
const settingsSection = (key: string, searchParams: Record<string, string> = {}) => open(() => SettingsMeSectionPage({ params: { section: key }, searchParams }));
const listed = (markup: string): string[] => [...markup.matchAll(/data-panel-section="([a-z]+)"/g)].map((m) => m[1] as string);
const partsOf = (markup: string): string[] => [...markup.matchAll(/data-panel-part="([a-z]+)"/g)].map((m) => m[1] as string);
const queryOf = (href: string): Record<string, string> => Object.fromEntries(new URLSearchParams(href.split("?")[1] ?? ""));

/** Follows what a redirect points at: the panel or the settings frame, and returns how the target answered. */
async function follow(to: string): Promise<Outcome> {
  if (to.startsWith("/owner")) return owner(queryOf(to));
  const match = /^\/settings\/me\/([a-z]+)/.exec(to);
  if (match) return settingsSection(match[1] as string, queryOf(to));
  throw new Error(`a redirect to somewhere unknown: ${to}`);
}

describe("S3.2 · OFF: the panel is the eleven-section list it was", () => {
  it("the switch alone without the one control panel changes nothing; with the panel and without the door the owner has eleven entries and /members leads to the accounts section", async () => {
    const w = await world({ door: true, panel: false });
    await as(w, "owner");
    expect(await panelOneDoorOn((await requireActor()))).toBe(false);
    const w2 = await world({ panel: true });
    await as(w2, "owner");
    expect(await panelOneDoorOn(await requireActor())).toBe(false);
    const page = await owner();
    expect(page.kind).toBe("rendered");
    if (page.kind === "rendered") {
      expect(listed(page.markup)).toHaveLength(11);
      expect(page.markup).not.toContain("data-panel-one");
    }
    expect(await open(() => MembersPage({}))).toEqual({ kind: "redirect", to: "/owner?s=accounts" });
    expect(await open(() => SpacesPage({}))).toEqual({ kind: "redirect", to: "/owner?s=spaces" });
    // the old section keys still open as sections
    for (const s of ["accounts", "features", "company", "people"]) expect((await owner({ s })).kind, s).toBe("rendered");
  });

  it("OFF keeps the place «الإدارة» with its tabs for the owner", async () => {
    const w = await world({ panel: true });
    await as(w, "owner");
    const place = (await visibleNavFor(await requireActor())).places.find((p) => p.key === "admin");
    expect(place?.labelKey).toBe("nav.place.admin");
    expect(place?.tabs.length).toBeGreaterThan(1);
  });
});

describe("S3.2 · ON: ONE navigation", () => {
  it("the owner sees exactly the six entries, in order, named as the owner asked, in ONE list; nothing else in the page repeats them", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    const page = await owner();
    expect(page.kind).toBe("rendered");
    if (page.kind !== "rendered") return;
    expect(listed(page.markup)).toEqual([...PANEL_ONE_NAV]);
    expect(page.markup).toContain("data-panel-one");
    expect(page.markup.match(/data-testid="cp-side-list"/g)?.length).toBe(1);
    expect(page.markup.match(/<nav\b/g)?.length).toBe(1);
    // S3.3 (deliberate change): the archive's entry is called «الأرشيف» (`cpv2.dd.nav.archive`), the same word as the menu's tab; the other five keep S3.2's names
    for (const key of PANEL_ONE_NAV) expect(page.text).toContain((key === "archive" ? AR["cpv2.dd.nav.archive"] : AR[`cpone.nav.${key}`]) as string);
    // the settings sections and «الحسابات» are not entries
    for (const gone of ["accounts", "spaces", "features", "integrations", "company"]) expect(listed(page.markup)).not.toContain(gone);
    expect(await panelOneDoorOn(await requireActor())).toBe(true);
  });

  it("each of the six entries opens (the owner), and the structure section wears the navigation's name", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    for (const s of PANEL_ONE_NAV) {
      const out = await owner({ s });
      expect(out.kind, s).toBe("rendered");
      if (out.kind === "rendered") expect(out.markup, s).toContain(`data-section="${s}"`);
    }
    const structure = await owner({ s: "structure" });
    expect(structure.kind === "rendered" ? structure.text : "").toContain("الهيكل والأداء");
    expect(structure.kind === "rendered" ? structure.text : "").not.toContain("الهيكل والتطوير");
  });

  it("an admin gets «الناس» (the accounts) and «التقارير»; the rest is «not found»; a team lead gets the overview, the people and the reports", async () => {
    const w = await world({ door: true });
    await as(w, "admin");
    const page = await owner();
    expect(page.kind).toBe("rendered");
    if (page.kind === "rendered") expect(listed(page.markup)).toEqual(["people", "reports"]);
    // «الناس» is the first entry, so the bare address lands there: the accounts part (the only one)
    const people = await owner({ s: "people" });
    expect(people.kind === "rendered" ? people.markup : "").toContain('data-part="accounts"');
    for (const s of ["overview", "structure", "archive", "assistant", "nonsense"]) expect(await owner({ s }), s).toEqual({ kind: "not-found" });

    await as(w, "lead");
    // no board: the reports are the only entry, so the bare address lands there
    const reports = await owner();
    expect(reports.kind === "rendered" ? listed(reports.markup) : []).toEqual(["reports"]);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.lead.id } }, data: { capabilities: ["board.team"] } });
    const team = await owner();
    expect(team.kind).toBe("rendered");
    if (team.kind === "rendered") expect(listed(team.markup)).toEqual(["overview", "people", "reports"]);
  });

  it("a member has no entry: /owner leads to «لوحتي»; a guest gets «not found»", async () => {
    const w = await world({ door: true });
    await as(w, "member");
    expect(await owner()).toEqual({ kind: "redirect", to: myBoardHref(w.member.id) });
    await as(w, "guest");
    expect(await owner()).toEqual({ kind: "not-found" });
  });

  it("a partner follows what they hold: without `archive.view` the archive entry is gone and its address is «not found»", async () => {
    const w = await world({ door: true });
    await as(w, "partner");
    const full = await owner();
    expect(full.kind === "rendered" ? listed(full.markup) : []).toEqual([...PANEL_ONE_NAV]);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.partner.id } }, data: { revokedCapabilities: ["archive.view"] } });
    const less = await owner();
    expect(less.kind === "rendered" ? listed(less.markup) : []).toEqual(PANEL_ONE_NAV.filter((k) => k !== "archive"));
    expect(await owner({ s: "archive" })).toEqual({ kind: "not-found" });
  });

  it("a person who holds only a settings section is sent to the settings frame, never to an empty panel", async () => {
    const w = await world({ door: true });
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.admin.id } }, data: { revokedCapabilities: ["users.manage", "integrations.manage", "reports.view", "archive.view"] } });
    await as(w, "admin");
    const out = await owner();
    expect(out).toEqual({ kind: "redirect", to: "/settings/me/spaces" });
    expect((await follow("/settings/me/spaces")).kind).toBe("rendered");
  });
});

describe("S3.2 · ON: «الناس» is one section with parts", () => {
  it("the owner holds accounts, templates and activity, each its own address and the old body; the part nav is the existing PartNav", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    const first = await owner({ s: "people" });
    expect(first.kind).toBe("rendered");
    if (first.kind !== "rendered") return;
    expect(first.markup).toContain('data-testid="cp-people-one"');
    expect(first.markup).toContain('data-part="accounts"');
    expect(partsOf(first.markup)).toEqual([...PEOPLE_PARTS]);
    expect(first.markup.match(/aria-current="page"/g)?.length).toBe(2); // the entry «الناس» and the part «الحسابات والصلاحيات»

    const templates = await owner({ s: "people", part: "templates" });
    expect(templates.kind === "rendered" ? templates.markup : "").toContain('data-part="templates"');
    // the switch of the templates is off here: the old note, with its link to «الميزات» (an address that now leads into «إعدادات الشركة»)
    expect(templates.kind === "rendered" ? templates.markup : "").toContain('data-testid="cp-templates-off"');

    const activity = await owner({ s: "people", part: "activity" });
    expect(activity.kind === "rendered" ? activity.markup : "").toContain('data-part="activity"');
    expect(activity.kind === "rendered" ? activity.markup : "").toContain('data-testid="cp-people"');
    // the filters of the table come back to the part
    expect(activity.kind === "rendered" ? activity.markup : "").toContain('name="part" value="activity"');
    expect(activity.kind === "rendered" ? activity.markup : "").toContain('name="s" value="people"');
  });

  it("with the templates switch on the part draws the editor", async () => {
    const w = await world({ door: true });
    await setFeature(w.org.id, "permissionTemplates", true);
    await as(w, "owner");
    const out = await owner({ s: "people", part: "templates" });
    expect(out.kind).toBe("rendered");
    if (out.kind === "rendered") expect(out.markup).not.toContain('data-testid="cp-templates-off"');
  });

  it("«permissions» leads to the accounts, an unknown word to the first part; a part a person may not open is «not found»", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    for (const part of ["permissions", "nonsense"]) {
      const out = await owner({ s: "people", part });
      expect(out.kind === "rendered" ? out.markup : "", part).toContain('data-part="accounts"');
    }
    // an admin: the accounts only (the templates are the owner rank's, the activity is the board's)
    await as(w, "admin");
    expect(await owner({ s: "people", part: "templates" })).toEqual({ kind: "not-found" });
    expect(await owner({ s: "people", part: "activity" })).toEqual({ kind: "not-found" });
    const accounts = await owner({ s: "people", part: "accounts" });
    expect(accounts.kind === "rendered" ? partsOf(accounts.markup) : ["x"]).toEqual([]); // one part: no nav
    // a team lead: the activity table only
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.lead.id } }, data: { capabilities: ["board.team"] } });
    await as(w, "lead");
    const activity = await owner({ s: "people" });
    expect(activity.kind === "rendered" ? activity.markup : "").toContain('data-part="activity"');
    expect(await owner({ s: "people", part: "accounts" })).toEqual({ kind: "not-found" });
    expect(await owner({ s: "people", part: "templates" })).toEqual({ kind: "not-found" });
  });

  it("the old `?s=accounts` and `?v=people` lead to the part, `?s=people` filters keep working", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    expect(await owner({ s: "accounts" })).toEqual({ kind: "redirect", to: "/owner?s=people&part=accounts" });
    expect(await owner({ s: "accounts", new: "person" })).toEqual({ kind: "redirect", to: "/owner?s=people&part=accounts&new=person" });
    // the old `?v=people` was the activity table: it still lands on it (with its filters), for an admin without the board it lands on the accounts
    expect(await owner({ v: "people", space: "x" })).toEqual({ kind: "redirect", to: "/owner?s=people&part=activity&space=x" });
    const old = await owner({ s: "people", sort: "completed", dir: "desc" });
    expect(old.kind === "rendered" ? old.markup : "").toContain('data-part="activity"');
    // an admin may open the accounts through the old key, and a lead (no `users.manage`) may not
    await as(w, "admin");
    expect(await owner({ v: "people" })).toEqual({ kind: "redirect", to: "/owner?s=people" });
    expect(await owner({ s: "accounts" })).toEqual({ kind: "redirect", to: "/owner?s=people&part=accounts" });
    await as(w, "lead");
    expect(await owner({ s: "accounts" })).toEqual({ kind: "not-found" });
  });
});

describe("S3.2 · ON: an empty `?s=` is no section", () => {
  it("/owner?s= opens the first entry like the bare address does", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    const out = await owner({ s: "" });
    expect(out.kind).toBe("rendered");
    if (out.kind === "rendered") expect(out.markup).toContain('data-section="overview"');
  });
});

describe("S3.2 · ON: the settings sections are «إعدادات الشركة», not entries of the panel", () => {
  it("their old panel addresses lead into the settings frame with the part and the query; a person who may not open one gets «not found»", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    expect(await owner({ s: "features" })).toEqual({ kind: "redirect", to: "/settings/me/features" });
    expect(await owner({ s: "company" })).toEqual({ kind: "redirect", to: "/settings/me/company" });
    expect(await owner({ s: "spaces" })).toEqual({ kind: "redirect", to: "/settings/me/spaces" });
    expect(await owner({ s: "integrations", part: "telegram" })).toEqual({ kind: "redirect", to: "/settings/me/integrations?part=telegram" });
    expect(await owner({ s: "integrations", part: "ai", extra: "1" })).toEqual({ kind: "redirect", to: "/settings/me/integrations?part=ai&extra=1" });
    expect(await owner({ v: "ai" })).toEqual({ kind: "redirect", to: "/settings/me/integrations?part=ai" });
    await as(w, "admin");
    expect(await owner({ s: "features" })).toEqual({ kind: "not-found" });
    expect(await owner({ s: "company" })).toEqual({ kind: "not-found" });
    expect(await owner({ s: "spaces" })).toEqual({ kind: "redirect", to: "/settings/me/spaces" });
    // the AI part is the owner's: the admin's old `?v=ai` is not sent to a 404
    expect((await owner({ v: "ai" })).kind).toBe("rendered");
  });
});

describe("S3.2 · ON: every old address opens the right place, with its query, and the target answers", () => {
  const pages: Record<string, (searchParams: Record<string, string>) => Promise<ReactNode> | ReactNode> = {
    "/analytics": (searchParams) => AnalyticsPage({ searchParams }),
    "/members": (searchParams) => MembersPage({ searchParams }),
    "/spaces": (searchParams) => SpacesPage({ searchParams }),
    "/structure": (searchParams) => StructurePage({ searchParams }),
    "/development": (searchParams) => DevelopmentPage({ searchParams }),
    "/automation": (searchParams) => AutomationPage({ searchParams }),
    "/telegram": (searchParams) => TelegramPage({ searchParams }),
    "/archive": (searchParams) => ArchivePage({ searchParams }),
    "/owner/assistant": (searchParams) => AssistantPage({ searchParams }),
    "/owner/assistant/settings": (searchParams) => AssistantSettingsPage({ searchParams }),
  };

  it("the walk: the owner follows each of the ten addresses and every target is a page that answers", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    expect(Object.keys(pages).sort()).toEqual([...PANEL_REDIRECT_ADDRESSES].sort());
    for (const address of PANEL_REDIRECT_ADDRESSES) {
      const run = pages[address] as (searchParams: Record<string, string>) => Promise<ReactNode> | ReactNode;
      const out = await open(() => run({}));
      expect(out, address).toEqual({ kind: "redirect", to: panelRedirectHref(address, undefined, true) });
      const landed = await follow((out as { to: string }).to);
      expect(landed.kind, `${address} → ${(out as { to: string }).to}`).toBe("rendered");
    }
  });

  it("the carried query rides along: /members?new=person lands on the accounts part, /automation?google=connected on the integrations", async () => {
    const w = await world({ door: true });
    await as(w, "owner");
    expect(await open(() => MembersPage({ searchParams: { new: "person" } }))).toEqual({ kind: "redirect", to: "/owner?s=people&part=accounts&new=person" });
    expect(await open(() => AutomationPage({ searchParams: { google: "connected" } }))).toEqual({ kind: "redirect", to: "/settings/me/integrations?part=automation&google=connected" });
    expect(await open(() => DevelopmentPage({ searchParams: { period: "2026-11" } }))).toEqual({ kind: "redirect", to: "/owner?s=structure&part=development&period=2026-11" });
  });

  it("the capability guard of an address is the panel's: an admin is redirected where the panel serves them, and a lead keeps the page it had (no dead end)", async () => {
    const w = await world({ door: true });
    await as(w, "admin");
    expect(await open(() => MembersPage({}))).toEqual({ kind: "redirect", to: "/owner?s=people&part=accounts" });
    expect(await open(() => AnalyticsPage({}))).toEqual({ kind: "redirect", to: "/owner?s=reports" });
    expect(await open(() => SpacesPage({}))).toEqual({ kind: "redirect", to: "/settings/me/spaces" });
    expect(await open(() => AutomationPage({}))).toEqual({ kind: "redirect", to: "/settings/me/integrations?part=automation" });
    // the archive is not the admin's: the address keeps answering as it did (the refusal), it is not redirected into a 404
    const archive = await open(() => ArchivePage({}));
    expect(archive.kind).toBe("rendered");
    // a lead with no `users.manage` still gets the directory page it always had at /members
    await as(w, "lead");
    expect(await panelRedirectFor(await requireActor(), "/members")).toBeNull();
    expect((await open(() => MembersPage({}))).kind).toBe("rendered");
    // a member too (the staff directory)
    await as(w, "member");
    expect((await open(() => MembersPage({}))).kind).toBe("rendered");
  });
});

describe("S3.2 · ON: the place «لوحة التحكم» is the slot of an admin who holds the panel", () => {
  it("the owner, a partner and an admin get one row to /owner with no tab strip; a lead keeps «الإدارة» with its tabs; a member keeps «الناس»", async () => {
    const w = await world({ door: true });
    const place = async (who: Person) => {
      await as(w, who);
      return (await visibleNavFor(await requireActor())).places.find((p) => p.key === "admin");
    };
    for (const who of ["owner", "partner", "admin"] as const) {
      const p = await place(who);
      expect(p?.labelKey, who).toBe("nav.place.controlPanel");
      expect(p?.href, who).toBe("/owner");
      expect(p?.tabs, who).toEqual([]);
    }
    const lead = await place("lead");
    expect(lead?.labelKey).not.toBe("nav.place.controlPanel");
    expect((lead?.tabs.length ?? 0)).toBeGreaterThan(0);
    expect((await place("member"))?.labelKey).toBe("nav.place.people");
    expect(await place("guest")).toBeUndefined();
  });

  it("every place the panel offers is a page that answers: the row's address opens for the person it is drawn for", async () => {
    const w = await world({ door: true });
    for (const who of ["owner", "partner", "admin"] as const) {
      await as(w, who);
      const out = await owner();
      expect(out.kind, who).toBe("rendered");
      const access = await panelAccess(await requireActor());
      expect(access.sections.length, who).toBeGreaterThan(0);
    }
  });
});
