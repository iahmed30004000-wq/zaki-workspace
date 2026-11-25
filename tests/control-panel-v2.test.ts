import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

import {
  COMPANY_TIME_ZONES,
  FIRST_SECTION,
  INTEGRATION_PARTS,
  PANEL_V2_SECTIONS,
  STRUCTURE_PARTS,
  checkCompanySettings,
  isPanelSection,
  legacyPanelTarget,
  myBoardHref,
  panelHref,
  panelSectionsFor,
  scopeChipOf,
  type PanelFacts,
  type PanelSectionKey,
} from "@/lib/control-panel";
import { PANEL_REDIRECTS, PANEL_REDIRECT_ADDRESSES, carriedQuery, panelRedirectHref } from "@/lib/legacy-routes";
import { isValidTimeZone } from "@/lib/zoned-time";
import { AR } from "@/lib/i18n/dict";
import { interpolate } from "@/lib/i18n/interpolate";
import { I18nProvider } from "@/lib/i18n";
import { getServerT } from "@/lib/i18n/server";
import { FEATURES, FEATURE_META, featureOn } from "@/lib/features";
import { RANK_DEFAULTS } from "@/server/policy/capabilities";
import { STARTER_TEMPLATES, checkTemplatesInput, cleanTemplate } from "@/lib/permission-templates";
import { offeredFor, isOn, withBox, withRank } from "@/components/templates-editor/model";
import { PanelFrame, ScopeChip, SectionHeader } from "@/components/control-panel/frame";
import { KpiGrid } from "@/components/control-panel/panel";
import { CompanySettingsForm } from "@/components/control-panel/company-settings-form";
import { ZakiAiPanel } from "@/components/control-panel/zaki-ai";
import { ToastProvider } from "@/components/ui/toast";

(globalThis as { React?: typeof React }).React = React;

/**
 * A2.1 — ONE control panel: the pure rules (who may open which section, the scope chip, the old addresses, what «إعدادات الشركة» may write), the pieces of the
 * screens (the frame, the chips, the single AI panel, the templates editor's model) and the shape of the source (every moved page asks the panel, every section only reads).
 * The rules that need a database (a person's real capabilities, the redirects, the writes) are in tests/db/control-panel-v2.test.ts.
 */

const SRC = path.resolve(__dirname, "../src");
const read = (file: string) => readFileSync(path.join(SRC, file), "utf8");

const facts = (over: Partial<PanelFacts> = {}): PanelFacts => ({ external: false, ownerRank: false, role: "MEMBER", caps: new Set<string>(), board: null, assistant: false, development: false, ...over });
const holding = (role: "OWNER" | "ADMIN" | "LEAD" | "MEMBER") => new Set<string>(RANK_DEFAULTS[role]);
const owner = (over: Partial<PanelFacts> = {}) => facts({ ownerRank: true, role: "OWNER", caps: holding("OWNER"), board: "owner", assistant: true, development: true, ...over });

describe("the sections: one list, one name each", () => {
  it("are the eleven of the plan, in its order", () => {
    expect([...PANEL_V2_SECTIONS]).toEqual(["overview", "people", "reports", "accounts", "spaces", "features", "integrations", "structure", "archive", "assistant", "company"]);
    expect(FIRST_SECTION).toBe("overview");
    expect(PANEL_V2_SECTIONS.every(isPanelSection)).toBe(true);
    expect(isPanelSection("nonsense")).toBe(false);
    expect(isPanelSection(undefined)).toBe(false);
  });

  it("every section has ONE Arabic name, the names differ, and none mentions a rank (a name never changes by rank)", () => {
    const names = PANEL_V2_SECTIONS.map((key) => AR[`cpv2.section.${key}`]);
    for (const name of names) expect(typeof name).toBe("string");
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).not.toMatch(/المالك الأساسي|مشرف|قائد فريق|شريك/);
    // the plan's words, exactly
    expect(names).toEqual(["نظرة عامة", "الناس", "التقارير", "الحسابات والصلاحيات", "المساحات", "الميزات", "التكاملات", "الهيكل والتطوير", "الأرشيف والرقابة", "مساعد المالك", "إعدادات الشركة"]);
  });

  it("the parts of «التكاملات» and «الهيكل والتطوير» have names too; the time zones, the landing pages and the errors as well", () => {
    for (const part of INTEGRATION_PARTS) expect(AR[`cpv2.integrations.part.${part}`], part).toBeTruthy();
    for (const part of STRUCTURE_PARTS) expect(AR[`cpv2.structure.part.${part}`], part).toBeTruthy();
    for (const zone of COMPANY_TIME_ZONES) expect(AR[`cpv2.tz.${zone.key}`], zone.id).toBeTruthy();
    for (const key of ["landing", "work_tabs", "menu_order", "timezone", "invalid", "unknown_key", "empty"]) expect(AR[`cpv2.company.e.${key}`], key).toBeTruthy();
    for (const key of ["chat", "today"]) expect(AR[`cpv2.company.landing.${key}`], key).toBeTruthy();
    expect(AR["cpv2.not_found"]).toBeTruthy();
    expect(AR["cpv2.company.owner_only"]).toBeTruthy();
  });
});

