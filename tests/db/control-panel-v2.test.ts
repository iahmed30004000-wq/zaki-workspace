import "./scoping-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// the pages call redirect() / notFound(); the client parts call useRouter(): no running Next app is needed here
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

import type { Prisma } from "@prisma/client";
import OwnerPage from "@/app/(app)/owner/page";
import PersonPage from "@/app/(app)/owner/people/[id]/page";
import AnalyticsPage from "@/app/(app)/analytics/page";
import MembersPage from "@/app/(app)/members/page";
import SpacesPage from "@/app/(app)/spaces/page";
import StructurePage from "@/app/(app)/structure/page";
import DevelopmentPage from "@/app/(app)/development/page";
import AutomationPage from "@/app/(app)/automation/page";
import TelegramPage from "@/app/(app)/telegram/page";
import ArchivePage from "@/app/(app)/archive/page";
import FilesPage from "@/app/(app)/files/page";
import SettingsPage from "@/app/(app)/settings/page";
import AssistantPage from "@/app/(app)/owner/assistant/page";
import AssistantSettingsPage from "@/app/(app)/owner/assistant/settings/page";
import { withFeature, type FeatureKey } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { PANEL_V2_SECTIONS, myBoardHref, panelHref, type PanelSectionKey } from "@/lib/control-panel";
import { PANEL_REDIRECT_ADDRESSES } from "@/lib/legacy-routes";
import { requireActor } from "@/server/policy/actor";
import { assertPanelSection, loadCompanySettings, panelAccess, saveCompanySettings } from "@/server/services/control-panel";
import { db, loginAs, makeProject, makeTask, makeTeam, makeUser, makeWorkspace } from "./helpers";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { readable, resolveServerTree } from "./today-helpers";

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;

/** A server page (async parts included) rendered inside the providers its client parts need (the people screen and the library ask for a query client). */
async function html(page: Promise<ReactNode> | ReactNode): Promise<string> {
  const tree = await resolveServerTree(await page);
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Toasts, null, tree as ReactElement))));
}

/**
 * A2.1 — ONE control panel («لوحة التحكم») behind the switch `controlPanelV2`, against a real PostgreSQL.
 *
 * What this pins:
 *  - OFF (the default): `/owner` and every old page are exactly what they were (no redirect, no side list);
 *  - ON: `/owner` is one page with a side list; a person sees ONLY the sections they may open and the same section has the same name for everybody; a section a
 *    person may not open (or that does not exist) is «not found», never «forbidden»; a guest never sees the panel;
 *  - every old address still resolves: it redirects to its section for a person who may open it, and is drawn as it was for anybody else (no dead end);
 *  - a partner follows what they HOLD: taking `reports.view` or `archive.view` away takes the section away;
 *  - «لوحتي» (the person's own page, `/owner/people/<their id>`) is independent of the board switch (D-A6) and answers nothing but the person's own page;
 *  - every number carries its scope chip («كل الشركة» / «مساحة: X»);
 *  - the AI connection is ONE place; the templates editor is the OWNER's alone;
 *  - the company's settings (landing, pinned work tabs, menu order, time zone) are written by the OWNER only, keep every other key, audit only the key names,
 *    and never touch a person's own menu order (D-N5).
 */

async function setFeature(orgId: string, key: FeatureKey, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, key, on) as Prisma.InputJsonValue } });
}

async function world() {
  const t = await makeTeam();
  const lead = await makeUser({ orgId: t.org.id, role: "LEAD", name: "ليلى" });
  const partner = await makeUser({ orgId: t.org.id, role: "OWNER", name: "الشريك" });
  await db.organizationMember.update({ where: { organizationId_userId: { organizationId: t.org.id, userId: partner.id } }, data: { primaryOwner: false } });
  const sales = await makeWorkspace(t.org.id, [{ userId: t.member.id }, { userId: lead.id, role: "ADMIN" }], "المبيعات");
  const media = await makeWorkspace(t.org.id, [{ userId: t.member.id }], "التسويق");
  const ps = await makeProject(sales.id, "مشروع المبيعات");
  await makeTask({ orgId: t.org.id, workspaceId: sales.id, projectId: ps.project.id, boardId: ps.board.id, columnId: ps.todo.id, creatorId: t.owner.id, assigneeId: t.member.id, title: "مهمة" });
  return { ...t, lead, partner, sales, media };
}

