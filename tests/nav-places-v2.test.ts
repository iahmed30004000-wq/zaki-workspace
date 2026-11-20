import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OrgRole } from "@prisma/client";
import { AR } from "@/lib/i18n/dict";
import { featureOn, featuresOff } from "@/lib/features";
import {
  LEGACY_ROUTES,
  MAX_TABS,
  NAV_ROLES,
  PLACES,
  PLACES_V1,
  PLACES_V2,
  WORK_OPTIONAL_TABS,
  buildNav,
  canOpenTab,
  locate,
  offeredToGuests,
  type NavModel,
  type NavPlace,
  type NavSubject,
  type PlaceKey,
  type TabKey,
} from "@/lib/nav/places";
import { applyNavOrder, menuOrderFor, readCompanyMenuOrder, readNavOrder } from "@/lib/nav/order";
import { DEFAULT_LANDING, LANDINGS, landingOf, navExtrasOf, orgSettingsSchema, transparencyVersionOf, workTabsOf } from "@/server/policy/org-settings";
import { CAPABILITIES, effectiveCapabilities } from "@/server/policy/capabilities";
import { navSubjectOf } from "@/server/services/nav-order";

const ROOT = path.resolve(__dirname, "..");

/** A person as the layout sees them, on the NEW map (switch `navV2` ON). */
function v2(role: OrgRole, switches: { capabilities?: string[]; revokedCapabilities?: string[] } = {}, more: Partial<NavSubject> = {}): NavSubject {
  return { role, caps: [...effectiveCapabilities({ role, ...switches })], navV2: true, ...more };
}

const keys = (nav: NavModel) => nav.places.map((p) => p.key);
const place = (nav: NavModel, key: PlaceKey): NavPlace => {
  const found = nav.places.find((p) => p.key === key);
  if (!found) throw new Error(`no place ${key} in ${keys(nav).join(",")}`);
  return found;
};
const tabs = (nav: NavModel, key: PlaceKey) => place(nav, key).tabs.map((t) => t.key);
const more = (nav: NavModel, key: PlaceKey) => (place(nav, key).more ?? []).map((t) => t.key);

const WORK_OPTIONAL: TabKey[] = ["goals", "ideas", "production", "departments", "tickets", "campaigns", "crm", "checkins"];
const ORDER_V2 = ["chat", "today", "work", "library", "watch", "admin"];

describe("navV2 OFF: the old map is untouched (PLACES_V1)", () => {
  it("a person without the flag, or with it false, gets exactly the old map", () => {
    for (const role of NAV_ROLES) {
      const caps = [...effectiveCapabilities({ role })];
      const old = buildNav({ role, caps });
      expect(buildNav({ role, caps, navV2: false }), role).toEqual(old);
      expect(keys(old).slice(0, 2), role).toEqual(["today", "chat"]);
      // the old map never carries the new fields
      for (const p of old.places) expect(p, `${role} ${p.key}`).not.toHaveProperty("more");
    }
  });

  it("PLACES is PLACES_V1 (the name the old tests and the shell know), and the two maps are different lists", () => {
    expect(PLACES).toBe(PLACES_V1);
    expect(PLACES_V1.map((p) => p.key)).toEqual(["today", "chat", "work", "library", "watch", "admin"]);
    expect(PLACES_V2.map((p) => p.key)).toEqual(ORDER_V2);
  });
});