describe("who may open which section", () => {
  const sections = (f: PanelFacts): PanelSectionKey[] => panelSectionsFor(f);

  it("a guest opens none, whatever was stored for them", () => {
    expect(sections(facts({ external: true, ownerRank: true, role: "OWNER", caps: holding("OWNER"), board: "owner", assistant: true, development: true }))).toEqual([]);
  });

  it("the owner opens all eleven", () => {
    expect(sections(owner())).toEqual([...PANEL_V2_SECTIONS]);
  });

  it("an admin holds reports, accounts, spaces and integrations; a lead only reports; a member nothing", () => {
    expect(sections(facts({ role: "ADMIN", caps: holding("ADMIN") }))).toEqual(["reports", "accounts", "spaces", "integrations"]);
    expect(sections(facts({ role: "LEAD", caps: holding("LEAD") }))).toEqual(["reports"]);
    expect(sections(facts({ role: "MEMBER", caps: holding("MEMBER") }))).toEqual([]);
  });

  it("the overview and the people follow the board's reach, never the rank: the owner's, or a manager's with `board.team`", () => {
    expect(sections(facts({ role: "LEAD", caps: new Set(["board.team"]), board: "team" }))).toEqual(["overview", "people"]);
    expect(sections(facts({ role: "MEMBER", caps: new Set(["board.self"]), board: null }))).toEqual([]);
  });

  it("a partner follows what they hold: each revoked capability takes its section away, and «الميزات» and «إعدادات الشركة» stay with the rank", () => {
    const all = holding("OWNER");
    const without = (...gone: string[]) => new Set([...all].filter((c) => !gone.includes(c)));
    const base = { ownerRank: true, role: "OWNER", board: "owner" as const, assistant: true, development: true };
    expect(sections(facts({ ...base, caps: without("reports.view") }))).not.toContain("reports");
    expect(sections(facts({ ...base, caps: without("users.manage") }))).not.toContain("accounts");
    expect(sections(facts({ ...base, caps: without("integrations.manage") }))).not.toContain("integrations");
    expect(sections(facts({ ...base, caps: without("archive.view") }))).not.toContain("archive");
    expect(sections(facts({ ...base, caps: without("reports.view", "users.manage", "integrations.manage", "archive.view") }))).toEqual(["overview", "people", "spaces", "features", "structure", "assistant", "company"]);
    // the board is the reach read from the policy, not from the box alone
    expect(sections(facts({ ...base, caps: without("board.team"), board: null }))).not.toContain("overview");
  });

  it("the structure and the assistant are offered only when the policy says the person reads them", () => {
    expect(sections(facts({ role: "LEAD", caps: holding("LEAD"), development: true }))).toEqual(["reports", "structure"]);
    expect(sections(facts({ ownerRank: true, role: "OWNER", caps: holding("OWNER"), board: "owner", assistant: false, development: false }))).not.toContain("assistant");
  });
});

