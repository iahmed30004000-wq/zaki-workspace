import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_ROLE_TEMPLATES,
  STARTER_TEMPLATES,
  checkTemplatesInput,
  cleanTemplate,
  roleTemplatesOf,
  templateLists,
  templateProblem,
  templateStateOf,
  appliedTemplateOf,
  type RoleTemplate,
} from "@/lib/permission-templates";
import { CAPABILITIES, RANK_DEFAULTS, grantProblem } from "@/server/policy/capabilities";
import { FEATURES, FEATURE_DEFAULTS } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { AddMemberSheet } from "@/components/members/add-member-sheet";
import { MemberSheet } from "@/components/members/member-sheet";
import { MemberTemplateSection, TemplatePicker } from "@/components/members/template-picker";
import { EMPTY_ADD_FORM, buildCreatePayload, normalizeMember, type ActorInfo } from "@/lib/members-ui";
import { ADMIN_ACTOR, MEMBER, NOW, OWNER_ACTOR, SAMPLE, SPACES } from "./members-ui-fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/members",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * A1.1 «قوالب»: the pure rules. Who may hand out what is decided by the SAME functions the accounts service uses
 * (member-rules.ts); this file proves the template-specific ones: what a template may hold, what applying it writes, and what the
 * person's sheet says about it afterwards. The database proof (audit row, rank rules, the settings write) is tests/db/permission-templates.test.ts.
 */

const holder = (role: "OWNER" | "ADMIN" | "LEAD" | "MEMBER", extra: readonly string[] = [], without: readonly string[] = []) => ({
  role,
  caps: new Set<string>([...(role === "OWNER" ? CAPABILITIES : RANK_DEFAULTS[role]), ...extra].filter((c) => !without.includes(c))),
});

const tpl = (over: Partial<RoleTemplate> = {}): RoleTemplate => ({ id: "t1", name: "قالب", rank: "MEMBER", caps: [], revoked: [], ...over });

describe("the switch", () => {
  it("permissionTemplates exists, is OFF by default and has its Arabic name and hint", () => {
    expect(FEATURES).toContain("permissionTemplates");
    expect(FEATURE_DEFAULTS.permissionTemplates).toBe(false);
    expect(AR["features.permissionTemplates.name"]).toBeTruthy();
    expect(AR["features.permissionTemplates.hint"]).toBeTruthy();
  });
});

describe("the built-in starters", () => {
  it("are the seven of the spec, in order, with their own names", () => {
    expect(STARTER_TEMPLATES.map((t) => t.name)).toEqual([
      "مدير مساحة",
      "موظف",
      "مبيعات وتأكيد طلبات",
      "ميديا باير",
      "مونتاج وتصميم",
      "محاسبة",
      "مشاهدة فقط",
    ]);
  });

  it("every starter is valid as it stands: no guest, no owner-only box, nothing that is both on and off, ids and names unique", () => {
    const check = checkTemplatesInput(STARTER_TEMPLATES, () => "x");
    expect(check.ok).toBe(true);
    for (const t of STARTER_TEMPLATES) {
      expect(["ADMIN", "LEAD", "MEMBER"]).toContain(t.rank);
      expect(t.caps).not.toContain("archive.view");
      expect(t.caps.every((c) => grantProblem(t.rank, c) === null), t.name).toBe(true);
      expect(t.caps.some((c) => t.revoked.includes(c)), t.name).toBe(false);
      // an extra is something the rank does not already give, a revoked entry something it does
      expect(t.caps.some((c) => (RANK_DEFAULTS[t.rank] as readonly string[]).includes(c)), t.name).toBe(false);
      expect(t.revoked.every((c) => (RANK_DEFAULTS[t.rank] as readonly string[]).includes(c)), t.name).toBe(true);
    }
    expect(new Set(STARTER_TEMPLATES.map((t) => t.id)).size).toBe(STARTER_TEMPLATES.length);
  });

  it("«مشاهدة فقط» takes away every add, edit and delete box its rank gives, and gives nothing", () => {
    const view = STARTER_TEMPLATES.find((t) => t.name === "مشاهدة فقط") as RoleTemplate;
    expect(view.caps).toEqual([]);
    const writes = RANK_DEFAULTS[view.rank].filter((c) => /\.(edit|delete)$/.test(c));
    expect(writes.length).toBeGreaterThan(0);
    for (const c of writes) expect(view.revoked, c).toContain(c);
  });
});

