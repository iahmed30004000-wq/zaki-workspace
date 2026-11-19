/**
 * «قوالب» (A1.1): a template is a rank plus the boxes it adds and the boxes it takes away, so the owner gives a new person a whole job
 * at once instead of 43 switches. Pure rules, no database and no React, so the screen offers what the server accepts.
 *
 *  - The company's templates live in `Organization.settings.roleTemplates` (existing JSON, no migration): `{ id, name, rank, caps, revoked }`, at
 *    most 30. A company that never saved any gets the seven starters; the first save makes them its own editable copies.
 *  - `caps` are EXTRAS (boxes the rank does not give), `revoked` are boxes the rank gives that the template switches off.
 *  - A template can NEVER give more than the person who applies it holds, a GUEST template does not exist (guests never get staff capabilities,
 *    no prices), `archive.view` is never in one, and nobody becomes an OWNER, a partner or a guest through one.
 *  - Applying writes the rank and both lists through the account service (accounts.ts: the same rank rules, audited); the person's sheet reads
 *    the audit row back for «القالب: X» and «معدّل» (changed by hand afterwards).
 */
import type { OrgRole } from "@prisma/client";
import { OWNER_ONLY, RANK_DEFAULTS, grantProblem, isCapability } from "@/server/policy/capabilities";
import { grantableRoles, inCatalogueOrder, type CapabilityHolder } from "@/server/services/member-rules";

export const MAX_ROLE_TEMPLATES = 30;
export const TEMPLATE_NAME_MAX = 60;

/** The ranks a template can carry: staff below the owner. A template is never a guest's, never an owner's. */
export const TEMPLATE_RANKS = ["ADMIN", "LEAD", "MEMBER"] as const satisfies readonly OrgRole[];

