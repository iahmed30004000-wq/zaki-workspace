import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  PANEL_ONE_NAV,
  PANEL_V2_SECTIONS,
  PEOPLE_PARTS,
  ONE_DOOR_SETTINGS_SECTIONS,
  panelHref,
  panelOneNavFor,
  panelSectionsFor,
  peoplePartOf,
  peoplePartFromQuery,
  BOARD_FILTER_KEYS,
  peoplePartsFor,
  type PanelFacts,
} from "@/lib/control-panel";
import { PANEL_REDIRECT_ADDRESSES, PANEL_REDIRECTS, carriedQuery, oneDoorHref, panelRedirectHref } from "@/lib/legacy-routes";
import { LEGACY_ROUTES, buildNav, locate, canOpenPlace, oneDoorHidesAdmin, type NavRole, type NavSubject } from "@/lib/nav/places";
import { AR } from "@/lib/i18n/dict";
import { getServerT } from "@/lib/i18n/server";
import { effectiveCapabilities, RANK_DEFAULTS } from "@/server/policy/capabilities";
import { PanelFrame, PartNav, SectionHeader } from "@/components/control-panel/frame";

(globalThis as { React?: typeof React }).React = React;

/**
 * S3.2 — «لوحة التحكم» as its own place with ONE navigation, and «الناس» as ONE section (switch `settingsOneDoor`, which needs `controlPanelV2`).
 * The rules that need a database (who is redirected where, the walk of the old addresses) are in tests/db/control-panel-people.test.ts.
 */

const SRC = path.resolve(__dirname, "../src");
const read = (file: string) => readFileSync(path.join(SRC, file), "utf8");

const facts = (over: Partial<PanelFacts> = {}): PanelFacts => ({ external: false, ownerRank: false, role: "MEMBER", caps: new Set<string>(), board: null, assistant: false, development: false, ...over });
const holding = (role: "OWNER" | "ADMIN" | "LEAD" | "MEMBER") => new Set<string>(RANK_DEFAULTS[role]);
const owner = (over: Partial<PanelFacts> = {}) => facts({ ownerRank: true, role: "OWNER", caps: holding("OWNER"), board: "owner", assistant: true, development: true, ...over });
const navOf = (f: PanelFacts) => panelOneNavFor(panelSectionsFor(f));
const { t } = getServerT();

