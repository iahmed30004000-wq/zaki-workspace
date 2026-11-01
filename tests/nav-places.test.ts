import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { OrgRole } from "@prisma/client";
import { AR } from "@/lib/i18n/dict";
import {
  LEGACY_ROUTES,
  NAV_ROLES,
  PLACES,
  buildNav,
  canOpenTab,
  locate,
  offeredToGuests,
  placeOfPath,
  rankAtLeast,
  tabOfPath,
  type NavModel,
  type NavPlace,
  type NavSubject,
  type PlaceKey,
  type TabKey,
} from "@/lib/nav/places";
import { CAPABILITIES, effectiveCapabilities } from "@/server/policy/capabilities";
import { RANK } from "@/server/policy/rank";

const ROOT = path.resolve(__dirname, "..");

/** A person as the layout sees them: the rank and the EFFECTIVE capabilities (rank defaults, plus/minus the owner's switches). */
function who(role: OrgRole, switches: { capabilities?: string[]; revokedCapabilities?: string[] } = {}): NavSubject {
  return { role, caps: [...effectiveCapabilities({ role, ...switches })] };
}

const keys = (nav: NavModel) => nav.places.map((p) => p.key);
const place = (nav: NavModel, key: PlaceKey): NavPlace => {
  const found = nav.places.find((p) => p.key === key);
  if (!found) throw new Error(`no place ${key} in ${keys(nav).join(",")}`);
  return found;
};
const tabs = (nav: NavModel, key: PlaceKey) => place(nav, key).tabs.map((t) => t.key);

const WORK_ALL: TabKey[] = ["my-work", "projects", "list", "calendar", "goals", "ideas", "production", "departments", "tickets", "campaigns", "crm", "approvals", "checkins"];
// goals and ideas are the team's own (docs/PHASE0-AUDIT.md R10): a guest is offered the four tabs about their own work
const WORK_GUEST: TabKey[] = ["my-work", "projects", "list", "calendar"];
// «لوحتي» (`board.self`) is on by rank for every staff rank (the owner's ask, 2026-10-30), so each of them has the «board» tab
const ADMIN_ALL: TabKey[] = ["team", "board", "reports", "automation", "telegram", "settings"];
// «مساعد المالك» is the OWNER rank's alone, right after «لوحة المالك» (it is drawn while its switch in «الميزات» is on)
// «الهيكل» and «الأداء والتطوير» (2026-10-31): the owner reads both; everybody else only when they supervise somebody or hold `people.review` / `people.manage_lines`
const ADMIN_OWNER: TabKey[] = ["team", "board", "assistant", "structure", "development", "reports", "automation", "telegram", "settings", "archive"];