describe("reading the company's templates", () => {
  it("a company that never saved any gets the starters (the editable copies are made on first open)", () => {
    expect(roleTemplatesOf({})).toEqual(STARTER_TEMPLATES);
    expect(roleTemplatesOf(null)).toEqual(STARTER_TEMPLATES);
    expect(roleTemplatesOf({ roleTemplates: "nonsense" })).toEqual(STARTER_TEMPLATES);
    // a copy: editing what was returned never edits the starters
    roleTemplatesOf({})[0]!.name = "تعديل";
    expect(STARTER_TEMPLATES[0]!.name).toBe("مدير مساحة");
  });

  it("a saved list is the company's own, even an empty one", () => {
    expect(roleTemplatesOf({ roleTemplates: [] })).toEqual([]);
    expect(roleTemplatesOf({ roleTemplates: [tpl()] })).toEqual([tpl()]);
  });

  it("a stored entry that is not valid is dropped, never trusted: a guest template, an owner template, unknown or owner-only boxes", () => {
    const stored = {
      roleTemplates: [
        tpl({ id: "guest", rank: "GUEST", caps: ["prices.view"] }),
        tpl({ id: "owner", rank: "OWNER" }),
        tpl({ id: "weird", rank: "SUPER" as never }),
        tpl({ id: "ok", name: "سليم", caps: ["prices.view", "archive.view", "no.such.box"], revoked: ["crm.edit", "board.team"] }),
        { id: "", name: "x", rank: "MEMBER", caps: [], revoked: [] },
        { id: "noname", name: "   ", rank: "MEMBER", caps: [], revoked: [] },
        "junk",
        null,
      ],
    };
    const got = roleTemplatesOf(stored);
    expect(got.map((t) => t.id)).toEqual(["ok"]);
    // archive.view can never be handed out, an unknown box is nothing, and a revoke of a box the rank never gave is no revoke
    expect(got[0]).toEqual({ id: "ok", name: "سليم", rank: "MEMBER", caps: ["prices.view"], revoked: ["crm.edit"] });
  });

  it("a repeated id keeps the first and the list stops at 30", () => {
    const many = Array.from({ length: 45 }, (_, i) => tpl({ id: `t${i}`, name: `قالب ${i}` }));
    expect(roleTemplatesOf({ roleTemplates: many })).toHaveLength(MAX_ROLE_TEMPLATES);
    expect(roleTemplatesOf({ roleTemplates: [tpl({ name: "الأول" }), tpl({ name: "الثاني" })] }).map((t) => t.name)).toEqual(["الأول"]);
  });

  it("cleanTemplate drops what the rank already gives from the extras and drops a box that is in both lists from the revoked", () => {
    const c = cleanTemplate(tpl({ caps: ["tasks.view", "prices.view"], revoked: ["prices.view", "crm.edit"] }));
    expect(c?.caps).toEqual(["prices.view"]);
    expect(c?.revoked).toEqual(["crm.edit"]);
  });
});