describe("the ONE navigation: exactly six entries, in the owner's order", () => {
  it("PANEL_ONE_NAV is نظرة عامة · الناس · التقارير · الهيكل والأداء · الأرشيف والرقابة · مساعد المالك", () => {
    expect([...PANEL_ONE_NAV]).toEqual(["overview", "people", "reports", "structure", "archive", "assistant"]);
    expect(PANEL_ONE_NAV.map((key) => AR[`cpone.nav.${key}`])).toEqual(["نظرة عامة", "الناس", "التقارير", "الهيكل والأداء", "الأرشيف والرقابة", "مساعد المالك"]);
    // every entry is a section the panel already has (nothing is invented), the first one is the panel's first
    for (const key of PANEL_ONE_NAV) expect(PANEL_V2_SECTIONS as readonly string[]).toContain(key);
    expect(PANEL_ONE_NAV[0]).toBe("overview");
  });

  it("the four sections that are settings (company, features, integrations, spaces) are NOT in the navigation: they belong to «إعدادات الشركة»", () => {
    expect([...ONE_DOOR_SETTINGS_SECTIONS]).toEqual(["spaces", "features", "integrations", "company"]);
    // together with «الحسابات» (a part of «الناس») they are exactly the five sections the navigation does not list
    const unlisted = PANEL_V2_SECTIONS.filter((key) => !(PANEL_ONE_NAV as readonly string[]).includes(key));
    expect(unlisted).toEqual(["accounts", ...ONE_DOOR_SETTINGS_SECTIONS]);
    for (const key of ONE_DOOR_SETTINGS_SECTIONS) expect(PANEL_ONE_NAV as readonly string[], key).not.toContain(key);
    // «الحسابات» is not a navigation entry either: it is a part of «الناس»
    expect(PANEL_ONE_NAV as readonly string[]).not.toContain("accounts");
  });

  it("the owner sees all six; a guest none", () => {
    expect(navOf(owner())).toEqual([...PANEL_ONE_NAV]);
    expect(navOf(facts({ external: true, ownerRank: true, role: "OWNER", caps: holding("OWNER"), board: "owner", assistant: true, development: true }))).toEqual([]);
  });

  it("the capability guard is the panel's own: an admin gets «الناس» (through the accounts) and «التقارير»; a lead with the team board gets «نظرة عامة» and «الناس»; a member nothing", () => {
    expect(navOf(facts({ role: "ADMIN", caps: holding("ADMIN") }))).toEqual(["people", "reports"]);
    expect(navOf(facts({ role: "LEAD", caps: new Set(["board.team"]), board: "team" }))).toEqual(["overview", "people"]);
    expect(navOf(facts({ role: "LEAD", caps: holding("LEAD") }))).toEqual(["reports"]);
    expect(navOf(facts({ role: "MEMBER", caps: holding("MEMBER") }))).toEqual([]);
  });

  it("a partner follows what they hold: no `archive.view`, no archive entry; no assistant, no assistant entry; no `users.manage` and no board, no people", () => {
    const all = holding("OWNER");
    const without = (...gone: string[]) => new Set([...all].filter((c) => !gone.includes(c)));
    expect(navOf(owner({ caps: without("archive.view") }))).not.toContain("archive");
    expect(navOf(owner({ assistant: false }))).not.toContain("assistant");
    expect(navOf(owner({ development: false }))).not.toContain("structure");
    expect(navOf(owner({ caps: without("reports.view") }))).not.toContain("reports");
    expect(navOf(owner({ board: null, caps: without("users.manage") }))).not.toContain("people");
    // a person who holds ONLY settings sections has no entry (they are sent to the settings frame, never to an empty panel)
    expect(panelOneNavFor(["features", "company", "spaces", "integrations"])).toEqual([]);
  });

  it("the entries are a subset of what panelSectionsFor offers: the navigation can never open a section the panel refuses", () => {
    const people: PanelFacts[] = [owner(), facts({ role: "ADMIN", caps: holding("ADMIN") }), facts({ role: "LEAD", caps: new Set(["board.team"]), board: "team" }), facts({ role: "MEMBER", caps: holding("MEMBER") })];
    for (const f of people) {
      const offered = panelSectionsFor(f);
      for (const key of panelOneNavFor(offered)) {
        const open = key === "people" ? offered.includes("people") || offered.includes("accounts") : offered.includes(key);
        expect(open, `${f.role} ${key}`).toBe(true);
      }
    }
  });
});

describe("«الناس» is ONE section with parts", () => {
  it("the parts are accounts · templates · activity, each named, each its own address", () => {
    expect([...PEOPLE_PARTS]).toEqual(["accounts", "templates", "activity"]);
    for (const part of PEOPLE_PARTS) {
      expect(AR[`cpone.people.part.${part}`], part).toBeTruthy();
      expect(panelHref("people", part)).toBe(`/owner?s=people&part=${part}`);
    }
    expect(PEOPLE_PARTS.map((part) => AR[`cpone.people.part.${part}`])).toEqual(["الحسابات والصلاحيات", "قوالب الصلاحيات", "النشاط"]);
  });

  it("the owner holds the three parts; an admin only the accounts; a team lead only the activity table", () => {
    expect(peoplePartsFor(panelSectionsFor(owner()), true)).toEqual(["accounts", "templates", "activity"]);
    expect(peoplePartsFor(panelSectionsFor(facts({ role: "ADMIN", caps: holding("ADMIN") })), false)).toEqual(["accounts"]);
    expect(peoplePartsFor(panelSectionsFor(facts({ role: "LEAD", caps: new Set(["board.team"]), board: "team" })), false)).toEqual(["activity"]);
    expect(peoplePartsFor([], true)).toEqual([]);
  });

  it("the templates belong to the owner's rank only (the editor was never an admin's), and only next to the accounts", () => {
    expect(peoplePartsFor(["people"], true)).toEqual(["activity"]);
    expect(peoplePartsFor(["accounts"], false)).not.toContain("templates");
  });

  it("the part asked for: the first offered one when none is asked or the word is unknown; «permissions» leads to the accounts; a part that is not offered is refused (null)", () => {
    const parts = peoplePartsFor(panelSectionsFor(owner()), true);
    expect(peoplePartOf(undefined, parts)).toBe("accounts");
    expect(peoplePartOf("nonsense", parts)).toBe("accounts");
    expect(peoplePartOf("activity", parts)).toBe("activity");
    expect(peoplePartOf("templates", parts)).toBe("templates");
    expect(peoplePartOf("permissions", parts)).toBe("accounts");
    expect(peoplePartOf("templates", ["accounts"])).toBeNull();
    expect(peoplePartOf("activity", ["accounts"])).toBeNull();
    expect(peoplePartOf(undefined, ["activity"])).toBe("activity");
    expect(peoplePartOf(undefined, [])).toBeNull();
  });
});