export interface RoleTemplate {
  id: string;
  name: string;
  rank: OrgRole;
  /** boxes the rank does not give and the template adds */
  caps: string[];
  /** boxes the rank gives and the template takes away */
  revoked: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const ID_SHAPE = /^[A-Za-z0-9_-]{1,40}$/;
const isTemplateRank = (v: unknown): v is (typeof TEMPLATE_RANKS)[number] => (TEMPLATE_RANKS as readonly unknown[]).includes(v);
const isRankDefault = (rank: OrgRole, c: string): boolean => (RANK_DEFAULTS[rank] as readonly string[]).includes(c);

// ---------------------------------------------------------------------------------- the starters

/** What «مشاهدة فقط» takes away: every add, edit and delete box a member's rank gives. */
const MEMBER_WRITES = RANK_DEFAULTS.MEMBER.filter((c) => /\.(edit|delete)$/.test(c));

/**
 * The seven starters. They are data the owner edits, so they carry nothing a person could not be given by hand: each is a rank, a few extras,
 * a few revocations. None holds `prices.view` beyond what its job needs and none is a guest's.
 */
export const STARTER_TEMPLATES: readonly RoleTemplate[] = [
  { id: "starter-space-manager", name: "مدير مساحة", rank: "LEAD", caps: ["spaces.create", "board.team"], revoked: [] },
  { id: "starter-employee", name: "موظف", rank: "MEMBER", caps: [], revoked: [] },
  {
    id: "starter-sales",
    name: "مبيعات وتأكيد طلبات",
    rank: "MEMBER",
    caps: [],
    revoked: ["production.view", "files.delete", "campaigns.view", "campaigns.edit", "campaigns.delete"],
  },
  { id: "starter-media-buyer", name: "ميديا باير", rank: "MEMBER", caps: ["reports.view"], revoked: ["crm.edit", "crm.delete", "tickets.edit", "tickets.delete"] },
  {
    id: "starter-editing-design",
    name: "مونتاج وتصميم",
    rank: "MEMBER",
    caps: [],
    revoked: ["crm.view", "crm.edit", "crm.delete", "tickets.edit", "tickets.delete", "campaigns.view", "campaigns.edit", "campaigns.delete"],
  },
  {
    id: "starter-accounting",
    name: "محاسبة",
    rank: "MEMBER",
    caps: ["prices.view", "reports.view"],
    revoked: ["production.view", "campaigns.view", "campaigns.edit", "campaigns.delete"],
  },
  { id: "starter-view-only", name: "مشاهدة فقط", rank: "MEMBER", caps: [], revoked: [...MEMBER_WRITES] },
];

const copyOf = (t: RoleTemplate): RoleTemplate => ({ ...t, caps: [...t.caps], revoked: [...t.revoked] });

// ---------------------------------------------------------------------------------- reading (tolerant)

/**
 * One stored entry as the code may trust it, or null: a valid id, a name, a staff rank; the extras are known, grantable boxes the rank does not
 * already give; the revocations are boxes the rank DOES give (a revocation of anything else is nothing). A box in both lists is an extra.
 */
export function cleanTemplate(raw: unknown): RoleTemplate | null {
  if (!isObj(raw)) return null;
  const id = typeof raw["id"] === "string" ? raw["id"].trim() : "";
  const name = typeof raw["name"] === "string" ? raw["name"].trim() : "";
  const rank = raw["rank"];
  if (!ID_SHAPE.test(id) || name.length < 1 || name.length > TEMPLATE_NAME_MAX || !isTemplateRank(rank)) return null;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const caps = inCatalogueOrder(strings(raw["caps"]).filter((c) => isCapability(c) && grantProblem(rank, c) === null && !isRankDefault(rank, c)));
  const revoked = inCatalogueOrder(strings(raw["revoked"]).filter((c) => isCapability(c) && grantProblem(rank, c) === null && isRankDefault(rank, c) && !caps.includes(c)));
  return { id, name, rank, caps, revoked };
}

/**
 * The company's templates: its own saved list (valid entries only, the first of a repeated id, at most 30), or the starters while it never
 * saved one. An empty saved list is the company's own choice and stays empty.
 */
export function roleTemplatesOf(settings: unknown): RoleTemplate[] {
  const raw = isObj(settings) ? settings["roleTemplates"] : undefined;
  if (!Array.isArray(raw)) return STARTER_TEMPLATES.map(copyOf);
  const out: RoleTemplate[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const t = cleanTemplate(entry);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
    if (out.length >= MAX_ROLE_TEMPLATES) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------- saving (strict)

export type TemplatesCheck = { ok: true; templates: RoleTemplate[] } | { ok: false; key: string };

/**
 * The owner's whole list as he sends it, judged strictly: every refusal is a dictionary key and nothing is saved. `newId` makes the id of an
 * entry that has none. A guest template, an owner template, `archive.view` and an unknown box are refused, not quietly dropped.
 */
export function checkTemplatesInput(raw: unknown, newId: () => string): TemplatesCheck {
  if (!Array.isArray(raw)) return { ok: false, key: "ptemplates.invalid" };
  if (raw.length > MAX_ROLE_TEMPLATES) return { ok: false, key: "ptemplates.too_many" };
  const out: RoleTemplate[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const entry of raw) {
    if (!isObj(entry)) return { ok: false, key: "ptemplates.invalid" };
    const rank = entry["rank"];
    if (rank === "GUEST") return { ok: false, key: "ptemplates.guest_refused" };
    if (!isTemplateRank(rank)) return { ok: false, key: "ptemplates.rank_invalid" };
    const name = typeof entry["name"] === "string" ? entry["name"].trim() : "";
    if (name.length < 1 || name.length > TEMPLATE_NAME_MAX) return { ok: false, key: "ptemplates.name_invalid" };
    if (names.has(name)) return { ok: false, key: "ptemplates.name_taken" };
    const given = typeof entry["id"] === "string" ? entry["id"].trim() : "";
    const id = given === "" ? newId() : given;
    if (!ID_SHAPE.test(id) || ids.has(id)) return { ok: false, key: "ptemplates.id_invalid" };
    const lists: Record<"caps" | "revoked", string[]> = { caps: [], revoked: [] };
    for (const field of ["caps", "revoked"] as const) {
      const value = entry[field] ?? [];
      if (!Array.isArray(value) || value.some((c) => typeof c !== "string")) return { ok: false, key: "ptemplates.invalid" };
      for (const c of value as string[]) {
        if (!isCapability(c)) return { ok: false, key: "ptemplates.cap_unknown" };
        if ((OWNER_ONLY as readonly string[]).includes(c)) return { ok: false, key: "ptemplates.cap_owner_only" };
      }
      lists[field] = value as string[];
    }
    if (lists.caps.some((c) => lists.revoked.includes(c))) return { ok: false, key: "ptemplates.cap_both_lists" };
    const clean = cleanTemplate({ id, name, rank, caps: lists.caps, revoked: lists.revoked });
    if (!clean) return { ok: false, key: "ptemplates.invalid" };
    ids.add(id);
    names.add(name);
    out.push(clean);
  }
  return { ok: true, templates: out };
}

// ---------------------------------------------------------------------------------- applying

/**
 * Why this person may not apply this template (to `targetRole`, when the template is applied to somebody who already exists): an error key,
 * or null. The server asks it before it writes anything and the screen asks it to grey a template out, so both say the same.
 *  - a guest template is refused, and a guest, an owner or a partner is never the person it is applied to (a promotion is its own step);
 *  - only a rank strictly below the applier's own is given (the service's rule for every rank change);
 *  - no extra the applier does not hold: a template can never give more than the one who applies it has.
 */
export function templateProblem(actor: CapabilityHolder, template: RoleTemplate, targetRole?: OrgRole): string | null {
  if (template.rank === "GUEST") return "ptemplates.guest_refused";
  if (!isTemplateRank(template.rank)) return "ptemplates.rank_invalid";
  if (targetRole === "GUEST") return "ptemplates.target_guest";
  if (targetRole !== undefined && !isTemplateRank(targetRole)) return "ptemplates.target_denied";
  if (!grantableRoles(actor.role).includes(template.rank)) return "orgm.role_denied";
  const clean = cleanTemplate(template);
  if (!clean) return "ptemplates.invalid";
  if (clean.caps.some((c) => !actor.caps.has(c))) return "ptemplates.exceeds_applier";
  return null;
}

/**
 * The two lists a person ends with when `template` is applied by `actor` over the lists they had. A template is the whole set: the stored
 * extras are replaced by the template's. The template's revocations are written when the applier holds the box (taking away is the applier's
 * to do only for what he could give); a revocation of a box the applier does NOT hold stays as it was, since he cannot lift it.
 * The rank defaults the applier lacks are switched off on top by the service (`unheldRankDefaults`).
 */
export function templateLists(
  actor: CapabilityHolder,
  template: RoleTemplate,
  stored: { capabilities: readonly string[]; revokedCapabilities: readonly string[] },
): { capabilities: string[]; revokedCapabilities: string[] } {
  const clean = cleanTemplate(template) ?? { ...template, caps: [], revoked: [] };
  const kept = stored.revokedCapabilities.filter((c) => !actor.caps.has(c) && grantProblem(clean.rank, c) === null);
  const revokedCapabilities = inCatalogueOrder([...clean.revoked.filter((c) => actor.caps.has(c)), ...kept]);
  return { capabilities: clean.caps.filter((c) => !revokedCapabilities.includes(c)), revokedCapabilities };
}

// ---------------------------------------------------------------------------------- what the sheet says

/** What the audit row `org.template_applied` keeps: the template as applied and the lists the person ended with. */
export interface AppliedTemplate {
  templateId: string;
  name: string;
  role: OrgRole;
  capabilities: string[];
  revokedCapabilities: string[];
}

/** The audit meta written when a template is applied (kept in ONE shape: the sheet reads it back with `appliedTemplateOf`). */
export function appliedMeta(template: Pick<RoleTemplate, "id" | "name">, role: OrgRole, capabilities: readonly string[], revokedCapabilities: readonly string[]) {
  return { templateId: template.id, name: template.name, rank: role, capabilities: [...capabilities], revokedCapabilities: [...revokedCapabilities] };
}

const ROLES: readonly string[] = ["OWNER", "ADMIN", "LEAD", "MEMBER", "GUEST"];

export function appliedTemplateOf(meta: unknown): AppliedTemplate | null {
  if (!isObj(meta)) return null;
  const { templateId, name, rank, capabilities, revokedCapabilities } = meta;
  if (typeof templateId !== "string" || typeof name !== "string" || typeof rank !== "string" || !ROLES.includes(rank)) return null;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { templateId, name, role: rank as OrgRole, capabilities: strings(capabilities), revokedCapabilities: strings(revokedCapabilities) };
}

export interface MemberTemplate {
  id: string;
  name: string;
  /** the rank or a list was changed by hand after the template was applied: «معدّل» */
  modified: boolean;
}

const sameSet = (a: readonly string[], b: readonly string[]) => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((c) => right.has(c));
};

/** «القالب: X», and whether the person was changed by hand since (the rank, the extras or the revocations differ from what was written). */
export function templateStateOf(
  applied: AppliedTemplate,
  member: { role: OrgRole; capabilities: readonly string[]; revokedCapabilities: readonly string[] },
): MemberTemplate {
  const modified = member.role !== applied.role || !sameSet(member.capabilities, applied.capabilities) || !sameSet(member.revokedCapabilities, applied.revokedCapabilities);
  return { id: applied.templateId, name: applied.name, modified };
}