describe("saving the company's templates (strict)", () => {
  const ids = () => {
    let n = 0;
    return () => `new${++n}`;
  };

  it("a guest template is refused, and so is an owner one", () => {
    expect(checkTemplatesInput([tpl({ rank: "GUEST" })], ids())).toEqual({ ok: false, key: "ptemplates.guest_refused" });
    expect(checkTemplatesInput([tpl({ rank: "OWNER" })], ids())).toEqual({ ok: false, key: "ptemplates.rank_invalid" });
    expect(checkTemplatesInput([tpl({ rank: "NOPE" as never })], ids())).toEqual({ ok: false, key: "ptemplates.rank_invalid" });
  });

  it("archive.view is refused (it can never be handed out), an unknown box is refused, a box on and off at once is refused", () => {
    expect(checkTemplatesInput([tpl({ caps: ["archive.view"] })], ids())).toEqual({ ok: false, key: "ptemplates.cap_owner_only" });
    expect(checkTemplatesInput([tpl({ caps: ["no.such.box"] })], ids())).toEqual({ ok: false, key: "ptemplates.cap_unknown" });
    expect(checkTemplatesInput([tpl({ caps: ["prices.view"], revoked: ["prices.view"] })], ids())).toEqual({ ok: false, key: "ptemplates.cap_both_lists" });
  });

  it("a name is needed, at most 60 long and used once; more than 30 templates are refused", () => {
    expect(checkTemplatesInput([tpl({ name: "  " })], ids())).toEqual({ ok: false, key: "ptemplates.name_invalid" });
    expect(checkTemplatesInput([tpl({ name: "ا".repeat(61) })], ids())).toEqual({ ok: false, key: "ptemplates.name_invalid" });
    expect(checkTemplatesInput([tpl({ id: "a", name: "نفس الاسم" }), tpl({ id: "b", name: " نفس الاسم " })], ids())).toEqual({ ok: false, key: "ptemplates.name_taken" });
    const many = Array.from({ length: 31 }, (_, i) => tpl({ id: `t${i}`, name: `قالب ${i}` }));
    expect(checkTemplatesInput(many, ids())).toEqual({ ok: false, key: "ptemplates.too_many" });
    expect(checkTemplatesInput("nope", ids())).toEqual({ ok: false, key: "ptemplates.invalid" });
  });

  it("a repeated id is refused; a template without an id gets a new one; the lists are cleaned and put in catalogue order", () => {
    expect(checkTemplatesInput([tpl({ id: "a", name: "ا" }), tpl({ id: "a", name: "ب" })], ids())).toEqual({ ok: false, key: "ptemplates.id_invalid" });
    const made = checkTemplatesInput([{ name: "جديد", rank: "MEMBER", caps: ["prices.view", "prices.view", "users.manage"], revoked: [] }], ids());
    expect(made).toEqual({ ok: true, templates: [{ id: "new1", name: "جديد", rank: "MEMBER", caps: ["users.manage", "prices.view"], revoked: [] }] });
  });
});

describe("what a person who applies a template holds", () => {
  it("an extra the applier does not hold is a refusal, whatever the rank", () => {
    const t = tpl({ caps: ["manufacturing.cost"] });
    expect(templateProblem(holder("ADMIN"), t)).toBe("ptemplates.exceeds_applier");
    expect(templateProblem(holder("OWNER"), t)).toBeNull();
    expect(templateProblem(holder("ADMIN", ["manufacturing.cost"]), t)).toBeNull();
  });

  it("only a rank strictly below the applier's own is given", () => {
    expect(templateProblem(holder("ADMIN"), tpl({ rank: "ADMIN" }))).toBe("orgm.role_denied");
    expect(templateProblem(holder("ADMIN"), tpl({ rank: "LEAD" }))).toBeNull();
    expect(templateProblem(holder("LEAD", ["users.manage"]), tpl({ rank: "LEAD" }))).toBe("orgm.role_denied");
    expect(templateProblem(holder("OWNER"), tpl({ rank: "ADMIN" }))).toBeNull();
  });

  it("a guest template is never applied, and nobody is made a guest, an owner or a partner by one", () => {
    expect(templateProblem(holder("OWNER"), tpl({ rank: "GUEST" }))).toBe("ptemplates.guest_refused");
    expect(templateProblem(holder("OWNER"), tpl(), "GUEST")).toBe("ptemplates.target_guest");
    expect(templateProblem(holder("OWNER"), tpl(), "OWNER")).toBe("ptemplates.target_denied");
    expect(templateProblem(holder("OWNER"), tpl(), "MEMBER")).toBeNull();
  });

  it("archive.view in a template is never written, even when the template was written around the checks", () => {
    const lists = templateLists(holder("OWNER"), tpl({ caps: ["archive.view", "prices.view"] }), { capabilities: [], revokedCapabilities: [] });
    expect(lists.capabilities).toEqual(["prices.view"]);
  });

  it("the lists written: the template's extras, its revocations the applier holds, and the revocations of what the applier cannot lift stay", () => {
    const t = tpl({ caps: ["prices.view"], revoked: ["crm.edit", "campaigns.view"] });
    const admin = holder("ADMIN", [], ["campaigns.view"]);
    const lists = templateLists(admin, t, { capabilities: ["announce.send"], revokedCapabilities: ["goals.view", "crm.delete"] });
    // a stored extra is replaced (a template is the whole set), the revoked boxes the applier holds are the template's, the others stay as they were
    expect(lists.capabilities).toEqual(["prices.view"]);
    expect(lists.revokedCapabilities).toEqual(expect.arrayContaining(["crm.edit"]));
    expect(lists.revokedCapabilities).not.toContain("campaigns.view");
    // a revocation of a box the applier does not hold cannot be lifted by him: it is kept
    const keep = templateLists(holder("ADMIN", [], ["goals.view"]), tpl(), { capabilities: [], revokedCapabilities: ["goals.view"] });
    expect(keep.revokedCapabilities).toEqual(["goals.view"]);
  });
});