describe("addresses", () => {
  it("panelHref: the overview is the bare /owner, every other section has its own ?s=, a part and a carried filter ride along", () => {
    expect(panelHref("overview")).toBe("/owner");
    expect(panelHref("people")).toBe("/owner?s=people");
    expect(panelHref("integrations", "ai")).toBe("/owner?s=integrations&part=ai");
    expect(panelHref("assistant", undefined, { c: "abc" })).toBe("/owner?s=assistant&c=abc");
    expect(panelHref("overview", undefined, { space: "x" })).toBe("/owner?s=overview&space=x");
    expect(panelHref("structure", "development", { period: "2026-11", sort: undefined })).toBe("/owner?s=structure&part=development&period=2026-11");
    const all = PANEL_V2_SECTIONS.map((key) => panelHref(key));
    expect(new Set(all).size).toBe(all.length);
  });

  it("the first panel's ?v= leads to the section that holds it now", () => {
    expect(legacyPanelTarget("people")).toEqual({ section: "people" });
    expect(legacyPanelTarget("reports")).toEqual({ section: "reports" });
    expect(legacyPanelTarget("ai")).toEqual({ section: "integrations", part: "ai" });
    expect(legacyPanelTarget("overview")).toBeNull();
    expect(legacyPanelTarget(undefined)).toBeNull();
  });

  it("every moved address is a page on disk, has a section, and no two addresses share a destination", () => {
    expect(PANEL_REDIRECT_ADDRESSES).toEqual(["/analytics", "/members", "/spaces", "/structure", "/development", "/automation", "/telegram", "/archive", "/owner/assistant", "/owner/assistant/settings"]);
    const to: string[] = [];
    for (const address of PANEL_REDIRECT_ADDRESSES) {
      expect(existsSync(path.join(SRC, "app/(app)", address, "page.tsx")), address).toBe(true);
      const target = PANEL_REDIRECTS[address];
      expect(target && isPanelSection(target.section), address).toBe(true);
      const href = panelRedirectHref(address);
      expect(href, address).toMatch(/^\/owner\?s=/);
      to.push(href as string);
    }
    expect(new Set(to).size).toBe(to.length);
    expect(panelRedirectHref("/files")).toBeNull(); // the library is a page of its own
    expect(panelRedirectHref("/owner")).toBeNull();
    expect(panelRedirectHref("/owner/assistant", { c: "k1" })).toBe("/owner?s=assistant&c=k1");
  });

  it("an old link keeps what it said: the query rides to the section (the first value of each key), without the keys the panel uses itself", () => {
    expect(carriedQuery(undefined)).toEqual({});
    expect(carriedQuery({ google: "connected", new: ["person", "x"], empty: "", gone: undefined })).toEqual({ google: "connected", new: "person" });
    expect(carriedQuery({ s: "archive", part: "ai", v: "people", c: "k1" })).toEqual({ c: "k1" });
    expect(panelRedirectHref("/automation", carriedQuery({ google: "connected" }))).toBe("/owner?s=integrations&part=automation&google=connected");
    expect(panelRedirectHref("/members", carriedQuery({ new: "person" }))).toBe("/owner?s=accounts&new=person");
  });

  it("every old page asks the panel before it draws (and asks for ITS address)", () => {
    for (const address of PANEL_REDIRECT_ADDRESSES) {
      const file = read(path.posix.join("app/(app)", address, "page.tsx"));
      expect(file, address).toContain("panelRedirectFor(actor, \"" + address + "\"");
    }
    // «لوحتي» is not a section and does not depend on the board switch
    expect(myBoardHref("u 1")).toBe("/owner/people/u%201");
    const person = read("app/(app)/owner/people/[id]/page.tsx");
    expect(person).toContain("boardAccess(actor)"); // the board's own gate is still the first answer
    expect(person).toContain("myBoardAccess(actor)"); // «لوحتي»: the fallback, for the person's OWN id and only with the switch on
    expect(person).toMatch(/params\.id === actor\.userId && \(await actorFeatureOn\(actor, "controlPanelV2"\)\)/);
  });
});