type World = Awaited<ReturnType<typeof world>>;
type Person = "owner" | "admin" | "lead" | "member" | "guest" | "partner";

async function as(w: World, who: Person) {
  await loginAs(w[who].id);
}

type Outcome = { kind: "rendered"; text: string; markup: string } | { kind: "redirect"; to: string } | { kind: "not-found" };

/** Opens a page the way Next does: an element, a redirect or «not found» (anything else is a thrown error and fails the test). */
async function open(page: () => Promise<React.ReactNode> | React.ReactNode): Promise<Outcome> {
  try {
    const markup = await html(page());
    return { kind: "rendered", markup, text: readable(markup) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("NEXT_REDIRECT:")) return { kind: "redirect", to: message.slice("NEXT_REDIRECT:".length) };
    if (message === "NEXT_NOT_FOUND") return { kind: "not-found" };
    throw err;
  }
}

const owner = (searchParams: Record<string, string> = {}) => open(() => OwnerPage({ searchParams }));
const person = (id: string) => open(() => PersonPage({ params: { id }, searchParams: {} }));
const sectionName = (key: PanelSectionKey) => AR[`cpv2.section.${key}`] as string;

/** The section links the side list draws, in order (their keys). */
const listed = (markup: string): string[] => [...markup.matchAll(/data-panel-section="([a-z]+)"/g)].map((m) => m[1] as string);

beforeEach(() => {
  /* every test builds its own company */
});

describe("A2.1 · the switch is OFF (as merged)", () => {
  it("/owner is the page it was (no side list), and no old address redirects", async () => {
    const w = await world();
    await as(w, "owner");
    const page = await owner();
    expect(page.kind).toBe("rendered");
    if (page.kind === "rendered") {
      expect(page.markup).not.toContain("data-panel-v2");
      expect(listed(page.markup)).toEqual([]);
    }
    // the old pages draw themselves (the walk below is the same list with the switch ON)
    for (const run of [() => MembersPage({}), () => SpacesPage({}), () => StructurePage({}), () => DevelopmentPage({ searchParams: {} }), () => AutomationPage({}), () => TelegramPage({}), () => ArchivePage({})]) {
      const out = await open(run);
      expect(out.kind).toBe("rendered");
    }
  });

  it("«لوحتي» is as it was while the switch is off: with the board off a member's own page is «not found», with it on it is drawn", async () => {
    const w = await world();
    await as(w, "member");
    expect((await person(w.member.id)).kind).toBe("rendered");
    await setFeature(w.org.id, "ownerBoard", false);
    expect(await person(w.member.id)).toEqual({ kind: "not-found" });
  });

  it("the panel's service answers «not found» while the switch is off", async () => {
    const w = await world();
    await as(w, "owner");
    await expect(panelAccess(await requireActor())).rejects.toThrow("features.off");
  });
});