describe("navV2 ON: the new map, rank by rank", () => {
  it("OWNER: the six places with the chat first; work = «مهامي» «المشاريع» «الطلبات» and the optional tools under «المزيد»", () => {
    const nav = buildNav(v2("OWNER"));
    expect(keys(nav)).toEqual(ORDER_V2);
    expect(tabs(nav, "work")).toEqual(["my-work", "projects", "requests"]);
    expect(more(nav, "work")).toEqual(WORK_OPTIONAL);
    expect(tabs(nav, "library")).toEqual(["files", "documents", "knowledge"]);
    expect(tabs(nav, "admin")).toEqual(["team", "board", "settings", "structure"]);
    expect(more(nav, "admin")).toEqual(["development", "assistant", "automation", "telegram", "archive"]);
    expect(place(nav, "admin")).toMatchObject({ labelKey: "nav.place.admin", href: "/members", icon: "admin" });
    expect(place(nav, "today")).toMatchObject({ labelKey: "nav.place.today", tabs: [], more: [] });
  });

  it("ADMIN: team, the control panel, settings, reports, and the integrations under «المزيد»", () => {
    const nav = buildNav(v2("ADMIN"));
    expect(keys(nav)).toEqual(ORDER_V2);
    expect(tabs(nav, "work")).toEqual(["my-work", "projects", "requests"]);
    expect(tabs(nav, "admin")).toEqual(["team", "board", "settings", "reports"]);
    expect(more(nav, "admin")).toEqual(["automation", "telegram"]);
    expect(place(nav, "admin").labelKey).toBe("nav.place.admin");
  });

  it("LEAD: team, the panel and the reports; no «المزيد» in the admin place", () => {
    const nav = buildNav(v2("LEAD"));
    expect(tabs(nav, "admin")).toEqual(["team", "board", "reports"]);
    expect(more(nav, "admin")).toEqual([]);
    expect(place(nav, "admin").labelKey).toBe("nav.place.admin");
  });

  it("MEMBER: the place is called «الناس» (the directory + «لوحتي»), never «الإدارة»", () => {
    const nav = buildNav(v2("MEMBER"));
    expect(keys(nav)).toEqual(ORDER_V2);
    expect(tabs(nav, "work")).toEqual(["my-work", "projects", "requests"]);
    expect(more(nav, "work")).toEqual(WORK_OPTIONAL);
    expect(tabs(nav, "admin")).toEqual(["team", "board"]);
    expect(place(nav, "admin")).toMatchObject({ labelKey: "nav.place.people", href: "/members", icon: "team" });
    expect(place(nav, "admin").tabs.find((t) => t.key === "board")).toEqual({ key: "board", href: "/owner", labelKey: "nav.tab.boardSelf" });
    expect(AR["nav.place.people"]).toBe("الناس");
  });

  it("MEMBER given users.manage or integrations.manage has admin power: the place is «الإدارة» again", () => {
    expect(place(buildNav(v2("MEMBER", { capabilities: ["users.manage"] })), "admin").labelKey).toBe("nav.place.admin");
    expect(tabs(buildNav(v2("MEMBER", { capabilities: ["users.manage"] })), "admin")).toEqual(["team", "board", "settings"]);
    expect(tabs(buildNav(v2("MEMBER", { capabilities: ["integrations.manage"] })), "admin")).toEqual(["team", "board", "automation", "telegram"]);
    expect(place(buildNav(v2("MEMBER", { capabilities: ["integrations.manage"] })), "admin").labelKey).toBe("nav.place.admin");
  });

  it("a member who manages the space they are in is offered «المساحة» right after «الناس»", () => {
    const nav = buildNav(v2("MEMBER", {}, { spaceManager: true }));
    expect(tabs(nav, "admin")).toEqual(["team", "space", "board"]);
    expect(place(nav, "admin").labelKey).toBe("nav.place.admin");
  });

  it("the place has no hidden name games: one rule (admin power = «الإدارة», otherwise «الناس»), one icon per name", () => {
    for (const role of ["OWNER", "ADMIN", "LEAD", "MEMBER"] as const) {
      const admin = place(buildNav(v2(role)), "admin");
      expect(["nav.place.admin", "nav.place.people"], role).toContain(admin.labelKey);
      expect(admin.icon, role).toBe(admin.labelKey === "nav.place.people" ? "team" : "admin");
    }
    // a member with the directory switched off and «لوحتي» left: still «الناس»
    const lonely = buildNav(v2("MEMBER", { revokedCapabilities: ["directory.view"] }));
    expect(place(lonely, "admin")).toMatchObject({ labelKey: "nav.place.people", href: "/owner" });
    expect(keys(buildNav(v2("MEMBER", { revokedCapabilities: ["directory.view", "board.self"] })))).toEqual(["chat", "today", "work", "library", "watch"]);
  });

  it("GUEST: chat, today, work (two tabs, no «الطلبات», no «المزيد») and the documents; nothing of the company's", () => {
    const nav = buildNav(v2("GUEST"));
    expect(keys(nav)).toEqual(["chat", "today", "work", "library"]);
    expect(tabs(nav, "work")).toEqual(["my-work", "projects"]);
    expect(more(nav, "work")).toEqual([]);
    expect(tabs(nav, "library")).toEqual(["documents"]);
    expect(place(nav, "library")).toMatchObject({ href: "/documents" });
    // whatever was stored for them
    const stored = buildNav({ role: "GUEST", caps: [...CAPABILITIES], navV2: true, spaceManager: true, workTabs: ["crm", "goals"] });
    expect(stored).toEqual(nav);
  });

  it("an unknown rank is an outsider on the new map too", () => {
    const nav = buildNav({ role: "SUPERUSER" as unknown as NavSubject["role"], caps: [...CAPABILITIES], navV2: true });
    expect(keys(nav)).toEqual(["chat", "today", "work", "library"]);
  });

  it("a switched-off feature leaves the map: «الطلبات» with `approvals`, «المنتجات» with `knowledgeCards`, «التسجيل اليومي» with `checkins`, «نتفرّج سوا» with `watch`", () => {
    const off = (list: NavSubject["off"]) => buildNav(v2("OWNER", {}, { off: list }));
    // W1.4: «الطلبات» holds more than approvals (assignment requests, tickets, cards, sheets): it leaves only when BOTH its own switch and `approvals` are off
    expect(tabs(off(["approvals", "workRequests"]), "work")).toEqual(["my-work", "projects"]);
    expect(tabs(off(["approvals"]), "work")).toEqual(["my-work", "projects", "requests"]);
    expect(tabs(off(["workRequests"]), "work")).toEqual(["my-work", "projects", "requests"]);
    expect(tabs(off(["knowledgeCards"]), "library")).toEqual(["files", "documents"]);
    expect(more(off(["checkins"]), "work")).not.toContain("checkins");
    expect(keys(off(["watch"]))).toEqual(["chat", "today", "work", "library", "admin"]);
  });

  it("every place lands on a page that exists today", () => {
    const nav = buildNav(v2("OWNER"));
    expect(Object.fromEntries(nav.places.map((p) => [p.key, p.href]))).toEqual({
      chat: "/chat",
      today: "/?view=today",
      work: "/my-work",
      library: "/files",
      watch: "/watch",
      admin: "/members",
    });
  });

  it("places whose page is built later point at today's page: «مهامي» my-work, «المنتجات» /knowledge, the admin tabs the old ones", () => {
    const nav = buildNav(v2("OWNER"));
    const hrefOf = (p: PlaceKey, k: TabKey) => [...place(nav, p).tabs, ...(place(nav, p).more ?? [])].find((t) => t.key === k)?.href;
    // W1.4: «الطلبات» has its own page; the approvals pages stay pages of the same tab
    expect(hrefOf("work", "requests")).toBe("/requests");
    expect(hrefOf("work", "my-work")).toBe("/my-work");
    expect(hrefOf("work", "projects")).toBe("/projects");
    expect(hrefOf("library", "knowledge")).toBe("/knowledge");
    expect(hrefOf("admin", "settings")).toBe("/settings");
    expect(hrefOf("admin", "board")).toBe("/owner");
    expect(hrefOf("admin", "team")).toBe("/members");
  });

  it("the names: «الطلبات», «المزيد», «لوحة التحكم» for the owner and «لوحتي» for the rest, never «لوحة المالك» or «لوحة الفريق»", () => {
    expect(AR["nav.tab.requests"]).toBe("الطلبات");
    expect(AR["nav.tab.more"]).toBe("المزيد");
    const board = (s: NavSubject) => place(buildNav(s), "admin").tabs.find((t) => t.key === "board")?.labelKey;
    expect(board(v2("OWNER"))).toBe("nav.tab.controlPanel");
    expect(board(v2("OWNER", {}, { off: ["controlPanel"] }))).toBe("nav.tab.controlPanel");
    expect(board(v2("LEAD", { capabilities: ["board.team"] }))).toBe("nav.tab.controlPanel");
    for (const role of ["ADMIN", "LEAD", "MEMBER"] as const) expect(board(v2(role)), role).toBe("nav.tab.boardSelf");
    expect(AR["nav.tab.controlPanel"]).toBe("لوحة التحكم");
    expect(AR["nav.tab.boardSelf"]).toBe("لوحتي");
  });
});