describe("the five places, for each kind of person", () => {
  it("OWNER: the six places; the work place has its nine tabs and the admin place includes the owner-only archive tab", () => {
    const nav = buildNav(who("OWNER"));
    expect(keys(nav)).toEqual(["today", "chat", "work", "library", "watch", "admin"]);
    expect(tabs(nav, "work")).toEqual(WORK_ALL);
    expect(tabs(nav, "admin")).toEqual(ADMIN_OWNER);
    expect(place(nav, "admin")).toMatchObject({ labelKey: "nav.place.admin", href: "/members", icon: "admin" });
  });

  it("ADMIN (rank defaults): the same map as the owner", () => {
    const nav = buildNav(who("ADMIN"));
    expect(keys(nav)).toEqual(["today", "chat", "work", "library", "watch", "admin"]);
    expect(tabs(nav, "work")).toEqual(WORK_ALL);
    expect(tabs(nav, "admin")).toEqual(ADMIN_ALL);
    expect(place(nav, "admin").labelKey).toBe("nav.place.admin");
  });

  it("LEAD: the team and the reports; no integrations, no settings", () => {
    const nav = buildNav(who("LEAD"));
    expect(keys(nav)).toEqual(["today", "chat", "work", "library", "watch", "admin"]);
    expect(tabs(nav, "admin")).toEqual(["team", "board", "reports"]);
    expect(place(nav, "admin").labelKey).toBe("nav.place.admin");
  });

  it("MEMBER (rank defaults): the team and «لوحتي», under «الإدارة»", () => {
    const nav = buildNav(who("MEMBER"));
    expect(keys(nav)).toEqual(["today", "chat", "work", "library", "watch", "admin"]);
    expect(tabs(nav, "work")).toEqual(WORK_ALL);
    expect(tabs(nav, "admin")).toEqual(["team", "board"]);
    expect(place(nav, "admin")).toMatchObject({ labelKey: "nav.place.admin", href: "/members" });
    expect(place(nav, "admin").tabs.find((t) => t.key === "board")).toEqual({ key: "board", href: "/owner", labelKey: "nav.tab.boardSelf" });
  });

  it("MEMBER given users.manage: the team and the settings, under «الإدارة»", () => {
    const nav = buildNav(who("MEMBER", { capabilities: ["users.manage"] }));
    expect(tabs(nav, "admin")).toEqual(["team", "board", "settings"]);
    expect(place(nav, "admin").labelKey).toBe("nav.place.admin");
  });

  it("MEMBER given users.manage whose directory.view was switched off: the Team tab stays, because /members is their people manager", () => {
    const nav = buildNav(who("MEMBER", { capabilities: ["users.manage"], revokedCapabilities: ["directory.view"] }));
    expect(tabs(nav, "admin")).toEqual(["team", "board", "settings"]);
    expect(place(nav, "admin")).toMatchObject({ labelKey: "nav.place.admin", href: "/members" });
  });

  it("LEAD given users.manage with directory.view switched off: team, reports and settings", () => {
    const nav = buildNav(who("LEAD", { capabilities: ["users.manage"], revokedCapabilities: ["directory.view"] }));
    expect(tabs(nav, "admin")).toEqual(["team", "board", "reports", "settings"]);
  });

  it("ADMIN with both users.manage and directory.view switched off has no Team tab (and no settings): nothing opens it", () => {
    const nav = buildNav(who("ADMIN", { revokedCapabilities: ["users.manage", "directory.view"] }));
    expect(tabs(nav, "admin")).toEqual(["board", "reports", "automation", "telegram"]);
  });

  it("MEMBER given integrations.manage: automation and Telegram appear (two tabs)", () => {
    const nav = buildNav(who("MEMBER", { capabilities: ["integrations.manage"] }));
    expect(tabs(nav, "admin")).toEqual(["team", "board", "automation", "telegram"]);
  });

  it("MEMBER whose directory.view was switched off: the admin place is «لوحتي» alone (the owner's switch «لوحتي» is on by rank)", () => {
    const nav = buildNav(who("MEMBER", { revokedCapabilities: ["directory.view"] }));
    expect(keys(nav)).toEqual(["today", "chat", "work", "library", "watch", "admin"]);
    expect(place(nav, "admin")).toMatchObject({ labelKey: "nav.tab.boardSelf", href: "/owner" });
  });

  it("MEMBER whose directory.view and «لوحتي» were both switched off: no admin place at all («نتفرّج سوا» stays)", () => {
    const nav = buildNav(who("MEMBER", { revokedCapabilities: ["directory.view", "board.self"] }));
    expect(keys(nav)).toEqual(["today", "chat", "work", "library", "watch"]);
  });

  it("LEAD whose directory.view was switched off still has the reports, which then name the place", () => {
    const nav = buildNav(who("LEAD", { revokedCapabilities: ["directory.view", "board.self"] }));
    expect(tabs(nav, "admin")).toEqual(["reports"]);
    expect(place(nav, "admin")).toMatchObject({ labelKey: "nav.analytics", href: "/analytics", icon: "reports" });
  });

  it("MEMBER whose crm.view was switched off: no «العملاء» tab", () => {
    const nav = buildNav(who("MEMBER", { revokedCapabilities: ["crm.view", "crm.edit"] }));
    expect(tabs(nav, "work")).toEqual(WORK_ALL.filter((t) => t !== "crm"));
  });

  it("GUEST (external partner): Today, Chat, Work and the library (documents only) — no admin — and four work tabs", () => {
    const nav = buildNav(who("GUEST"));
    expect(keys(nav)).toEqual(["today", "chat", "work", "library"]);
    expect(tabs(nav, "work")).toEqual(WORK_GUEST);
    // «المستندات»: a partner reads only the documents shared with them (the service decides); never the files
    expect(tabs(nav, "library")).toEqual(["documents"]);
    expect(place(nav, "library")).toMatchObject({ href: "/documents" });
  });

  it("GUEST: with «المستندات» switched off the library is gone for them, as before", () => {
    expect(keys(buildNav({ ...who("GUEST"), off: ["spaceDocs"] }))).toEqual(["today", "chat", "work"]);
    // a member keeps the files tab when only the documents are off
    expect(tabs(buildNav({ ...who("MEMBER"), off: ["spaceDocs"] }), "library")).toEqual(["files"]);
  });

  it("GUEST: a capability somebody stored for them changes nothing (a guest holds none)", () => {
    const nav = buildNav({ role: "GUEST", caps: ["crm.view", "directory.view", "users.manage", "integrations.manage"] });
    expect(keys(nav)).toEqual(["today", "chat", "work", "library"]);
    expect(tabs(nav, "library")).toEqual(["documents"]);
    expect(tabs(nav, "work")).toEqual(WORK_GUEST);
  });

  it("an unknown rank is treated like an outsider, never like staff", () => {
    const nav = buildNav({ role: "SUPERUSER" as unknown as NavSubject["role"], caps: ["crm.view", "directory.view", "users.manage"] });
    expect(keys(nav)).toEqual(["today", "chat", "work", "library"]);
  });

  it("every place lands on a page: Today on /, chat on /chat, work on /my-work, the library on /files", () => {
    const nav = buildNav(who("OWNER"));
    expect(Object.fromEntries(nav.places.map((p) => [p.key, p.href]))).toEqual({
      today: "/",
      chat: "/chat",
      work: "/my-work",
      library: "/files",
      admin: "/members",
      watch: "/watch",
    });
    expect(place(nav, "today").tabs).toEqual([]);
    expect(place(nav, "chat").tabs).toEqual([]);
  });

  it("the single-tab name rule is the admin place's alone: the library keeps «المكتبة» with its one tab", () => {
    const nav = buildNav(who("MEMBER"));
    expect(tabs(nav, "library")).toEqual(["files", "documents"]);
    expect(place(nav, "library").labelKey).toBe("nav.place.library");
  });

  it("the map is plain data the server can hand to the browser (icons are names, never components)", () => {
    for (const role of NAV_ROLES) {
      const nav = buildNav(who(role));
      expect(JSON.parse(JSON.stringify(nav)), role).toEqual(nav);
      for (const p of nav.places) expect(typeof p.icon, `${role} ${p.key}`).toBe("string");
    }
  });

  it("the rank order is the policy's (LEAD or above means LEAD, ADMIN, OWNER)", () => {
    for (const a of NAV_ROLES) {
      for (const b of NAV_ROLES) expect(rankAtLeast(a, b), `${a} >= ${b}`).toBe(RANK[a] >= RANK[b]);
    }
    expect([...NAV_ROLES].sort()).toEqual(Object.keys(RANK).sort());
  });
});