describe("A2.1 · the side list: only what a person may open, one name for everybody", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
    await setFeature(w.org.id, "controlPanelV2", true);
    await setFeature(w.org.id, "ownerAssistant", true);
  });

  it("the owner sees all eleven sections, in the order of the plan, named in Arabic", async () => {
    await as(w, "owner");
    const page = await owner();
    expect(page.kind).toBe("rendered");
    if (page.kind !== "rendered") return;
    expect(page.markup).toContain("data-panel-v2");
    expect(listed(page.markup)).toEqual([...PANEL_V2_SECTIONS]);
    for (const key of PANEL_V2_SECTIONS) expect(page.text).toContain(sectionName(key));
    expect(sectionName("overview")).toBe("نظرة عامة");
    expect(sectionName("accounts")).toBe("الحسابات والصلاحيات");
  });

  it("an admin sees reports, accounts, spaces and integrations (what the rank holds); no section changes its name", async () => {
    await as(w, "admin");
    const page = await owner();
    expect(page.kind).toBe("rendered");
    if (page.kind !== "rendered") return;
    expect(listed(page.markup)).toEqual(["reports", "accounts", "spaces", "integrations"]);
    for (const key of ["reports", "accounts", "spaces", "integrations"] as const) expect(page.text).toContain(sectionName(key));
    expect(page.text).not.toContain(sectionName("archive"));
    expect(page.text).not.toContain(sectionName("company"));
  });

  it("a lead sees «التقارير» only; with `board.team` also the overview and the people", async () => {
    await as(w, "lead");
    const plain = await owner();
    expect(plain.kind).toBe("rendered");
    if (plain.kind === "rendered") expect(listed(plain.markup)).toEqual(["reports"]);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.lead.id } }, data: { capabilities: ["board.team"] } });
    const team = await owner();
    expect(team.kind).toBe("rendered");
    if (team.kind === "rendered") expect(listed(team.markup)).toEqual(["overview", "people", "reports"]);
  });

  it("a member has no section: /owner leads to «لوحتي»; a guest gets «not found»", async () => {
    await as(w, "member");
    expect(await owner()).toEqual({ kind: "redirect", to: myBoardHref(w.member.id) });
    await as(w, "guest");
    expect(await owner()).toEqual({ kind: "not-found" });
  });

  it("a section a person may not open, and a section that does not exist, are «not found» (never forbidden)", async () => {
    await as(w, "admin");
    for (const s of ["archive", "company", "features", "assistant", "overview", "people", "structure", "nonsense"]) expect(await owner({ s }), s).toEqual({ kind: "not-found" });
    const access = await panelAccess(await requireActor());
    expect(() => assertPanelSection(access, "archive")).toThrow("cpv2.not_found");
    await as(w, "owner");
    expect((await owner({ s: "archive" })).kind).toBe("rendered");
  });

  it("the old `?v=ai` of the first panel leads only where the AI part is offered: an admin (integrations, not the owner's AI) is not sent to a 404", async () => {
    await as(w, "admin");
    // the admin holds «التكاملات» but the AI connection is the owner's: no hop, the normal section is drawn
    const out = await owner({ v: "ai" });
    expect(out.kind).toBe("rendered");
    expect(await owner({ s: "integrations", part: "ai" })).toEqual({ kind: "not-found" });
  });

  it("a partner who lost `integrations.manage` still reaches the system tokens: they live in «إعدادات الشركة» (the owner rank's, as on /settings), and /settings says where they went", async () => {
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.partner.id } }, data: { revokedCapabilities: ["integrations.manage"] } });
    await as(w, "partner");
    const company = await owner({ s: "company" });
    expect(company.kind === "rendered" ? company.markup : "").toContain("systok-title");
    const integrations = await owner({ s: "integrations" });
    expect(integrations).toEqual({ kind: "not-found" });
    const settings = await open(() => SettingsPage());
    expect(settings.kind === "rendered" ? settings.markup : "").not.toContain("systok-title");
    expect(settings.kind === "rendered" ? settings.markup : "").toContain(panelHref("company"));
  });

  it("the old `?v=` of the first panel still lands: people, reports and the AI part", async () => {
    await as(w, "owner");
    expect(await owner({ v: "people" })).toEqual({ kind: "redirect", to: panelHref("people") });
    expect(await owner({ v: "reports" })).toEqual({ kind: "redirect", to: panelHref("reports") });
    expect(await owner({ v: "ai" })).toEqual({ kind: "redirect", to: panelHref("integrations", "ai") });
  });

  it("every section of the owner's list opens, and every part of «التكاملات» and «الهيكل والتطوير»", async () => {
    await as(w, "owner");
    for (const key of PANEL_V2_SECTIONS) {
      const out = await owner({ s: key });
      expect(out.kind, key).toBe("rendered");
    }
    for (const part of ["automation", "telegram", "ai"]) expect((await owner({ s: "integrations", part })).kind, part).toBe("rendered");
    for (const part of ["development", "structure"]) expect((await owner({ s: "structure", part })).kind, part).toBe("rendered");
  });

  it("a partner follows what they hold: without `reports.view` and `archive.view` the two sections are gone", async () => {
    await as(w, "partner");
    const full = await owner();
    expect(full.kind).toBe("rendered");
    if (full.kind === "rendered") expect(listed(full.markup)).toEqual([...PANEL_V2_SECTIONS]);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.partner.id } }, data: { revokedCapabilities: ["reports.view", "archive.view"] } });
    const less = await owner();
    expect(less.kind).toBe("rendered");
    if (less.kind === "rendered") expect(listed(less.markup)).toEqual(PANEL_V2_SECTIONS.filter((k) => k !== "reports" && k !== "archive"));
    expect(await owner({ s: "archive" })).toEqual({ kind: "not-found" });
    expect(await owner({ s: "reports" })).toEqual({ kind: "not-found" });
  });
});