describe("at most four tabs plus «المزيد», and the owner's two pinned tools", () => {
  const SUBJECTS: [string, NavSubject][] = [
    ...NAV_ROLES.map((role): [string, NavSubject] => [role, v2(role)]),
    ["OWNER pinning two", v2("OWNER", {}, { workTabs: ["crm", "goals"] })],
    ["MEMBER managing a space", v2("MEMBER", {}, { spaceManager: true })],
    ["MEMBER supervising", v2("MEMBER", {}, { supervisor: true })],
    ["MEMBER + everything", v2("MEMBER", { capabilities: [...CAPABILITIES] }, { spaceManager: true, supervisor: true })],
    ["ADMIN + supervising + space", v2("ADMIN", {}, { spaceManager: true, supervisor: true })],
    ["OWNER with every switch off", v2("OWNER", {}, { off: featuresOff({ features: Object.fromEntries(["approvals", "knowledgeCards", "checkins", "watch"].map((k) => [k, false])) }) })],
  ];

  it("MAX_TABS is four, and no person's place ever has more", () => {
    expect(MAX_TABS).toBe(4);
    for (const [label, subject] of SUBJECTS) for (const p of buildNav(subject).places) expect(p.tabs.length, `${label} ${p.key}`).toBeLessThanOrEqual(4);
  });

  it("a tab is in `tabs` or in `more`, never both, and the two together are everything the person may open", () => {
    for (const [label, subject] of SUBJECTS) {
      for (const p of buildNav(subject).places) {
        const inTabs = p.tabs.map((t) => t.key);
        const inMore = (p.more ?? []).map((t) => t.key);
        expect(new Set([...inTabs, ...inMore]).size, `${label} ${p.key}`).toBe(inTabs.length + inMore.length);
        for (const key of [...inTabs, ...inMore]) expect(canOpenTab(subject, key), `${label} ${key}`).toBe(true);
      }
    }
  });

  it("the owner pins up to two optional tools: they follow the core tabs, in the owner's order, while there is room", () => {
    // with «الطلبات» on there is one free slot: the first pin takes it, the second waits in «المزيد» (never lost)
    const nav = buildNav(v2("OWNER", {}, { workTabs: ["crm", "goals"] }));
    expect(tabs(nav, "work")).toEqual(["my-work", "projects", "requests", "crm"]);
    expect(more(nav, "work")).toEqual(WORK_OPTIONAL.filter((k) => k !== "crm"));
    // without «الطلبات» (its switch off) both pins have room
    const two = buildNav(v2("OWNER", {}, { workTabs: ["crm", "goals"], off: ["approvals", "workRequests"] }));
    expect(tabs(two, "work")).toEqual(["my-work", "projects", "crm", "goals"]);
    expect(more(two, "work")).toEqual(WORK_OPTIONAL.filter((k) => k !== "crm" && k !== "goals"));
  });

  it("a pin the person may not open, a duplicate, an unknown key or a core tab is ignored; only the first two count", () => {
    const base = tabs(buildNav(v2("OWNER", {}, { off: ["approvals", "workRequests"] })), "work");
    const pinned = (workTabs: string[], extra: Partial<NavSubject> = {}) => tabs(buildNav(v2("OWNER", {}, { off: ["approvals", "workRequests"], workTabs, ...extra })), "work");
    expect(pinned(["nowhere"])).toEqual(base);
    expect(pinned(["projects", "my-work", "files"])).toEqual(base);
    expect(pinned(["crm", "crm"])).toEqual([...base, "crm"]);
    expect(pinned(["crm", "goals", "ideas"])).toEqual([...base, "crm", "goals"]);
    expect(pinned([], {})).toEqual(base);
    // a person without the `crm.view` box is not given the tab by the pin
    const noCrm = buildNav(v2("MEMBER", { revokedCapabilities: ["crm.view", "crm.edit"] }, { off: ["approvals", "workRequests"], workTabs: ["crm", "goals"] }));
    expect(tabs(noCrm, "work")).toEqual(["my-work", "projects", "goals"]);
  });

  it("a person who may open none of the core tabs but an optional tool still gets a place with a tab (never an empty strip with a dead link)", () => {
    // staff with the work boxes switched off and «الطلبات» off: only the optional tools are left
    const nav = buildNav(v2("MEMBER", { revokedCapabilities: ["tasks.view", "projects.view"] }, { off: ["approvals", "workRequests"] }));
    const work = place(nav, "work");
    expect(work.tabs.length).toBeGreaterThan(0);
    expect(work.tabs[0]?.key).toBe("goals");
    expect(work.href).toBe(work.tabs[0]?.href);
    expect(work.tabs.length).toBeLessThanOrEqual(4);
    expect([...work.tabs, ...(work.more ?? [])].map((t) => t.key)).toEqual(WORK_OPTIONAL);
  });

  it("WORK_OPTIONAL_TABS is the eight optional tools", () => {
    expect([...WORK_OPTIONAL_TABS]).toEqual(WORK_OPTIONAL);
  });
});