describe("«الإدارة» is the last place, and «المساحة» is its tab for whoever manages the space", () => {
  it("the admin place comes after every other place, on the computer's menu and the phone's bar (they read this order)", () => {
    expect(PLACES.map((p) => p.key)).toEqual(["today", "chat", "work", "library", "watch", "admin"]);
    const people: [string, NavSubject][] = [
      ["OWNER", who("OWNER")],
      ["ADMIN", who("ADMIN")],
      ["LEAD", who("LEAD")],
      ["MEMBER", who("MEMBER")],
      ["MEMBER managing a space", { ...who("MEMBER"), spaceManager: true }],
    ];
    for (const [label, subject] of people) expect(buildNav(subject).places.at(-1)?.key, label).toBe("admin");
    // with the watch place switched off the admin place is still last
    expect(keys(buildNav({ ...who("OWNER"), off: ["watch"] }))).toEqual(["today", "chat", "work", "library", "admin"]);
  });

  it("a person who manages the space they are in is offered the «المساحة» tab, right after the team", () => {
    for (const role of ["OWNER", "ADMIN", "LEAD", "MEMBER"] as const) {
      const nav = buildNav({ ...who(role), spaceManager: true });
      expect(tabs(nav, "admin")[0], role).toBe("team");
      expect(tabs(nav, "admin")[1], role).toBe("space");
      expect(place(nav, "admin").tabs.find((t) => t.key === "space")).toEqual({ key: "space", href: "/spaces/current", labelKey: "nav.tab.space" });
    }
  });

  it("nobody else is offered it: no flag, flag off, or an external partner whatever was stored", () => {
    for (const role of NAV_ROLES) {
      expect(canOpenTab(who(role), "space"), `${role} without the flag`).toBe(false);
      expect(canOpenTab({ ...who(role), spaceManager: false }, "space"), `${role} flag off`).toBe(false);
    }
    expect(canOpenTab({ role: "GUEST", caps: [...CAPABILITIES], spaceManager: true }, "space")).toBe(false);
    expect(canOpenTab({ role: "SUPERUSER" as unknown as NavSubject["role"], caps: [...CAPABILITIES], spaceManager: true }, "space")).toBe(false);
    expect(offeredToGuests("space")).toBe(false);
    expect(keys(buildNav({ role: "GUEST", caps: [], spaceManager: true }))).toEqual(["today", "chat", "work", "library"]);
  });

  it("a space manager whose directory switch is off still gets the admin place, called by its one tab", () => {
    const nav = buildNav({ ...who("MEMBER", { revokedCapabilities: ["directory.view", "board.self"] }), spaceManager: true });
    expect(tabs(nav, "admin")).toEqual(["space"]);
    expect(place(nav, "admin")).toMatchObject({ labelKey: "nav.tab.space", href: "/spaces/current" });
  });

  it("the address belongs to «الإدارة» / «المساحة»; «كل المساحات» stays no tab of any place", () => {
    expect(locate("/spaces/current")).toEqual({ place: "admin", tab: "space" });
    expect(locate("/spaces")).toEqual({ place: null, tab: null });
  });

  it("the two entries moved off the projects page: «تعديل المساحة» and «أعضاء المساحة» are on the space page", () => {
    const projects = readFileSync(path.join(ROOT, "src/app/(app)/projects/page.tsx"), "utf8");
    expect(projects).not.toContain("WorkspaceEditButton");
    const page = readFileSync(path.join(ROOT, "src/app/(app)/spaces/current/page.tsx"), "utf8");
    expect(page).toContain("WorkspaceEditButton");
    expect(page).toContain("WorkspaceMembersButton");
    expect(AR["nav.tab.space"]).toBe("المساحة");
  });
});