describe("A2.1 · every old address still resolves", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
    await setFeature(w.org.id, "controlPanelV2", true);
    await setFeature(w.org.id, "ownerAssistant", true);
  });

  const old: Record<string, () => Promise<React.ReactNode> | React.ReactNode> = {
    "/analytics": () => AnalyticsPage({}),
    "/members": () => MembersPage({}),
    "/spaces": () => SpacesPage({}),
    "/structure": () => StructurePage({}),
    "/development": () => DevelopmentPage({ searchParams: {} }),
    "/automation": () => AutomationPage({}),
    "/telegram": () => TelegramPage({}),
    "/archive": () => ArchivePage({}),
    "/owner/assistant": () => AssistantPage({ searchParams: {} }),
    "/owner/assistant/settings": () => AssistantSettingsPage({}),
  };

  it("the table of moved addresses and the pages of this test are the same list (nothing moved is forgotten)", () => {
    expect(Object.keys(old).sort()).toEqual([...PANEL_REDIRECT_ADDRESSES].sort());
  });

  it("the owner: each moved address redirects to its section, and the section draws (one hop, never a loop)", async () => {
    await as(w, "owner");
    const expected: Record<string, string> = {
      "/analytics": panelHref("reports"),
      "/members": panelHref("accounts"),
      "/spaces": panelHref("spaces"),
      "/structure": panelHref("structure", "structure"),
      "/development": panelHref("structure", "development"),
      "/automation": panelHref("integrations", "automation"),
      "/telegram": panelHref("integrations", "telegram"),
      "/archive": panelHref("archive"),
      "/owner/assistant": panelHref("assistant"),
      "/owner/assistant/settings": panelHref("integrations", "ai"),
    };
    for (const [address, run] of Object.entries(old)) {
      const out = await open(run);
      expect(out, address).toEqual({ kind: "redirect", to: expected[address] });
      const url = new URL(expected[address] as string, "http://x");
      const landed = await owner(Object.fromEntries(url.searchParams));
      expect(landed.kind, `${address} -> ${expected[address]}`).toBe("rendered");
    }
  });

  it("the owner: a link that carried a message keeps it (Google's callback, «جديد» → «إضافة شخص»)", async () => {
    await as(w, "owner");
    expect(await open(() => AutomationPage({ searchParams: { google: "connected" } }))).toEqual({ kind: "redirect", to: "/owner?s=integrations&part=automation&google=connected" });
    expect(await open(() => MembersPage({ searchParams: { new: "person" } }))).toEqual({ kind: "redirect", to: "/owner?s=accounts&new=person" });
    expect(await open(() => AssistantPage({ searchParams: { c: "k1" } }))).toEqual({ kind: "redirect", to: "/owner?s=assistant&c=k1" });
    expect(await open(() => DevelopmentPage({ searchParams: { period: "2026-11", sort: "score" } }))).toEqual({ kind: "redirect", to: "/owner?s=structure&part=development&period=2026-11&sort=score" });
  });

  it("a person the panel does not serve keeps the old page as it was (no dead end): a member's /members is the directory, /structure their own line", async () => {
    await as(w, "member");
    const members = await open(() => MembersPage({}));
    expect(members.kind).toBe("rendered");
    const structure = await open(() => StructurePage({}));
    expect(structure.kind).toBe("rendered");
    const archive = await open(() => ArchivePage({}));
    expect(archive.kind).toBe("rendered");
    expect(archive.kind === "rendered" ? archive.text : "").toContain(AR["access.section_off"] as string);
  });

  it("an admin: the sections they hold redirect; the ones they do not stay the old page", async () => {
    await as(w, "admin");
    expect(await open(() => MembersPage({}))).toEqual({ kind: "redirect", to: panelHref("accounts") });
    expect(await open(() => AnalyticsPage({}))).toEqual({ kind: "redirect", to: panelHref("reports") });
    expect(await open(() => ArchivePage({}))).toMatchObject({ kind: "rendered" });
  });

  it("/files is the library: still a page of its own, never redirected", async () => {
    await as(w, "owner");
    expect((await open(() => FilesPage())).kind).toBe("rendered");
  });

  it("/settings keeps drawing for the owner (the theme review and the profile links stay), and says the moved parts moved", async () => {
    await as(w, "owner");
    const out = await open(() => SettingsPage());
    expect(out.kind).toBe("rendered");
    if (out.kind === "rendered") expect(out.markup).toContain(panelHref("company"));
  });
});