describe("an old link to the activity table still lands on it", () => {
  const all = ["accounts", "templates", "activity"] as const;

  it("the board's filter keys are the ones the board reads", () => {
    expect([...BOARD_FILTER_KEYS]).toEqual(["range", "from", "to", "space", "person", "sort", "dir"]);
  });

  it("no part asked but a board filter in the address: the activity table, when it is offered (the old `?s=people&sort=…` was that table)", () => {
    expect(peoplePartFromQuery({ sort: "completed", dir: "desc" }, all)).toBe("activity");
    expect(peoplePartFromQuery({ range: "7" }, all)).toBe("activity");
    expect(peoplePartFromQuery({ space: ["x", "y"] }, all)).toBe("activity");
    expect(peoplePartFromQuery({ person: "u1" }, ["accounts", "activity"])).toBe("activity");
  });

  it("an empty filter is no filter; an asked part wins over a filter; with no activity offered the first part is the answer", () => {
    expect(peoplePartFromQuery({ sort: "" }, all)).toBe("accounts");
    expect(peoplePartFromQuery({}, all)).toBe("accounts");
    expect(peoplePartFromQuery({ part: "accounts", sort: "completed" }, all)).toBe("accounts");
    expect(peoplePartFromQuery({ part: "templates", space: "x" }, all)).toBe("templates");
    expect(peoplePartFromQuery({ sort: "completed" }, ["accounts"])).toBe("accounts");
    expect(peoplePartFromQuery({ part: "activity" }, ["accounts"])).toBeNull();
    expect(peoplePartFromQuery({ sort: "completed" }, [])).toBeNull();
  });
});

