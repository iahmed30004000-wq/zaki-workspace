import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { getServerT } from "@/lib/i18n/server";
import { CapabilityPanel } from "@/components/members/capability-panel";
import { FEATURES } from "@/lib/features";
import {
  PERMISSION_AREAS,
  areaOf,
  capabilityGroups,
  explainAreas,
  permissionAreas,
  sectionGrid,
  type ActorInfo,
  type ContractMember,
} from "@/lib/members-ui";
import {
  CAPABILITIES,
  RANK_DEFAULTS,
  SECTION_CAPABILITIES,
  WIRED_CAPABILITIES,
  effectiveCapabilities,
  type Capability,
} from "@/server/policy/capabilities";
import { contractMember } from "./members-ui-fixtures";

(globalThis as { React?: typeof React }).React = React;
const { t } = getServerT();

// ------------------------------------------------------------------------------------------------
// the rank hints say what capabilities.ts gives
// ------------------------------------------------------------------------------------------------

type Rank = "ADMIN" | "LEAD" | "MEMBER" | "GUEST";

/** One claim of a hint: the words it uses, the capabilities those words stand for, and whether the rank holds them by default. */
interface Claim {
  say: string;
  caps: readonly Capability[];
  holds: boolean;
}

/** What every rank has, so no hint needs to say it: «لوحتي» is each person's own page, not a difference between ranks. */
const UNSAID: readonly Capability[] = ["board.self"];

const CLAIMS: Record<Rank, readonly Claim[]> = {
  ADMIN: [
    { say: "الحسابات", caps: ["users.manage"], holds: true },
    { say: "الربط", caps: ["integrations.manage"], holds: true },
    { say: "مساحات", caps: ["spaces.create"], holds: true },
    { say: "العملاء", caps: ["crm.view", "crm.edit"], holds: true },
    { say: "الأسعار", caps: ["prices.view"], holds: true },
    { say: "دليل الموظفين", caps: ["directory.view"], holds: true },
    { say: "التقارير", caps: ["reports.view"], holds: true },
    { say: "إعلانات للجميع", caps: ["announce.send"], holds: true },
    { say: "التصعيد", caps: ["escalation.configure"], holds: true },
    { say: "مخزون التصنيع", caps: ["manufacturing.view", "manufacturing.edit"], holds: true },
    { say: "بدون الكلفة", caps: ["manufacturing.cost"], holds: false },
  ],
  // «متل الموظف»: everything a MEMBER has; «وكمان»: what the lead has on top (the owner's ask: a lead also sees the prices)
  LEAD: [
    { say: "متل الموظف", caps: RANK_DEFAULTS.MEMBER, holds: true },
    { say: "الأسعار", caps: ["prices.view"], holds: true },
    { say: "«التقارير»", caps: ["reports.view"], holds: true },
  ],
  MEMBER: [
    { say: "المهام", caps: ["tasks.view", "tasks.edit"], holds: true },
    { say: "المشاريع", caps: ["projects.view", "projects.edit"], holds: true },
    { say: "الملفات", caps: ["files.view", "files.edit"], holds: true },
    { say: "العملاء", caps: ["crm.view", "crm.edit"], holds: true },
    { say: "التذاكر", caps: ["tickets.view", "tickets.edit"], holds: true },
    { say: "الحملات", caps: ["campaigns.view", "campaigns.edit"], holds: true },
    { say: "المكالمات", caps: ["calls.view", "calls.edit"], holds: true },
    { say: "دليل الموظفين", caps: ["directory.view"], holds: true },
    { say: "بدون أسعار", caps: ["prices.view"], holds: false },
    { say: "بدون تقارير", caps: ["reports.view"], holds: false },
  ],
  GUEST: [
    { say: "لا أسعار", caps: ["prices.view"], holds: false },
    { say: "دليل موظفين", caps: ["directory.view"], holds: false },
    { say: "كتابة", caps: ["tasks.edit", "projects.edit", "files.edit", "crm.edit"], holds: false },
  ],
};