describe("A2.1 · «لوحتي» is independent of the owner's board (D-A6)", () => {
  it("with the board switched off the member still reads their own page, and ONLY their own; a guest never does", async () => {
    const w = await world();
    await setFeature(w.org.id, "controlPanelV2", true);
    await setFeature(w.org.id, "ownerBoard", false);
    await as(w, "member");
    const mine = await person(w.member.id);
    expect(mine.kind).toBe("rendered");
    // nobody else's page, whatever the person's own box says
    expect(await person(w.lead.id)).toEqual({ kind: "not-found" });
    // the member with no section is still sent there from /owner
    expect(await owner()).toEqual({ kind: "redirect", to: myBoardHref(w.member.id) });
    await as(w, "guest");
    expect(await person(w.guest.id)).toEqual({ kind: "not-found" });
    expect(await person(w.member.id)).toEqual({ kind: "not-found" });
  });

  it("the owner and an admin keep reading their own page through the board's own gate while it is on, and through «لوحتي» when it is off", async () => {
    const w = await world();
    await setFeature(w.org.id, "controlPanelV2", true);
    for (const who of ["owner", "admin"] as const) {
      await as(w, who);
      expect((await person(w[who].id)).kind, who).toBe("rendered");
    }
    await setFeature(w.org.id, "ownerBoard", false);
    await as(w, "admin");
    expect((await person(w.admin.id)).kind).toBe("rendered");
    expect(await person(w.member.id)).toEqual({ kind: "not-found" });
  });

  it("a person whose `board.self` was taken away has no page of their own", async () => {
    const w = await world();
    await setFeature(w.org.id, "controlPanelV2", true);
    await setFeature(w.org.id, "ownerBoard", false);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.member.id } }, data: { revokedCapabilities: ["board.self"] } });
    await as(w, "member");
    expect(await person(w.member.id)).toEqual({ kind: "not-found" });
    expect(await owner()).toEqual({ kind: "not-found" });
  });

  it("with the switch OFF the page is exactly what it was: the board off, even a person's own page is «not found»", async () => {
    const w = await world();
    await setFeature(w.org.id, "ownerBoard", false);
    await as(w, "member");
    expect(await person(w.member.id)).toEqual({ kind: "not-found" });
  });
});