describe("the old addresses, with the switch ON", () => {
  it("«الناس» and «الحسابات» old addresses lead to the part, with the query they carried", () => {
    expect(oneDoorHref({ section: "accounts" })).toBe("/owner?s=people&part=accounts");
    expect(panelRedirectHref("/members", carriedQuery({ new: "person" }), true)).toBe("/owner?s=people&part=accounts&new=person");
    expect(oneDoorHref({ section: "people" })).toBe("/owner?s=people");
  });

  it("every other panel address keeps its own section; the structure address keeps its part", () => {
    expect(panelRedirectHref("/analytics", undefined, true)).toBe("/owner?s=reports");
    expect(panelRedirectHref("/structure", undefined, true)).toBe("/owner?s=structure&part=structure");
    expect(panelRedirectHref("/development", { period: "2026-11" }, true)).toBe("/owner?s=structure&part=development&period=2026-11");
    expect(panelRedirectHref("/archive", undefined, true)).toBe("/owner?s=archive");
    expect(panelRedirectHref("/owner/assistant", { c: "k1" }, true)).toBe("/owner?s=assistant&c=k1");
  });

  it("the addresses of the settings sections lead into «إعدادات الشركة» of the settings frame (never a panel with no entry for them)", () => {
    expect(panelRedirectHref("/spaces", undefined, true)).toBe("/settings/me/spaces");
    expect(panelRedirectHref("/automation", carriedQuery({ google: "connected" }), true)).toBe("/settings/me/integrations?part=automation&google=connected");
    expect(panelRedirectHref("/telegram", undefined, true)).toBe("/settings/me/integrations?part=telegram");
    expect(panelRedirectHref("/owner/assistant/settings", undefined, true)).toBe("/settings/me/integrations?part=ai");
    expect(oneDoorHref({ section: "features" })).toBe("/settings/me/features");
    expect(oneDoorHref({ section: "company" }, { x: "1" })).toBe("/settings/me/company?x=1");
  });

  it("OFF is byte for byte today: the third argument is optional and its default is the old answer for every address", () => {
    expect(panelRedirectHref("/members")).toBe("/owner?s=accounts");
    expect(panelRedirectHref("/members", undefined, false)).toBe("/owner?s=accounts");
    expect(panelRedirectHref("/spaces")).toBe("/owner?s=spaces");
    for (const address of PANEL_REDIRECT_ADDRESSES) expect(panelRedirectHref(address), address).toBe(panelRedirectHref(address, undefined, false));
  });

  it("every old address still has a page on disk and a destination on both paths; no two addresses share one", () => {
    const to: string[] = [];
    for (const address of PANEL_REDIRECT_ADDRESSES) {
      expect(existsSync(path.join(SRC, "app/(app)", address, "page.tsx")), address).toBe(true);
      expect(PANEL_REDIRECTS[address], address).toBeTruthy();
      const href = panelRedirectHref(address, undefined, true);
      expect(href, address).toMatch(/^\/(owner\?s=|settings\/me\/)/);
      to.push(href as string);
    }
    expect(new Set(to).size).toBe(to.length);
    expect(panelRedirectHref("/files", undefined, true)).toBeNull();
    // the two old addresses the owner named, /members and /analytics, are still on the list of legacy routes
    expect(LEGACY_ROUTES).toContain("/members");
    expect(LEGACY_ROUTES).toContain("/analytics");
  });
});

describe("the map: «لوحة التحكم» is the place of an admin, not a row inside the settings", () => {
  const who = (role: NavRole, extra: Partial<NavSubject> = {}): NavSubject => ({ role, caps: [...effectiveCapabilities({ role })], ...extra });
  const door = { settingsOneDoor: true, panel: true } as const;

  for (const navV2 of [false, true]) {
    it(`navV2 ${navV2}: the owner and an admin get ONE place «لوحة التحكم» to /owner with no tab strip, in the slot «الإدارة» had`, () => {
      for (const role of ["OWNER", "ADMIN"] as const) {
        const before = buildNav(who(role, { navV2 })).places;
        const after = buildNav(who(role, { navV2, ...door })).places;
        expect(after.map((p) => p.key), role).toEqual(before.map((p) => p.key));
        const place = after[after.length - 1];
        expect(place?.key).toBe("admin");
        expect(place?.href).toBe("/owner");
        expect(place?.labelKey).toBe("nav.place.controlPanel");
        expect(AR["nav.place.controlPanel"]).toBe("لوحة التحكم");
        expect(place?.tabs).toEqual([]);
        // no second navigation: the panel draws its own, so the place carries no «المزيد» either
        expect(place?.more ?? []).toEqual([]);
        // the other places are exactly as before
        expect(after.slice(0, -1)).toEqual(before.slice(0, -1));
      }
    });
  }

  it("every address of the panel is located in that place, so the menu marks it while the person is in the panel", () => {
    for (const map of ["v1", "v2"] as const) {
      for (const address of ["/owner", "/owner/people/x", "/owner/assistant", "/members", "/analytics", "/archive", "/structure", "/development"]) expect(locate(address, map).place, `${map} ${address}`).toBe("admin");
    }
  });

  it("staff keep what they had: a lead keeps «الإدارة» and its tabs, a member keeps «الناس», a guest is untouched; OFF and `panel` alone change nothing", () => {
    for (const navV2 of [false, true]) {
      for (const role of ["LEAD", "MEMBER", "GUEST"] as const) expect(buildNav(who(role, { navV2, ...door })), `${role} ${navV2}`).toEqual(buildNav(who(role, { navV2 })));
      for (const role of ["OWNER", "ADMIN", "LEAD", "MEMBER", "GUEST"] as const) {
        const plain = buildNav(who(role, { navV2 }));
        expect(buildNav(who(role, { navV2, panel: true })), `${role} ${navV2}`).toEqual(plain);
        expect(buildNav(who(role, { navV2, settingsOneDoor: true })), `${role} ${navV2}`).toEqual(plain);
      }
    }
    const member = buildNav(who("MEMBER", { navV2: true, ...door })).places.find((p) => p.key === "admin");
    expect(member?.labelKey).toBe("nav.place.people");
    expect(member?.tabs.map((tab) => tab.key)).toEqual(expect.arrayContaining(["team", "board"]));
    expect(oneDoorHidesAdmin(who("ADMIN", door))).toBe(true);
    expect(oneDoorHidesAdmin(who("LEAD", door))).toBe(false);
  });

  it("the place is offered exactly when the old rule offered the panel: canOpenPlace agrees", () => {
    expect(canOpenPlace(who("OWNER", { navV2: true, ...door }), "admin")).toBe(true);
    expect(canOpenPlace(who("ADMIN", { navV2: true, ...door }), "admin")).toBe(true);
    expect(canOpenPlace(who("GUEST", { navV2: true, ...door }), "admin")).toBe(false);
  });
});