describe("canOpenTab / offeredToGuests: the one rule behind «is this tab offered to this person»", () => {
  const ALL_TABS: TabKey[] = PLACES.flatMap((p) => p.tabs.map((t) => t.key));

  /** Every kind of person the map is drawn for: the five ranks, plus the switches that change a map. */
  const SUBJECTS: [string, NavSubject][] = [
    ...NAV_ROLES.map((role): [string, NavSubject] => [role, who(role)]),
    ["MEMBER + users.manage", who("MEMBER", { capabilities: ["users.manage"] })],
    ["MEMBER + users.manage - directory.view", who("MEMBER", { capabilities: ["users.manage"], revokedCapabilities: ["directory.view"] })],
    ["MEMBER + integrations.manage", who("MEMBER", { capabilities: ["integrations.manage"] })],
    ["MEMBER - directory.view", who("MEMBER", { revokedCapabilities: ["directory.view"] })],
    ["MEMBER - crm.view", who("MEMBER", { revokedCapabilities: ["crm.view", "crm.edit"] })],
    ["LEAD - directory.view", who("LEAD", { revokedCapabilities: ["directory.view"] })],
    ["ADMIN - users.manage", who("ADMIN", { revokedCapabilities: ["users.manage"] })],
    ["MEMBER who manages the space they are in", { ...who("MEMBER"), spaceManager: true }],
    ["MEMBER - directory.view who manages the space", { ...who("MEMBER", { revokedCapabilities: ["directory.view"] }), spaceManager: true }],
    ["GUEST with every capability stored and the manager flag", { role: "GUEST", caps: [...CAPABILITIES], spaceManager: true }],
    ["GUEST with every capability stored", { role: "GUEST", caps: [...CAPABILITIES] }],
    ["an unknown rank with every capability", { role: "SUPERUSER" as unknown as NavSubject["role"], caps: [...CAPABILITIES] }],
  ];

  it("the tabs are the twenty-six of the map, each once", () => {
    expect(ALL_TABS).toHaveLength(26);
    expect(new Set(ALL_TABS).size).toBe(26);
  });

  it("agrees with buildNav for every tab and every kind of person: a tab is open exactly when the map draws it", () => {
    for (const [label, subject] of SUBJECTS) {
      const drawn = new Set(buildNav(subject).places.flatMap((p) => p.tabs.map((t) => t.key)));
      for (const key of ALL_TABS) expect(canOpenTab(subject, key), `${label} / ${key}`).toBe(drawn.has(key));
    }
  });

  it("a tab whose place is closed to the person is closed to them, whatever the tab alone would say", () => {
    // «files» is for staff and so is its place: a guest holding every capability still gets neither
    expect(canOpenTab({ role: "GUEST", caps: [...CAPABILITIES] }, "files")).toBe(false);
    expect(canOpenTab(who("MEMBER"), "files")).toBe(true);
  });

  it("an unknown tab is open to nobody, not even the owner", () => {
    for (const [label, subject] of SUBJECTS) expect(canOpenTab(subject, "nowhere" as unknown as TabKey), label).toBe(false);
  });

  it("offeredToGuests: exactly my work, projects, list, calendar and the documents shared with partners", () => {
    expect(ALL_TABS.filter((key) => offeredToGuests(key))).toEqual([...WORK_GUEST, "documents"]);
    expect(ALL_TABS.filter((key) => !offeredToGuests(key))).toEqual(
      ["goals", "ideas", "production", "departments", "tickets", "campaigns", "crm", "approvals", "checkins", "files", "team", "space", "board", "assistant", "structure", "development", "reports", "automation", "telegram", "settings", "archive"],
    );
  });

  it("goals and ideas are staff-only: every rank but the guest (docs/PHASE0-AUDIT.md R10)", () => {
    for (const key of ["goals", "ideas"] as const) {
      for (const role of NAV_ROLES) expect(canOpenTab(who(role), key), `${role} / ${key}`).toBe(role !== "GUEST");
    }
  });

  it("a guest is never offered more than offeredToGuests says, whatever capabilities were stored for them", () => {
    const stored: NavSubject = { role: "GUEST", caps: [...CAPABILITIES] };
    for (const key of ALL_TABS) expect(canOpenTab(stored, key), key).toBe(offeredToGuests(key));
  });
});