describe("A2.1 · every number shows its scope", () => {
  it("the owner's overview: every KPI card carries «كل الشركة»", async () => {
    const w = await world();
    await setFeature(w.org.id, "controlPanelV2", true);
    await as(w, "owner");
    const page = await owner({ s: "overview" });
    expect(page.kind).toBe("rendered");
    if (page.kind !== "rendered") return;
    const cards = [...page.markup.matchAll(/<li[^>]*data-kpi="[^"]*"[^>]*>[\s\S]*?<\/li>/g)].map((m) => m[0]);
    expect(cards.length).toBeGreaterThanOrEqual(4);
    for (const card of cards) expect(card).toContain(AR["cpv2.scope.company"] as string);
  });

  it("a space manager with `board.team`: the chip names the space they manage, never the whole company", async () => {
    const w = await world();
    await setFeature(w.org.id, "controlPanelV2", true);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.lead.id } }, data: { capabilities: ["board.team"] } });
    await as(w, "lead");
    const page = await owner({ s: "overview" });
    expect(page.kind).toBe("rendered");
    if (page.kind !== "rendered") return;
    const chips = [...page.markup.matchAll(/<span[^>]*data-scope[^>]*>([^<]*)<\/span>/g)].map((m) => m[1] as string);
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) expect(chip).toBe("مساحة: المبيعات");
  });
});

describe("A2.1 · one place for the AI connection, and the templates editor", () => {
  it("«التكاملات» › the AI part draws ONE gateway form (the old second form is not drawn)", async () => {
    const w = await world();
    await setFeature(w.org.id, "controlPanelV2", true);
    await setFeature(w.org.id, "ownerAssistant", true);
    await as(w, "owner");
    const page = await owner({ s: "integrations", part: "ai" });
    expect(page.kind).toBe("rendered");
    if (page.kind !== "rendered") return;
    expect(page.markup.match(/data-testid="ai-gateway"/g)?.length).toBe(1);
    expect(page.markup).not.toContain('data-testid="zaki-ai-form"');
    expect(page.markup).toContain('data-testid="zaki-ai-panel"');
  });

  it("the templates editor is drawn for the OWNER only, and only while «قوالب الصلاحيات» is on", async () => {
    const w = await world();
    await setFeature(w.org.id, "controlPanelV2", true);
    await as(w, "owner");
    const off = await owner({ s: "accounts" });
    expect(off.kind === "rendered" ? off.markup : "").not.toContain("data-templates-editor");
    expect(off.kind === "rendered" ? off.text : "").toContain(AR["cpv2.accounts.templates_off"] as string);
    await setFeature(w.org.id, "permissionTemplates", true);
    const on = await owner({ s: "accounts" });
    expect(on.kind === "rendered" ? on.markup : "").toContain("data-templates-editor");
    await as(w, "admin");
    const admin = await owner({ s: "accounts" });
    expect(admin.kind).toBe("rendered");
    expect(admin.kind === "rendered" ? admin.markup : "").not.toContain("data-templates-editor");
  });
});