describe("the frame: one navigation and no second list", () => {
  const Frame = PanelFrame as unknown as FunctionComponent<Record<string, unknown>>;
  const nav = ["overview", "people", "reports", "structure", "archive", "assistant"];
  const html = renderToStaticMarkup(createElement(Frame, { t, sections: nav, current: "people", oneNav: true }, createElement("p", null, "جسم")));

  it("draws exactly the six entries, once, with the current one marked, under the names of the owner's list", () => {
    expect([...html.matchAll(/data-panel-section="([a-z]+)"/g)].map((m) => m[1])).toEqual(nav);
    expect(html.match(/<nav\b/g)?.length).toBe(1);
    expect(html.match(/<h1/g)?.length).toBe(1);
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(html).toMatch(/href="\/owner\?s=people"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/owner\?s=people"/);
    for (const key of nav) expect(html).toContain(AR[`cpone.nav.${key}`] as string);
    expect(html).toContain("data-panel-one");
    expect(html).toContain("جسم");
  });

  it("the entries are links to the panel's addresses (no script) and the structure entry is called «الهيكل والأداء», not «الهيكل والتطوير»", () => {
    expect(html).toContain('href="/owner"');
    expect(html).toContain('href="/owner?s=structure"');
    expect(html).toContain("الهيكل والأداء");
    expect(html).not.toContain("الهيكل والتطوير");
  });

  it("without `oneNav` the frame is today's list (the eleven-section frame is untouched)", () => {
    const old = renderToStaticMarkup(createElement(Frame, { t, sections: ["reports", "accounts", "company"], current: "accounts" }, createElement("p", null, "جسم")));
    expect([...old.matchAll(/data-panel-section="([a-z]+)"/g)].map((m) => m[1])).toEqual(["reports", "accounts", "company"]);
    expect(old).not.toContain("data-panel-one");
    expect(old).toContain("الحسابات والصلاحيات");
  });

  it("a section header can wear the navigation's name (the heading and the entry say the same word)", () => {
    const head = renderToStaticMarkup(createElement(SectionHeader as unknown as FunctionComponent<Record<string, unknown>>, { t, section: "structure", title: AR["cpone.nav.structure"] }));
    expect(head).toContain("الهيكل والأداء");
    expect(head).not.toContain("الهيكل والتطوير");
    expect(renderToStaticMarkup(createElement(SectionHeader, { t, section: "structure" }))).toContain("الهيكل والتطوير");
  });

  it("the parts of «الناس» are the existing PartNav (links, the current one marked)", () => {
    const parts = PEOPLE_PARTS.map((key) => ({ key, href: panelHref("people", key), name: t(`cpone.people.part.${key}`), current: key === "templates" }));
    const out = renderToStaticMarkup(createElement(PartNav, { label: t("cpone.people.nav"), parts }));
    expect([...out.matchAll(/data-panel-part="([a-z]+)"/g)].map((m) => m[1])).toEqual([...PEOPLE_PARTS]);
    expect(out.match(/aria-current="page"/g)?.length).toBe(1);
  });
});

describe("the shape of the source", () => {
  it("the people section MOVES the three existing bodies (the accounts view, the templates editor, the activity table): nothing is rebuilt, nothing is deleted", () => {
    const one = read("components/control-panel/sections/people-section.tsx");
    expect(one).toContain("OrgMembersView");
    expect(one).toContain("PartNav");
    expect(one).toContain("PeopleSection");
    expect(one).toContain("TemplatesPart");
    // the old section «الحسابات والصلاحيات» still exists for the panel with the switch OFF
    const accounts = read("components/control-panel/sections/accounts-section.tsx");
    expect(accounts).toContain("OrgMembersView");
    expect(accounts).toContain("TemplatesPart");
    expect(accounts).toContain("export async function AccountsSection");
    expect(read("components/control-panel/sections/board-sections.tsx")).toContain("export async function PeopleSection");
    // the one shared person card stays one component (S5.5 adds the verification control there)
    expect(existsSync(path.join(SRC, "components/members/member-card.tsx"))).toBe(true);
    expect(existsSync(path.join(SRC, "components/members/member-sheet.tsx"))).toBe(true);
    expect(one).not.toMatch(/MemberCard|MemberSheet/);
  });

  it("the panel asks its own switch and its own capability checks: the one-door page adds no rank rule of its own", () => {
    const view = read("components/control-panel/panel-one.tsx");
    expect(view).toContain("panelOneNavFor");
    expect(read("components/control-panel/sections/people-section.tsx")).toContain("peoplePartsFor");
    expect(view).not.toMatch(/\.role\s*===\s*"(ADMIN|OWNER)"/);
    expect(view).not.toMatch(/rankAtLeast/);
    const entry = read("components/control-panel/panel-v2.tsx");
    expect(entry).toContain("panelOneDoorOn(actor)");
    // OFF: the old frame code path is still the next line of the same function
    expect(entry).toContain("bodyOf(section, ctx)");
    expect(read("server/services/control-panel.ts")).toContain("export async function panelOneDoorOn");
  });

  it("every old page still asks the panel for ITS address (the walk test relies on it)", () => {
    for (const address of PANEL_REDIRECT_ADDRESSES) {
      const file = read(path.posix.join("app/(app)", address, "page.tsx"));
      expect(file, address).toContain('panelRedirectFor(actor, "' + address + '"');
    }
  });

  it("the new strings are in their own fragment, registered in the dictionary, Arabic only", () => {
    expect(read("lib/i18n/dict.ts")).toContain('import controlPanelPeople from "./ar.control-panel-people.json"');
    const fragment = JSON.parse(read("lib/i18n/ar.control-panel-people.json")) as Record<string, string>;
    expect(Object.keys(fragment).length).toBeGreaterThan(10);
    for (const [key, value] of Object.entries(fragment)) {
      expect(key.startsWith("cpone.") || key === "nav.place.controlPanel", key).toBe(true);
      expect(value, key).not.toMatch(/ـاً/);
      expect(value.replace(/\{[^{}]+\}/g, ""), key).not.toMatch(/[A-Za-z]{2,}/);
    }
  });

  it("no hard-coded colour, no tiny text, no `text-white` in the new files", () => {
    for (const file of ["components/control-panel/panel-one.tsx", "components/control-panel/sections/people-section.tsx"]) {
      const text = read(file);
      expect(text, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(text, file).not.toMatch(/\b(bg-black|bg-white|text-white|text-\[10px\]|text-\[11px\]|text-\[10\.5px\])\b/);
    }
  });
});