describe("every tab offered is a page that serves that person, and a tab not offered to guests refuses them", () => {
  const ALL_V2: TabKey[] = PLACES_V2.flatMap((p) => [...p.tabs, ...(p.more ?? [])].map((t) => t.key));
  const pageFile = (href: string) => path.join(ROOT, "src", "app", "(app)", ...(href.split(/[?#]/, 1)[0] ?? "").split("/").filter(Boolean), "page.tsx");

  it("every link of the new map, for every kind of person, is a page of the app", () => {
    const hrefs = new Set<string>();
    for (const def of PLACES_V2) {
      if (def.href) hrefs.add(def.href);
      for (const tab of [...def.tabs, ...(def.more ?? [])]) hrefs.add(tab.href);
    }
    for (const role of NAV_ROLES) {
      for (const p of buildNav(v2(role, {}, { spaceManager: true, supervisor: true })).places) [p.href, ...p.tabs.map((t) => t.href), ...(p.more ?? []).map((t) => t.href)].forEach((h) => hrefs.add(h));
    }
    expect(hrefs.size).toBeGreaterThanOrEqual(18);
    for (const href of hrefs) expect(existsSync(pageFile(href)), href).toBe(true);
  });

  it("canOpenTab agrees with buildNav on the new map: open exactly when the map draws it (tabs or «المزيد»)", () => {
    const people: NavSubject[] = [...NAV_ROLES.map((r) => v2(r)), v2("MEMBER", {}, { spaceManager: true, supervisor: true }), v2("OWNER", {}, { workTabs: ["crm"] })];
    for (const subject of people) {
      const nav = buildNav(subject);
      const drawn = new Set(nav.places.flatMap((p) => [...p.tabs, ...(p.more ?? [])].map((t) => t.key)));
      for (const key of ALL_V2) expect(canOpenTab(subject, key), `${subject.role} / ${key}`).toBe(drawn.has(key));
    }
  });

  it("a guest is offered my-work, projects and the documents, and not one tab more, whatever was stored for them", () => {
    const stored: NavSubject = { role: "GUEST", caps: [...CAPABILITIES], navV2: true, spaceManager: true, supervisor: true };
    expect(ALL_V2.filter((key) => canOpenTab(stored, key))).toEqual(["my-work", "projects", "documents"]);
  });

  it("offeredToGuests keeps saying no to «الطلبات» and every staff tab of the new map", () => {
    expect(offeredToGuests("requests")).toBe(false);
    for (const key of ALL_V2.filter((k) => !["my-work", "projects", "documents", "list", "calendar"].includes(k))) expect(offeredToGuests(key), key).toBe(false);
  });

  // N1.2 wired the switch: navSubjectOf (src/server/services/nav-order.ts) spreads navExtrasOf(settings) into the subject (it was a todo until then)
  it("navSubjectOf hands navV2 and workTabs to the map (N1.2)", () => {
    const actor = { role: "MEMBER" as const, caps: effectiveCapabilities({ role: "MEMBER" }), isExternal: false };
    const settings = { features: { navV2: true }, workTabs: ["goals", "ideas", "crm"] };
    const subject = navSubjectOf(actor, settings, null);
    expect(subject).toMatchObject({ navV2: true, workTabs: navExtrasOf(settings).workTabs });
    expect(keys(buildNav(subject))[0]).toBe("chat");
    // OFF (the default): the old map, whatever else the settings say
    expect(navSubjectOf(actor, { workTabs: ["goals"] }, null).navV2).toBe(false);
    expect(keys(buildNav(navSubjectOf(actor, {}, null)))[0]).toBe("today");
  });

  it("the same menu for two members of the same rank", () => {
    const a = buildNav(v2("MEMBER"));
    const b = buildNav(v2("MEMBER"));
    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it("every label the new map can produce exists in the dictionary", () => {
    for (const subject of [...NAV_ROLES.map((r) => v2(r)), v2("OWNER", {}, { spaceManager: true, supervisor: true })]) {
      for (const p of buildNav(subject).places) {
        expect(AR[p.labelKey], p.labelKey).toBeTruthy();
        for (const t of [...p.tabs, ...(p.more ?? [])]) expect(AR[t.labelKey], t.labelKey).toBeTruthy();
      }
    }
  });
});

describe("where an address lives on the new map (the old addresses stay pages)", () => {
  it("the views of «مهامي» (/list, /calendar) and the approvals page have a home; /list and /calendar are sent to /my-work only behind workMyTasks (W1.1)", () => {
    expect(locate("/list", "v2")).toEqual({ place: "work", tab: "my-work" });
    expect(locate("/calendar", "v2")).toEqual({ place: "work", tab: "my-work" });
    expect(locate("/approvals", "v2")).toEqual({ place: "work", tab: "requests" });
    expect(locate("/approvals/abc", "v2")).toEqual({ place: "work", tab: "requests" });
    expect(locate("/approvals/forms", "v2")).toEqual({ place: "work", tab: "requests" });
    expect(locate("/requests", "v2")).toEqual({ place: "work", tab: "requests" });
    expect(locate("/?view=today", "v2")).toEqual({ place: "today", tab: null });
    expect(locate("/", "v2")).toEqual({ place: "today", tab: null });
    expect(locate("/chat", "v2")).toEqual({ place: "chat", tab: null });
    expect(locate("/tasks/x", "v2")).toEqual({ place: "work", tab: null });
    expect(locate("/goals", "v2")).toEqual({ place: "work", tab: "goals" });
    expect(locate("/knowledge/x", "v2")).toEqual({ place: "library", tab: "knowledge" });
    // the old map is the default and says what it always said
    expect(locate("/list")).toEqual({ place: "work", tab: "list" });
    expect(locate("/approvals")).toEqual({ place: "work", tab: "approvals" });
  });

  it("every LEGACY_ROUTES entry keeps a place on the new map (the profile alone has none)", () => {
    for (const route of LEGACY_ROUTES) {
      const sample = route.replace(/\[[^\]]+\]/g, "x");
      const found = locate(sample, "v2");
      if (route === "/profile") expect(found, route).toEqual({ place: null, tab: null });
      else expect(found.place, route).not.toBeNull();
    }
  });

  it("the pages of the old tabs «القائمة» and «التقويم» still exist on disk; they send to «مهامي» ONLY behind the switch workMyTasks (W1.1)", () => {
    for (const route of ["list", "calendar"]) expect(existsSync(path.join(ROOT, "src", "app", "(app)", route, "page.tsx")), route).toBe(true);
    for (const route of ["list", "calendar"]) {
      const source = readFileSync(path.join(ROOT, "src", "app", "(app)", route, "page.tsx"), "utf8");
      // never an unconditional redirect: the company's switch is asked first, so the default (OFF) keeps today's page
      expect(source, `${route} is not redirected to /my-work without the switch`).not.toMatch(/redirect\(\s*["'`]\/my-work/);
      expect(source, route).toContain(`if (await actorFeatureOn(actor, "workMyTasks")) redirect(legacyViewHref("${route}", searchParams));`);
    }
  });

  it("W1.1: «مهامي» is /my-work on both maps; /list and /calendar stay its home (`also`), and the old map stops drawing them as tabs only when the switch says so", () => {
    expect(locate("/my-work?view=board&scope=space", "v2")).toEqual({ place: "work", tab: "my-work" });
    expect(locate("/my-work?task=abc", "v2")).toEqual({ place: "work", tab: "my-work" });
    const v1Tabs = (subject: NavSubject) => buildNav(subject).places.find((p) => p.key === "work")!.tabs.map((t) => t.key);
    const member = { role: "MEMBER" as const, caps: [...effectiveCapabilities({ role: "MEMBER" })] };
    // OFF (nothing handed over: the default): the old map is exactly what it was
    expect(v1Tabs(member)).toEqual(expect.arrayContaining(["my-work", "list", "calendar"]));
    expect(v1Tabs({ ...member, workMyTasks: false })).toEqual(expect.arrayContaining(["my-work", "list", "calendar"]));
    // ON: the two views are inside «مهامي», so two tabs fewer; every other tab is where it was
    const on = v1Tabs({ ...member, workMyTasks: true });
    expect(on).toContain("my-work");
    expect(on).not.toContain("list");
    expect(on).not.toContain("calendar");
    expect(on).toEqual(v1Tabs(member).filter((k) => k !== "list" && k !== "calendar"));
    // a tab that is not drawn is not offered either (the same answer everywhere)
    expect(canOpenTab({ ...member, workMyTasks: true }, "list")).toBe(false);
    expect(canOpenTab({ ...member, workMyTasks: true }, "my-work")).toBe(true);
    // a guest keeps «مهامي» on both maps with the switch on, and the new map is unchanged by it
    const guest = { role: "GUEST" as const, caps: [], workMyTasks: true };
    expect(canOpenTab(guest, "my-work")).toBe(true);
    expect(canOpenTab({ ...guest, navV2: true }, "my-work")).toBe(true);
    expect(tabs(buildNav(v2("MEMBER", {}, { workMyTasks: true })), "work")).toEqual(tabs(buildNav(v2("MEMBER")), "work"));
  });
});

describe("the company settings this package defines: landing, workTabs, menuOrder, and the switch", () => {
  it("«navV2» is a switch, OFF by default; navExtrasOf carries it and the pinned tabs to the map", () => {
    expect(featureOn({}, "navV2")).toBe(false);
    expect(navExtrasOf({})).toEqual({ navV2: false, workTabs: [] });
    expect(navExtrasOf({ features: { navV2: true }, workTabs: ["crm", "goals"] })).toEqual({ navV2: true, workTabs: ["crm", "goals"] });
    expect(navExtrasOf(null)).toEqual({ navV2: false, workTabs: [] });
  });

  it("the landing page: «الدردشة» by default (D-N1, awaiting the owner), «اليوم» when the company says so; a broken value is the default", () => {
    expect([...LANDINGS]).toEqual(["chat", "today"]);
    expect(DEFAULT_LANDING).toBe("chat");
    expect(landingOf({})).toBe("chat");
    expect(landingOf(null)).toBe("chat");
    expect(landingOf({ landing: "today" })).toBe("today");
    expect(landingOf({ landing: "chat" })).toBe("chat");
    for (const broken of ["nowhere", 3, null, ["today"], {}]) expect(landingOf({ landing: broken }), JSON.stringify(broken)).toBe("chat");
  });

  it("workTabsOf keeps only the optional tools, once each, at most two", () => {
    expect(workTabsOf({})).toEqual([]);
    expect(workTabsOf({ workTabs: ["crm", "goals", "ideas"] })).toEqual(["crm", "goals"]);
    expect(workTabsOf({ workTabs: ["crm", "crm", "projects", "x", 3, "ideas"] })).toEqual(["crm", "ideas"]);
    expect(workTabsOf({ workTabs: "crm" })).toEqual([]);
  });

  it("a broken landing or workTabs never costs the company its transparency version", () => {
    const settings = { transparencyVersion: 4, landing: "nowhere", workTabs: "x", menuOrder: 5 };
    expect(transparencyVersionOf(settings)).toBe(4);
    expect(orgSettingsSchema.safeParse(settings).success).toBe(true);
  });

  it("the company's menu order: when it is set it wins, the person's own order stays stored and is not changed", () => {
    const personal = readNavOrder({ places: ["library", "work"], tabs: {} });
    const company = readCompanyMenuOrder({ menuOrder: { places: ["work", "chat"], tabs: {} } });
    expect(company).toEqual({ places: ["work", "chat"], tabs: {} });
    const before = JSON.stringify(personal);
    expect(menuOrderFor(company, personal)).toEqual({ order: company, source: "company", personalLocked: true });
    expect(JSON.stringify(personal), "the person's order is never rewritten").toBe(before);
    // no company order: the person's own order is used again, and nothing is locked
    expect(menuOrderFor(null, personal)).toEqual({ order: personal, source: "person", personalLocked: false });
    expect(menuOrderFor(null, null)).toEqual({ order: null, source: "code", personalLocked: false });
    expect(readCompanyMenuOrder({})).toBeNull();
    expect(readCompanyMenuOrder({ menuOrder: "x" })).toBeNull();
    // it is applied over the map like any order: it never reveals anything
    const nav = applyNavOrder(buildNav(v2("GUEST")), company);
    expect(keys(nav)).toEqual(["work", "library", "chat", "today"]);
  });

  it("the screen's warning and its fix are in the dictionary, together", () => {
    expect(AR["navv2.order.company_locked"]).toBe("الترتيب صار للشركة كلها");
    expect(AR["navv2.order.company_fix"]).toBe("اطلب من المدير يغيّره");
  });
});

describe("the module stays pure", () => {
  it("places.ts and order.ts import no React, nothing from Next and nothing from the server", () => {
    for (const file of ["places.ts", "order.ts"]) {
      const source = readFileSync(path.join(ROOT, "src", "lib", "nav", file), "utf8");
      expect(source, file).not.toMatch(/from\s+["'](?:react|next\/|@\/server|@prisma)/);
    }
  });
});