describe("A2.1 · «إعدادات الشركة»: what the owner writes", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
    await setFeature(w.org.id, "controlPanelV2", true);
    await db.organization.update({ where: { id: w.org.id }, data: { settings: { transparencyVersion: 1, roleTemplates: [], features: { controlPanelV2: true } } as Prisma.InputJsonValue } });
  });

  it("writes landing, pinned tabs, menu order and time zone; keeps every other key; audits the key names only", async () => {
    await as(w, "owner");
    const actor = await requireActor();
    const view = await saveCompanySettings(actor, {
      landing: "today",
      workTabs: ["goals", "ideas"],
      menuOrder: { places: ["today", "chat"], tabs: {} },
      timezone: "Asia/Amman",
    });
    expect(view).toMatchObject({ landing: "today", workTabs: ["goals", "ideas"], timezone: "Asia/Amman", menuOrder: { places: ["today", "chat"], tabs: {} } });
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id } });
    expect(org.settings).toMatchObject({ transparencyVersion: 1, roleTemplates: [], landing: "today", workTabs: ["goals", "ideas"] });
    expect(org.timezone).toBe("Asia/Amman");
    const row = await db.auditLog.findFirstOrThrow({ where: { orgId: w.org.id, action: "org.company_settings_saved" } });
    expect(JSON.stringify(row.meta)).toContain("landing");
    expect(JSON.stringify(row.meta)).not.toContain("Asia/Amman");
    expect(JSON.stringify(row.meta)).not.toContain("today");
  });

  it("clearing the menu order (null) removes only that key", async () => {
    await as(w, "owner");
    const actor = await requireActor();
    await saveCompanySettings(actor, { menuOrder: { places: ["today"], tabs: {} } });
    const cleared = await saveCompanySettings(actor, { menuOrder: null });
    expect(cleared.menuOrder).toBeNull();
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id } });
    expect(org.settings).not.toHaveProperty("menuOrder");
    expect(org.settings).toMatchObject({ transparencyVersion: 1 });
  });

  it("a person's own menu order stays stored (D-N5): the company's order never rewrites it", async () => {
    await db.user.update({ where: { id: w.member.id }, data: { navOrder: { places: ["chat"], tabs: {} } as Prisma.InputJsonValue } });
    await as(w, "owner");
    const actor = await requireActor();
    const view = await saveCompanySettings(actor, { menuOrder: { places: ["today", "chat"], tabs: {} } });
    expect(view.personalOrders).toBe(1);
    const kept = await db.user.findUniqueOrThrow({ where: { id: w.member.id } });
    expect(kept.navOrder).toEqual({ places: ["chat"], tabs: {} });
  });

  it("refuses what is not allowed, with a dictionary key, and writes nothing", async () => {
    await as(w, "owner");
    const actor = await requireActor();
    for (const bad of [
      { landing: "everything" },
      { workTabs: ["goals", "ideas", "crm"] },
      { workTabs: ["files"] },
      { workTabs: ["goals", "goals"] },
      { menuOrder: { places: ["nonsense"], tabs: {} } },
      { timezone: "Mars/Olympus" },
      { somethingElse: 1 },
      {},
    ]) {
      await expect(saveCompanySettings(actor, bad), JSON.stringify(bad)).rejects.toMatchObject({ name: "ValidationError" });
    }
    const org = await db.organization.findUniqueOrThrow({ where: { id: w.org.id } });
    expect(org.settings).not.toHaveProperty("landing");
    expect(await db.auditLog.count({ where: { orgId: w.org.id, action: "org.company_settings_saved" } })).toBe(0);
  });

  it("only the OWNER rank writes it: an admin, a lead and a member are refused; a guest is nobody", async () => {
    for (const who of ["admin", "lead", "member", "guest"] as const) {
      await as(w, who);
      const actor = await requireActor();
      await expect(saveCompanySettings(actor, { landing: "today" }), who).rejects.toThrow("cpv2.company.owner_only");
      await expect(loadCompanySettings(actor), who).rejects.toMatchObject({ name: "NotFoundError" });
    }
  });

  it("a partner whose rank is OWNER writes it too (D-A4: who changes company settings does not change here)", async () => {
    await as(w, "partner");
    const actor = await requireActor();
    const view = await saveCompanySettings(actor, { landing: "today" });
    expect(view.landing).toBe("today");
  });

  it("with the switch off the write answers «not found»", async () => {
    await setFeature(w.org.id, "controlPanelV2", false);
    await as(w, "owner");
    await expect(saveCompanySettings(await requireActor(), { landing: "today" })).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("another company's owner cannot change this company's settings (the actor's own company is the only one written)", async () => {
    const other = await makeTeam();
    await setFeature(other.org.id, "controlPanelV2", true);
    await loginAs(other.owner.id);
    await saveCompanySettings(await requireActor(), { landing: "today" });
    const mine = await db.organization.findUniqueOrThrow({ where: { id: w.org.id } });
    expect(mine.settings).not.toHaveProperty("landing");
  });
});