const hintOf = (rank: Rank) => AR[`members.rank_hint_${rank.toLowerCase()}`] ?? "";
/** The switches (the grid's boxes are sections, not switches) the screen offers. */
const SWITCHES = WIRED_CAPABILITIES.filter((c) => !SECTION_CAPABILITIES.includes(c));

describe("the rank hints (add-person sheet) match RANK_DEFAULTS", () => {
  for (const rank of ["ADMIN", "LEAD", "MEMBER", "GUEST"] as const) {
    it(`${rank}: every claim of the hint is what the rank really gives or lacks`, () => {
      const hint = hintOf(rank);
      expect(hint, rank).not.toBe("");
      expect(hint.includes("\n")).toBe(false);
      for (const claim of CLAIMS[rank]) {
        expect(hint, `${rank} says «${claim.say}»`).toContain(claim.say);
        for (const cap of claim.caps) {
          expect(RANK_DEFAULTS[rank].includes(cap), `${rank} ${claim.holds ? "has" : "lacks"} ${cap} (hint: «${claim.say}»)`).toBe(claim.holds);
        }
      }
    });

    it(`${rank}: the hint does not leave out a switch the rank gives (only «لوحتي», everybody's own page, may be unsaid)`, () => {
      const said = new Set(CLAIMS[rank].filter((c) => c.holds).flatMap((c) => c.caps));
      for (const cap of SWITCHES) {
        if (!RANK_DEFAULTS[rank].includes(cap) || UNSAID.includes(cap)) continue;
        expect(said.has(cap), `${rank} gives ${cap} but the hint does not say so`).toBe(true);
      }
    });
  }

  it("a team lead is a member plus exactly the prices and the reports page", () => {
    const extra = RANK_DEFAULTS.LEAD.filter((c) => !RANK_DEFAULTS.MEMBER.includes(c)).sort();
    expect(extra).toEqual(["prices.view", "reports.view"]);
    for (const c of RANK_DEFAULTS.MEMBER) expect(RANK_DEFAULTS.LEAD, c).toContain(c);
    // and the hint says the prices out loud
    expect(hintOf("LEAD")).toContain("الأسعار");
  });

  it("the hint of «يحذف» from the tasks box says the space's manager is also needed (D-A1 is not answered yet: the route's rule stays)", () => {
    expect(AR["members.cap.tasks.delete.hint"]).toContain("بيحتاج كمان يكون مدير المساحة");
    expect(AR["perm.tasks_delete_note"]).toContain("بيحتاج كمان يكون مدير المساحة");
  });
});

// ------------------------------------------------------------------------------------------------
// the sheet by area
// ------------------------------------------------------------------------------------------------

const owner: ActorInfo = { id: "u-owner", role: "OWNER", caps: [...CAPABILITIES], primaryOwner: true };
const person = (over: Partial<ContractMember> = {}) => contractMember({ id: "u-p", name: "هدى", role: "MEMBER", ...over });