describe("the scope chip", () => {
  const text = (scope: Parameters<typeof scopeChipOf>[0]) => {
    const chip = scopeChipOf(scope);
    expect(AR[chip.key], chip.key).toBeTruthy();
    return interpolate(AR[chip.key] as string, chip.params);
  };
  it("says the whole company, a space, several spaces, or the spaces the person can open", () => {
    expect(text({ kind: "company" })).toBe("كل الشركة");
    expect(text({ kind: "spaces", names: ["المبيعات"] })).toBe("مساحة: المبيعات");
    expect(text({ kind: "spaces", names: ["أ", "ب", "ج", "د"] })).toBe("مساحات (4): أ، ب، ج");
    expect(text({ kind: "spaces", names: [] })).toBe("ما في مساحة بنطاقك");
    expect(text({ kind: "accessible" })).toBe("المساحات المتاحة لك");
  });
});

describe("what «إعدادات الشركة» may write", () => {
  const ok = (value: unknown) => {
    const result = checkCompanySettings(value);
    expect(result.ok, JSON.stringify(value)).toBe(true);
    return result.ok ? result.value : null;
  };
  const refused = (value: unknown) => {
    const result = checkCompanySettings(value);
    expect(result.ok, JSON.stringify(value)).toBe(false);
    const key = result.ok ? "" : result.key;
    expect(AR[key], key).toBeTruthy();
    return key;
  };

  it("accepts a landing, up to two distinct optional tools, a strict order or null, and a valid time zone", () => {
    expect(ok({ landing: "chat" })).toEqual({ landing: "chat" });
    expect(ok({ landing: "today", workTabs: ["goals", "crm"] })).toEqual({ landing: "today", workTabs: ["goals", "crm"] });
    expect(ok({ workTabs: [] })).toEqual({ workTabs: [] });
    expect(ok({ menuOrder: null })).toEqual({ menuOrder: null });
    expect(ok({ menuOrder: { places: ["today", "chat"], tabs: { work: ["projects", "my-work"] } } })).toEqual({ menuOrder: { places: ["today", "chat"], tabs: { work: ["projects", "my-work"] } } });
    expect(ok({ timezone: "Asia/Amman" })).toEqual({ timezone: "Asia/Amman" });
  });

  it("refuses everything else with a dictionary key", () => {
    expect(refused({ landing: "owner" })).toBe("cpv2.company.e.landing");
    expect(refused({ landing: 1 })).toBe("cpv2.company.e.landing");
    expect(refused({ workTabs: ["goals", "ideas", "crm"] })).toBe("cpv2.company.e.work_tabs");
    expect(refused({ workTabs: ["files"] })).toBe("cpv2.company.e.work_tabs");
    expect(refused({ workTabs: ["goals", "goals"] })).toBe("cpv2.company.e.work_tabs");
    expect(refused({ workTabs: "goals" })).toBe("cpv2.company.e.work_tabs");
    expect(refused({ menuOrder: { places: ["x"], tabs: {} } })).toBe("cpv2.company.e.menu_order");
    expect(refused({ menuOrder: { places: ["today", "today"], tabs: {} } })).toBe("cpv2.company.e.menu_order");
    expect(refused({ menuOrder: { places: [], tabs: {}, extra: 1 } })).toBe("cpv2.company.e.menu_order");
    expect(refused({ timezone: "Nowhere/Land" })).toBe("cpv2.company.e.timezone");
    expect(refused({ timezone: "" })).toBe("cpv2.company.e.timezone");
    expect(refused({ name: "x" })).toBe("cpv2.company.e.unknown_key");
    expect(refused({ __proto__: { landing: "chat" }, other: 1 })).toBe("cpv2.company.e.unknown_key");
    expect(refused({})).toBe("cpv2.company.e.empty");
    expect(refused(null)).toBe("cpv2.company.e.invalid");
    expect(refused([])).toBe("cpv2.company.e.invalid");
    expect(refused("landing")).toBe("cpv2.company.e.invalid");
  });

  it("the time zones the screen offers are all valid, once each", () => {
    for (const zone of COMPANY_TIME_ZONES) expect(isValidTimeZone(zone.id), zone.id).toBe(true);
    expect(new Set(COMPANY_TIME_ZONES.map((z) => z.id)).size).toBe(COMPANY_TIME_ZONES.length);
  });
});