/** Where each old address lives now: [place, tab]. */
const WHERE: Record<(typeof LEGACY_ROUTES)[number], [PlaceKey | null, TabKey | null]> = {
  "/": ["today", null],
  "/chat": ["chat", null],
  "/my-work": ["work", "my-work"],
  "/projects": ["work", "projects"],
  "/projects/[id]": ["work", "projects"],
  "/projects/[id]/timeline": ["work", "projects"],
  "/boards/[id]": ["work", "projects"],
  "/tasks/[id]": ["work", null],
  "/list": ["work", "list"],
  "/calendar": ["work", "calendar"],
  "/goals": ["work", "goals"],
  "/ideas": ["work", "ideas"],
  "/production": ["work", "production"],
  "/departments": ["work", "departments"],
  "/teams": ["admin", "team"],
  "/members": ["admin", "team"],
  "/files": ["library", "files"],
  "/documents": ["library", "documents"],
  "/crm": ["work", "crm"],
  "/analytics": ["admin", "reports"],
  "/automation": ["admin", "automation"],
  "/telegram": ["admin", "telegram"],
  "/settings": ["admin", "settings"],
  "/profile": [null, null],
  "/u/[id]": ["admin", "team"],
};

describe("every old address still has a home (placeOfPath / tabOfPath)", () => {
  it("LEGACY_ROUTES is every page the briefing lists, /documents included, once each", () => {
    expect([...LEGACY_ROUTES].sort()).toEqual(Object.keys(WHERE).sort());
    expect(new Set(LEGACY_ROUTES).size).toBe(LEGACY_ROUTES.length);
    expect(LEGACY_ROUTES).toContain("/documents");
  });

  for (const route of Object.keys(WHERE) as (typeof LEGACY_ROUTES)[number][]) {
    const [p, t] = WHERE[route];
    it(`${route} -> ${p ?? "no place"} / ${t ?? "no tab"}`, () => {
      expect(placeOfPath(route)).toBe(p);
      expect(tabOfPath(route)).toBe(t);
      expect(locate(route)).toEqual({ place: p, tab: t });
    });
  }

  it("real dynamic addresses: a task, a project's timeline, a board, a person", () => {
    expect(locate("/tasks/abc")).toEqual({ place: "work", tab: null });
    expect(locate("/projects/x/timeline")).toEqual({ place: "work", tab: "projects" });
    expect(locate("/projects/x")).toEqual({ place: "work", tab: "projects" });
    expect(locate("/boards/y")).toEqual({ place: "work", tab: "projects" });
    expect(locate("/u/z")).toEqual({ place: "admin", tab: "team" });
  });

  it("pages that belong to no place: the profile, the guide, the onboarding, anything unknown", () => {
    for (const p of ["/profile", "/guide", "/guide/tasks", "/onboarding", "/login", "/nowhere", "/x/y/z"]) {
      expect(locate(p), p).toEqual({ place: null, tab: null });
    }
  });

  it("matches whole segments, ignores the query, the hash and a trailing slash", () => {
    expect(locate("/projectsx")).toEqual({ place: null, tab: null });
    expect(locate("/files-old")).toEqual({ place: null, tab: null });
    expect(locate("/projects?workspace=abc")).toEqual({ place: "work", tab: "projects" });
    expect(locate("/my-work#today")).toEqual({ place: "work", tab: "my-work" });
    expect(locate("/calendar/")).toEqual({ place: "work", tab: "calendar" });
    expect(locate("/?x=1")).toEqual({ place: "today", tab: null });
    expect(locate("")).toEqual({ place: null, tab: null });
    expect(locate("projects")).toEqual({ place: null, tab: null });
    expect(locate("//evil.example")).toEqual({ place: null, tab: null });
  });
});