describe("the areas of the person's sheet", () => {
  it("are the plan's, in its order, in plain words", () => {
    expect(PERMISSION_AREAS.slice(0, 7).map((a) => a.id)).toEqual(["work", "chat", "files", "customers", "reports", "people", "integrations"]);
    const names = ["المهام والمشاريع", "الدردشة والمكالمات", "الملفات", "الزبائن والأسعار", "التقارير واللوحات", "إدارة الناس والمساحات", "التكاملات"];
    expect(PERMISSION_AREAS.slice(0, 7).map((a) => AR[`perm.area.${a.id}`])).toEqual(names);
    for (const a of PERMISSION_AREAS) expect(AR[`perm.area.${a.id}`], a.id).toBeTruthy();
  });

  it("hold every capability of the catalogue exactly once (the owner-only archive is a switch of its own on a partner's sheet)", () => {
    const seen = new Map<Capability, number>();
    for (const c of CAPABILITIES) {
      if (c === "archive.view") continue;
      expect(areaOf(c), c).not.toBeNull();
    }
    for (const area of PERMISSION_AREAS) {
      const mine = [
        ...area.switches,
        ...area.sections.flatMap((s) => SECTION_CAPABILITIES.filter((c) => c.startsWith(`${s}.`))),
      ];
      for (const c of mine) seen.set(c, (seen.get(c) ?? 0) + 1);
    }
    for (const c of CAPABILITIES) {
      if (c === "archive.view") expect(seen.get(c)).toBeUndefined();
      else expect(seen.get(c), c).toBe(1);
    }
    expect(areaOf("archive.view")).toBeNull();
  });

  it("offer every wired capability once and the unwired ones never: announce.send and escalation.configure are back, cash.view and penalties.view are not", () => {
    for (const member of [person(), person({ role: "ADMIN" }), person({ role: "LEAD", revokedCapabilities: ["tasks.view"] })]) {
      const areas = permissionAreas(member, owner, true);
      const offered = areas.flatMap((a) => [
        ...a.rows.map((r) => r.capability),
        ...a.grid.flatMap((g) => Object.values(g.cells).flatMap((c) => (c ? [c.capability] : []))),
      ]);
      expect(new Set(offered).size).toBe(offered.length);
      expect([...offered].sort()).toEqual([...WIRED_CAPABILITIES].sort());
      expect(offered).toContain("announce.send");
      expect(offered).toContain("escalation.configure");
      expect(offered).not.toContain("cash.view");
      expect(offered).not.toContain("penalties.view");
    }
    const byId = (id: string) => permissionAreas(person(), owner, true).find((a) => a.id === id);
    expect(byId("chat")?.rows.map((r) => r.capability)).toEqual(["announce.send"]);
    expect(byId("work")?.rows.map((r) => r.capability)).toEqual(["escalation.configure"]);
  });

  it("show the same states and locks as the switches and the grid always did (the server's own questions)", () => {
    const member = person({ capabilities: ["integrations.manage"], revokedCapabilities: ["directory.view", "tasks.edit"] });
    const lead: ActorInfo = { id: "u-lead", role: "LEAD", caps: [...RANK_DEFAULTS.LEAD, "users.manage"] };
    for (const actor of [owner, lead]) {
      for (const editable of [true, false]) {
        const old = new Map(
          [
            ...capabilityGroups(member, actor, editable).flatMap((g) => g.rows),
            ...sectionGrid(member, actor, editable).flatMap((r) => Object.values(r.cells).flatMap((c) => (c ? [c] : []))),
          ].map((r) => [r.capability, r] as const),
        );
        for (const area of permissionAreas(member, actor, editable)) {
          for (const row of [...area.rows, ...area.grid.flatMap((g) => Object.values(g.cells).flatMap((c) => (c ? [c] : [])))]) {
            const was = old.get(row.capability)!;
            expect({ on: row.on, locked: row.locked, customized: row.customized }, `${actor.role} ${editable} ${row.capability}`).toEqual({
              on: was.on,
              locked: was.locked,
              customized: was.customized,
            });
          }
        }
      }
    }
  });

  it("count what is on out of what is shown, for the collapsed header", () => {
    const areas = permissionAreas(person(), owner, true);
    const files = areas.find((a) => a.id === "files")!;
    // MEMBER: files view, edit and delete are all on
    expect(files).toMatchObject({ on: 3, total: 3 });
    const reports = areas.find((a) => a.id === "reports")!;
    // reports.view off for a member; board.self on; board.team off
    expect(reports).toMatchObject({ on: 1, total: 3 });
  });

  it("with «صلاحيات الأقسام» off there are no grid rows, and the customers' view and edit are the two switches they were before it", () => {
    const off: ActorInfo = { ...owner, sectionGrid: false };
    const areas = permissionAreas(person(), off, true);
    expect(areas.every((a) => a.grid.length === 0)).toBe(true);
    const customers = areas.find((a) => a.id === "customers")!;
    expect(customers.rows.map((r) => r.capability)).toEqual(["crm.view", "crm.edit", "prices.view"]);
    // an area with only grid boxes («الملفات») has nothing left to show
    expect(areas.find((a) => a.id === "files")).toBeUndefined();
  });
});