describe("the switch", () => {
  it("`controlPanelV2` exists, is OFF by default, sits with the owner's panels and needs the board", () => {
    expect(FEATURES).toContain("controlPanelV2");
    expect(featureOn({}, "controlPanelV2")).toBe(false);
    expect(featureOn({ features: { controlPanelV2: true } }, "controlPanelV2")).toBe(true);
    expect(FEATURE_META["controlPanelV2"]).toEqual({ group: "owner", dependsOn: ["ownerBoard"] });
    expect(AR["features.controlPanelV2.name"]).toBeTruthy();
    expect(AR["features.controlPanelV2.hint"]).toBeTruthy();
  });
});

// ───────────────────────────────────────── the screens ─────────────────────────────────────────

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const render = (node: ReactNode) => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Toasts, null, node)));
const { t } = getServerT();

describe("the frame", () => {
  it("draws the title once, the side list with the current section marked, and every name from the dictionary", () => {
    const html = renderToStaticMarkup(createElement(PanelFrame as unknown as FunctionComponent<Record<string, unknown>>, { t, sections: ["reports", "accounts", "company"], current: "accounts" }, createElement("p", null, "جسم")));
    expect(html.match(/<h1/g)?.length).toBe(1);
    expect(html).toContain("لوحة التحكم");
    expect([...html.matchAll(/data-panel-section="([a-z]+)"/g)].map((m) => m[1])).toEqual(["reports", "accounts", "company"]);
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(html).toMatch(/href="\/owner\?s=accounts"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/owner\?s=accounts"/);
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("data-panel-v2");
  });

  it("the section header repeats the section's name and its chip, nothing else about the rank", () => {
    const html = renderToStaticMarkup(createElement(SectionHeader, { t, section: "overview", hint: "تلميح", scope: { kind: "company" } }));
    expect(html).toContain("نظرة عامة");
    expect(html).toContain("كل الشركة");
    expect(renderToStaticMarkup(createElement(ScopeChip, { t, scope: { kind: "spaces", names: ["المبيعات"] } }))).toContain("مساحة: المبيعات");
  });

  it("every figure carries its chip: four KPI cards, four chips, the same words", () => {
    const kpis = { doneToday: 1, overdue: 2, open: 3, completedWeek: 4, completedPrev: 5, completedChange: null, onTimeRate: 90, onTimePrev: null, activeToday: 2, staff: 5 };
    const html = renderToStaticMarkup(createElement(KpiGrid, { t, kpis, scope: "مساحة: المبيعات" }));
    expect(html.match(/data-kpi="/g)?.length).toBe(4);
    expect(html.match(/data-scope/g)?.length).toBe(4);
    // the first panel's own page draws no chip: its callers do not pass one
    expect(renderToStaticMarkup(createElement(KpiGrid, { t, kpis })).match(/data-scope/g)).toBeNull();
  });
});

describe("the AI connection is ONE place", () => {
  it("the status panel in `single` mode draws no second form and no link to the old settings page; alone it still has its own form", () => {
    const Panel = ZakiAiPanel as FunctionComponent<{ single?: boolean }>;
    const single = render(createElement(Panel, { single: true }));
    expect(single).toContain('data-testid="zaki-ai-panel"');
    expect(single).not.toContain('data-testid="zaki-ai-form"');
    expect(single).not.toContain("/owner/assistant");
    const alone = render(createElement(Panel));
    expect(alone).toContain('data-testid="zaki-ai-form"');
  });

  it("the two old settings addresses lead to the same part, and the panel draws the form of AiSettings once (source)", () => {
    expect(panelRedirectHref("/owner/assistant/settings")).toBe(panelHref("integrations", "ai"));
    expect(legacyPanelTarget("ai")?.part).toBe("ai");
    const part = read("components/control-panel/sections/integrations-section.tsx");
    expect(part.match(/<SettingsForm/g)?.length).toBe(1);
    expect(part).toContain("single={place !== null}");
  });
});

describe("the company's settings form", () => {
  const initial = { timezone: "Asia/Damascus", landing: "chat", workTabs: ["goals"], dueHour: 18, menuOrder: null, personalOrders: 3 };

  it("has its blocks (the due hour among them), the ⚠️ with the 🔧 under it for the menu order, the number of people with an order of their own, and the D-N1 note", () => {
    const html = render(createElement(CompanySettingsForm, { initial }));
    for (const block of ["timezone", "duehour", "landing", "worktabs", "menuorder"]) expect(html, block).toContain(`data-block="${block}"`);
    expect(html).toContain("⚠️");
    expect(html).toContain("🔧");
    expect(html).toContain("عند 3 واحد ترتيب خاص فيه");
    expect(html).toContain(AR["cpv2.company.landing.pending"] as string);
    expect(html).toContain(AR["cpv2.company.tabs.slots"] as string);
    // the new map's places, in the code's order, each once
    expect([...html.matchAll(/data-order-place="([a-z]+)"/g)].map((m) => m[1])).toEqual(["chat", "today", "work", "library", "watch", "admin"]);
    // «مهامي» «المشاريع» «الطلبات» are the work tabs of the order; nothing from «المزيد»
    expect([...html.matchAll(/data-order-tab="([a-z-]+)"/g)].map((m) => m[1]).slice(0, 3)).toEqual(["my-work", "projects", "requests"]);
  });

  it("with no company order the clear button is not drawn; the pinned tools are the checkboxes, at most two", () => {
    const html = render(createElement(CompanySettingsForm, { initial }));
    expect(html).not.toContain(AR["cpv2.company.order.clear"] as string);
    const withOrder = render(createElement(CompanySettingsForm, { initial: { ...initial, menuOrder: { places: ["today"], tabs: {} } } }));
    expect(withOrder).toContain(AR["cpv2.company.order.clear"] as string);
    const checked = render(createElement(CompanySettingsForm, { initial: { ...initial, workTabs: ["goals", "ideas"] } }));
    // the third tool is disabled once two are pinned
    expect(checked.match(/type="checkbox"[^>]*disabled/g)?.length).toBeGreaterThanOrEqual(7);
  });
});

describe("the templates editor's model", () => {
  const view = STARTER_TEMPLATES.find((x) => x.id === "starter-view-only")!;
  const employee = STARTER_TEMPLATES.find((x) => x.id === "starter-employee")!;

  it("offers only boxes that do something and that the rank can hold: never `archive.view`, never a box a rank cannot be given", () => {
    for (const rank of ["ADMIN", "LEAD", "MEMBER"] as const) {
      const boxes = offeredFor(rank);
      expect(boxes.length).toBeGreaterThan(10);
      expect(boxes).not.toContain("archive.view");
      expect(new Set(boxes).size).toBe(boxes.length);
    }
    expect(offeredFor("MEMBER")).toContain("tasks.edit");
  });

  it("switching a box keeps the two lists disjoint, and a screen-built list is accepted by the server's strict check", () => {
    const off = withBox(employee, "tasks.edit", false);
    expect(off.revoked).toContain("tasks.edit");
    expect(off.caps).not.toContain("tasks.edit");
    expect(isOn(off, "tasks.edit")).toBe(false);
    const back = withBox(off, "tasks.edit", true);
    expect(back.revoked).not.toContain("tasks.edit");
    expect(isOn(back, "tasks.edit")).toBe(true);
    const extra = withBox(employee, "prices.view", true);
    expect(extra.caps).toContain("prices.view");
    expect(isOn(extra, "prices.view")).toBe(true);
    expect(isOn(withBox(extra, "prices.view", false), "prices.view")).toBe(false);
    const built = [off, extra, view].map((x, i) => ({ ...x, id: `t${i}`, name: `قالب ${i}` }));
    expect(checkTemplatesInput(built, () => "new").ok).toBe(true);
  });

  it("changing the rank brings the new rank's own defaults and carries no power over from the old one", () => {
    const admin = { id: "a", name: "مدير", rank: "ADMIN" as const, caps: [], revoked: ["crm.edit"] };
    const asMember = withRank(admin, "MEMBER");
    expect(asMember.rank).toBe("MEMBER");
    expect(asMember.caps).not.toContain("users.manage");
    expect(isOn(asMember, "users.manage")).toBe(false);
    expect(asMember.revoked).toContain("crm.edit");
    const extras = { id: "m", name: "محاسب", rank: "MEMBER" as const, caps: ["prices.view", "reports.view"], revoked: [] };
    const asLead = withRank(extras, "LEAD");
    // a lead already gives both: they are no longer extras, and nothing is revoked
    expect(asLead.caps).toEqual([]);
    expect(asLead.revoked).toEqual([]);
    expect(cleanTemplate(asLead)).toEqual(asLead);
  });

  it("the seven starters survive a round trip through the editor's rank change to the same rank", () => {
    for (const starter of STARTER_TEMPLATES) {
      const again = withRank(starter, starter.rank as "ADMIN" | "LEAD" | "MEMBER");
      expect(again, starter.id).toEqual(cleanTemplate(starter));
    }
  });
});

// ───────────────────────────────────────── the source ─────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("the shape of the source", () => {
  const sections = walk(path.join(SRC, "components/control-panel/sections"));
  const panel = [...walk(path.join(SRC, "components/control-panel")), ...walk(path.join(SRC, "components/templates-editor"))];

  it("a section only READS: no write call in any file of the sections, and no audit row, no notification", () => {
    expect(sections.length).toBeGreaterThanOrEqual(10);
    for (const file of sections) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/\bdb\.\w+\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\b/);
      expect(text, file).not.toMatch(/\baudit\(|pushNotification|markSeen/);
    }
  });

  it("every dictionary key the panel names exists (dynamic families included)", () => {
    const missing: string[] = [];
    for (const file of panel) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\bt\(\s*"(cpv2\.[a-z0-9_.]+)"/g)) if (!(match[1] as string in AR)) missing.push(`${path.relative(SRC, file)}: ${match[1]}`);
    }
    expect(missing).toEqual([]);
  });

  it("no hard-coded colour, no tiny text, no `text-white`: the theme tokens only", () => {
    for (const file of panel) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(text, file).not.toMatch(/\b(bg-black|bg-white|text-white|text-\[10px\]|text-\[11px\])\b/);
    }
  });

  it("the one write of the company's settings is a server action that only asks the service (no rule of its own)", () => {
    const action = read("components/control-panel/actions.ts");
    expect(action.startsWith('"use server"')).toBe(true);
    expect(action).toContain("saveCompanySettings(await requireActor()");
    expect(action).not.toMatch(/\bdb\./);
    expect(action.match(/export async function/g)?.length).toBe(1);
  });

  it("the old panel stays: /owner keeps its first-panel code path behind the switch, nothing is deleted", () => {
    const page = read("app/(app)/owner/page.tsx");
    expect(page).toContain('actorFeatureOn(actor, "controlPanelV2")');
    expect(page.indexOf('"controlPanelV2"')).toBeLessThan(page.indexOf("boardAccess(actor)"));
    expect(page).toContain("ControlPanelPage({ actor");
    expect(existsSync(path.join(SRC, "app/(app)/owner/control-panel-view.tsx"))).toBe(true);
  });

  it("the new strings are in their own fragment, registered in the dictionary", () => {
    expect(read("lib/i18n/dict.ts")).toContain('import controlPanelV2 from "./ar.control-panel-v2.json"');
    const fragment = JSON.parse(read("lib/i18n/ar.control-panel-v2.json")) as Record<string, string>;
    for (const [key, value] of Object.entries(fragment)) {
      expect(key.startsWith("cpv2."), key).toBe(true);
      expect(value, key).not.toMatch(/ـاً/);
      expect(value.replace(/\{[^{}]+\}/g, ""), key).not.toMatch(/[A-Za-z]{2,}/);
    }
  });
});