describe("every link of the map points at a page that exists", () => {
  /** src/app/(app)/<route>/page.tsx, with [id] as the dynamic folder. */
  const pageFile = (route: string) => path.join(ROOT, "src", "app", "(app)", ...route.split("/").filter(Boolean), "page.tsx");

  it("every LEGACY_ROUTES entry is a page of the app", () => {
    for (const route of LEGACY_ROUTES) expect(existsSync(pageFile(route)), route).toBe(true);
  });

  it("every place and every tab, for every rank, is a page of the app", () => {
    const hrefs = new Set<string>();
    for (const def of PLACES) {
      if (def.href) hrefs.add(def.href);
      for (const tab of def.tabs) hrefs.add(tab.href);
    }
    for (const role of NAV_ROLES) for (const p of buildNav(who(role)).places) [p.href, ...p.tabs.map((t) => t.href)].forEach((h) => hrefs.add(h));
    expect(hrefs.size).toBeGreaterThanOrEqual(16);
    for (const href of hrefs) expect(existsSync(pageFile(href)), href).toBe(true);
  });
});

describe("the words", () => {
  it("the places are called اليوم · الدردشة · الشغل · المكتبة · نتفرّج سوا · الإدارة (the sixth by the owner's ask, 2026-10-26; «الإدارة» last by his ask of 2026-10-30)", () => {
    expect(PLACES.map((p) => AR[p.labelKey])).toEqual(["اليوم", "الدردشة", "الشغل", "المكتبة", "نتفرّج سوا", "الإدارة"]);
  });

  it("the tabs have the owner's names", () => {
    const names = Object.fromEntries(PLACES.flatMap((p) => p.tabs).map((t) => [t.key, AR[t.labelKey]]));
    expect(names).toEqual({
      "my-work": "مهامي",
      projects: "المشاريع",
      list: "القائمة",
      calendar: "التقويم",
      goals: "الأهداف",
      ideas: "الأفكار",
      production: "الروتين اليومي",
      departments: "الأقسام",
      tickets: "التذاكر",
      campaigns: "الحملات",
      crm: "العملاء",
      checkins: "التسجيل اليومي",
      approvals: "الموافقات",
      files: "مكتبة مساحة العمل",
      documents: "المستندات",
      team: "الفريق",
      space: "المساحة",
      board: "لوحة المالك",
      assistant: "المساعد",
      structure: "الهيكل",
      development: "الأداء والتطوير",
      reports: "التقارير",
      automation: "الأتمتة والتكاملات",
      telegram: "تيليجرام",
      "settings": "الإعدادات",
      "archive": "الأرشيف",
    });
  });

  it("every label the map can produce exists in the dictionary", () => {
    for (const role of NAV_ROLES) {
      for (const p of buildNav(who(role)).places) {
        expect(AR[p.labelKey], p.labelKey).toBeTruthy();
        for (const t of p.tabs) expect(AR[t.labelKey], t.labelKey).toBeTruthy();
      }
    }
  });
});

describe("the module stays pure (the layout on the server and the shell in the browser both import it)", () => {
  it("imports no React, nothing from Next and nothing from the server", () => {
    const source = readFileSync(path.join(ROOT, "src", "lib", "nav", "places.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["'](?:react|next\/|@\/server|@prisma)/);
    expect(source).not.toMatch(/\bimport\s+[^;]*["']server-only["']/);
  });
});