describe("what the person's sheet says", () => {
  const applied = { templateId: "t1", name: "مبيعات", role: "MEMBER" as const, capabilities: ["prices.view"], revokedCapabilities: ["crm.delete"] };

  it("reads the audit row back, and refuses anything that is not one", () => {
    expect(appliedTemplateOf({ templateId: "t1", name: "مبيعات", rank: "MEMBER", capabilities: ["prices.view"], revokedCapabilities: ["crm.delete"] })).toEqual(applied);
    expect(appliedTemplateOf({ templateId: 4 })).toBeNull();
    expect(appliedTemplateOf(null)).toBeNull();
    expect(appliedTemplateOf("x")).toBeNull();
  });

  it("«القالب: X» as it was applied, «معدّل» once the rank or either list is changed by hand", () => {
    const same = { role: "MEMBER" as const, capabilities: ["prices.view"], revokedCapabilities: ["crm.delete"] };
    expect(templateStateOf(applied, same)).toEqual({ id: "t1", name: "مبيعات", modified: false });
    // the order of a list means nothing
    expect(templateStateOf({ ...applied, capabilities: ["a", "b"] }, { ...same, capabilities: ["b", "a"] }).modified).toBe(false);
    expect(templateStateOf(applied, { ...same, capabilities: [] }).modified).toBe(true);
    expect(templateStateOf(applied, { ...same, revokedCapabilities: [] }).modified).toBe(true);
    expect(templateStateOf(applied, { ...same, role: "LEAD" }).modified).toBe(true);
  });
});

// ---------------------------------------------------------------------------------- the screens

(globalThis as { React?: typeof React }).React = React;
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const noop = () => {};

/** A query cache that already holds the company's templates (what the screen has after its first fetch while the switch is ON). */
function withTemplates(list: RoleTemplate[] | null): QueryClient {
  const client = new QueryClient();
  if (list) client.setQueryData(["role-templates", "org1"], { templates: list, rev: "r", canEdit: true });
  return client;
}
function render(element: ReactElement, client: QueryClient): string {
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(Toasts, null, element))));
}

const sales = STARTER_TEMPLATES.find((x) => x.id === "starter-sales") as RoleTemplate;
const rich: RoleTemplate = { id: "rich", name: "قالب غني", rank: "MEMBER", caps: ["manufacturing.cost"], revoked: [] };
const adminTpl: RoleTemplate = { id: "adm", name: "مدير كامل", rank: "ADMIN", caps: [], revoked: [] };
const optionOf = (markup: string, id: string) => (markup.match(new RegExp(`<option[^>]*value="${id}"[^>]*>[^<]*</option>`)) ?? [""])[0] as string;