describe("«شو بيقدر يعمل؟» by area", () => {
  const allOn = { features: Object.fromEntries(FEATURES.map((k) => [k, k !== "economyMode"])) };

  it("lists the offered capabilities with the verdict of explainCapabilities, which agrees with the server's effectiveCapabilities", () => {
    const member = person({ capabilities: ["integrations.manage"], revokedCapabilities: ["tasks.view", "prices.view"] });
    const areas = explainAreas(member, allOn);
    const rows = areas.flatMap((a) => a.rows);
    expect(rows.map((r) => r.capability).sort()).toEqual([...WIRED_CAPABILITIES].sort());
    const effective = effectiveCapabilities(member);
    for (const r of rows) expect(r.held, r.capability).toBe(effective.has(r.capability));
    expect(rows.find((r) => r.capability === "tasks.edit")).toMatchObject({ held: false, basis: "needs_view" });
    expect(rows.find((r) => r.capability === "integrations.manage")).toMatchObject({ held: true, basis: "added" });
    expect(rows.find((r) => r.capability === "prices.view")).toMatchObject({ held: false, basis: "rank_lacks" });
  });

  it("never lists cash.view or penalties.view, and lists the archive only on a partner's sheet", () => {
    const plain = explainAreas(person({ role: "ADMIN" }), allOn).flatMap((a) => a.rows.map((r) => r.capability));
    expect(plain).not.toContain("cash.view");
    expect(plain).not.toContain("penalties.view");
    expect(plain).not.toContain("archive.view");
    const partner = explainAreas(person({ role: "OWNER", primaryOwner: false, revokedCapabilities: ["archive.view"] }), allOn).flatMap((a) => a.rows);
    expect(partner.find((r) => r.capability === "archive.view")).toMatchObject({ held: false, basis: "removed" });
  });
});

// ------------------------------------------------------------------------------------------------
// what is drawn
// ------------------------------------------------------------------------------------------------

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;

function render(element: ReactElement, client = new QueryClient()): string {
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, element)));
}

const noop = () => {};
const panel = (member: ContractMember, client?: QueryClient, actor: ActorInfo = owner) =>
  render(
    createElement(CapabilityPanel, { member, actor, mode: "editable", busy: false, pendingCapability: null, onToggle: noop, onReset: noop }),
    client,
  );
const count = (markup: string, pattern: RegExp) => (markup.match(pattern) ?? []).length;

/** A query cache holding the company's switches, as `/api/settings/features` answers them. */
function clientWith(features: Record<string, boolean>): QueryClient {
  const client = new QueryClient();
  client.setQueryData(["member-sheet-features"], { features: FEATURES.map((key) => ({ key, on: features[key] ?? key !== "economyMode" })) });
  return client;
}

describe("the person's permissions panel", () => {
  it("is arranged by area, every area collapsed by default, in the plan's order", () => {
    const markup = panel(person());
    let last = -1;
    for (const id of ["work", "chat", "files", "customers", "reports", "people", "integrations"]) {
      const at = markup.indexOf(`data-area="${id}"`);
      expect(at, id).toBeGreaterThan(last);
      last = at;
      expect(markup).toContain(`>${t(`perm.area.${id}`)}</h4>`);
    }
    expect(count(markup, /<details[^>]*data-area/g)).toBeGreaterThanOrEqual(7);
    // collapsed: no area is drawn open
    expect(markup).not.toMatch(/<details[^>]*data-area[^>]*\sopen/);
    expect(markup).toContain(t("perm.areas_hint"));
  });

  it("keeps the grid's three columns «يشوف / يضيف ويعدّل / يحذف» in every area that has sections", () => {
    const markup = panel(person());
    const tables = count(markup, /<table/g);
    expect(tables).toBe(PERMISSION_AREAS.filter((a) => a.sections.length > 0).length);
    expect(count(markup, new RegExp(`>${t("members.action.view")}</th>`, "g"))).toBe(tables);
    expect(count(markup, new RegExp(`>${t("members.action.edit")}</th>`, "g"))).toBe(tables);
    expect(count(markup, new RegExp(`>${t("members.action.delete")}</th>`, "g"))).toBe(tables);
    // each box once
    expect(count(markup, /role="checkbox"/g)).toBe(SECTION_CAPABILITIES.length);
  });

  it("offers announce.send and escalation.configure as switches again, and names cash and penalties only as «قريبًا»", () => {
    const markup = panel(person({ role: "ADMIN" }));
    expect(count(markup, /role="switch"/g)).toBe(SWITCHES.length);
    for (const c of ["announce.send", "escalation.configure"]) expect(markup, c).toContain(t(`members.cap.${c}.hint`));
    for (const c of ["cash.view", "penalties.view"]) {
      expect(markup, c).toContain(t(`members.cap.${c}.title`));
      expect(markup, c).not.toContain(t(`members.cap.${c}.hint`));
    }
  });

  it("puts the hint «بيحتاج كمان يكون مدير المساحة» with the task delete box", () => {
    const markup = panel(person());
    expect(markup).toContain(t("perm.tasks_delete_note"));
    expect(markup).toContain("بيحتاج كمان يكون مدير المساحة");
  });

  it("«شو بيقدر يعمل؟»: every offered permission with ✓/✗ and the reason, once the company's switches are known", () => {
    const member = person({ revokedCapabilities: ["tasks.view"], capabilities: ["announce.send"] });
    const markup = panel(member, clientWith({ mustRead: true, autoTickets: false }));
    expect(markup).toContain(t("perm.explain.title"));
    expect(count(markup, /data-capability=/g)).toBe(WIRED_CAPABILITIES.length);
    const item = (cap: string) => markup.match(new RegExp(`<li data-capability="${cap.replace(".", "\\.")}"[^>]*>.*?</li>`))?.[0] ?? "";
    // the box taken away by hand, and what depends on it
    expect(item("tasks.view")).toContain('data-usable="false"');
    expect(item("tasks.view")).toContain(t("perm.why.removed"));
    expect(item("tasks.edit")).toContain(t("perm.why.needs_view"));
    // given by hand and the company's switch is on
    expect(item("announce.send")).toContain('data-usable="true"');
    expect(item("announce.send")).toContain(t("perm.why.added"));
    // the rank gives it, but the company switched the feature off: ✗ with the switch's name
    const offered = panel(person({ role: "ADMIN" }), clientWith({ autoTickets: false }));
    const escalation = offered.match(/<li data-capability="escalation\.configure"[^>]*>.*?<\/li>/)?.[0] ?? "";
    expect(escalation).toContain('data-usable="false"');
    expect(escalation).toContain(t("perm.why.feature_off", { name: t("features.autoTickets.name") }));
  });

  it("claims nothing about the company's switches until they are known (the view is drawn, its rows are not)", () => {
    const markup = panel(person());
    expect(markup).toContain(t("perm.explain.title"));
    expect(markup).not.toContain("data-capability=");
  });

  it("an external partner's sheet is the one sentence, with no areas and no explain view", () => {
    const markup = render(
      createElement(CapabilityPanel, {
        member: person({ role: "GUEST" }),
        actor: owner,
        mode: "guest",
        busy: false,
        pendingCapability: null,
        onToggle: noop,
        onReset: noop,
      }),
    );
    expect(markup).toContain(t("members.caps_guest"));
    expect(markup).not.toContain("data-area");
    expect(markup).not.toContain("data-explain");
  });
});