describe("the people screen's pieces", () => {
  it("the picker greys out what the person looking cannot give, with the reason: an extra he lacks, a rank not below his own", () => {
    const markup = render(
      createElement(TemplatePicker, { id: "t", templates: [sales, rich, adminTpl], actor: ADMIN_ACTOR, value: "", onChange: noop }),
      new QueryClient(),
    );
    expect(optionOf(markup, sales.id)).not.toContain("disabled");
    expect(optionOf(markup, "rich")).toContain("disabled");
    expect(optionOf(markup, "rich")).toContain(AR["ptemplates.unavailable_exceeds"]);
    expect(optionOf(markup, "adm")).toContain("disabled");
    expect(optionOf(markup, "adm")).toContain(AR["ptemplates.unavailable_rank"]);
    // the owner holds everything and may give any staff rank
    const owner = render(createElement(TemplatePicker, { id: "t", templates: [sales, rich, adminTpl], actor: OWNER_ACTOR, value: "", onChange: noop }), new QueryClient());
    expect(optionOf(owner, "rich")).not.toContain("disabled");
    expect(optionOf(owner, "adm")).not.toContain("disabled");
  });

  it("a person's sheet says «القالب: X», and «معدّل» once changed by hand, with the ⚠️ and its 🔧 next to the button", () => {
    const given = { ...MEMBER, template: { id: sales.id, name: sales.name, modified: false } };
    const section = (member: typeof given) =>
      createElement(MemberTemplateSection, { id: "s", member, actor: OWNER_ACTOR, templates: [sales], busy: false, applying: false, onApply: noop });
    const plain = render(section(given), new QueryClient());
    expect(plain).toContain("القالب: مبيعات وتأكيد طلبات");
    expect(plain).not.toContain("معدّل");
    expect(plain).toContain(AR["ptemplates.warn"]);
    expect(plain).toContain(AR["ptemplates.fix"]);
    const changed = render(section({ ...given, template: { ...given.template, modified: true } }), new QueryClient());
    expect(changed).toContain("معدّل");
    const none = render(section({ ...MEMBER } as typeof given), new QueryClient());
    expect(none).toContain(AR["ptemplates.none_applied"]);
  });

  const sheet = (member = MEMBER, actor: ActorInfo = OWNER_ACTOR) =>
    createElement(MemberSheet, { orgId: "org1", member, members: SAMPLE.members, actor, now: NOW, onClose: noop, onPatch: noop, onChanged: noop });
  const adding = (actor: ActorInfo = OWNER_ACTOR) =>
    createElement(AddMemberSheet, { orgId: "org1", actor, members: SAMPLE.members, spaces: SPACES, onClose: noop, onCreated: noop });

  it("with the switch OFF (the templates door answered «not found», so nothing is cached) neither sheet draws any template", () => {
    expect(render(sheet(), withTemplates(null))).not.toContain(AR["ptemplates.apply"]);
    expect(render(adding(), withTemplates(null))).not.toContain(AR["ptemplates.hint_create"]);
  });

  it("with it ON the create sheet gets «القالب» above «المساحات», and the rank then comes from the template", () => {
    const markup = render(adding(), withTemplates([...STARTER_TEMPLATES]));
    expect(markup).toContain(AR["ptemplates.hint_create"]);
    expect(markup).toContain("مبيعات وتأكيد طلبات");
    expect(markup.indexOf(AR["ptemplates.hint_create"] as string)).toBeLessThan(markup.indexOf(AR["members.f_spaces"] as string));
  });

  it("with it ON a person the viewer may edit gets the section; an owner, a guest and a person he may not administer do not", () => {
    const on = () => withTemplates([sales]);
    expect(render(sheet(), on())).toContain(AR["ptemplates.apply"]);
    const owner = SAMPLE.members.find((m) => m.role === "OWNER")!;
    const guest = SAMPLE.members.find((m) => m.role === "GUEST")!;
    expect(render(sheet(owner), on())).not.toContain(AR["ptemplates.apply"]);
    expect(render(sheet(guest), on())).not.toContain(AR["ptemplates.apply"]);
    const admin = SAMPLE.members.find((m) => m.role === "ADMIN")!;
    expect(render(sheet(admin, ADMIN_ACTOR), on())).not.toContain(AR["ptemplates.apply"]);
  });

  it("the form carries the template to the server only when one is chosen, and the roster keeps what the server said about it", () => {
    const base = { ...EMPTY_ADD_FORM, name: "نور الهدى", username: "nour.huda" };
    expect(buildCreatePayload(base)).not.toHaveProperty("templateId");
    expect(buildCreatePayload({ ...base, templateId: "starter-sales", role: "MEMBER" })).toMatchObject({ templateId: "starter-sales", role: "MEMBER" });
    expect(normalizeMember({ id: "x", template: { id: "t", name: "قالب", modified: true } }).template).toEqual({ id: "t", name: "قالب", modified: true });
    expect(normalizeMember({ id: "x" })).not.toHaveProperty("template");
    expect(normalizeMember({ id: "x", template: { id: 4 } as never })).not.toHaveProperty("template");
  });
});
