/**
 * Pure logic of the team screen (الأعضاء والصلاحيات): who may do what to whom, how a capability
 * switch is derived, the add-person form, search, relative Arabic time, the copy-ready login message
 * and how a server error becomes an Arabic sentence. No React, no network, no clock of its own
 * (callers pass `now`), so every rule here is unit-tested.
 *
 * The server enforces every rule again; this file only decides what the screen OFFERS, so the owner
 * is never shown a button that would be refused.
 */
import type { OrgRole } from "@prisma/client";
import {
  CAPABILITIES,
  RANK_DEFAULTS,
  SECTIONS,
  SECTION_CAPABILITIES,
  WIRED_CAPABILITIES,
  effectiveCapabilities,
  isCapability,
  sectionCapability,
  type Capability,
  type SectionAction,
  type SectionId,
} from "@/server/policy/capabilities";
// The server's own rank rules: pure functions with no database (member-rules.ts says so), imported
// so that the screen offers exactly what the server will accept, not a copy of it.
import {
  canAdministratePerson,
  canAdministrateTarget,
  canChangeRole,
  canTransitionStatus,
  capabilityChangeProblem,
  grantableRoles,
  grantableRolesFor,
  inCatalogueOrder,
  replaceCapabilityList,
  unheldRankDefaults,
  type CapabilityHolder,
} from "@/server/services/member-rules";

// ---------------------------------------------------------------------------------- the contract

export type OrgRoleName = OrgRole;
export type MemberStatusName = "ACTIVE" | "SUSPENDED" | "OFFBOARDED";
export type StatusFilter = "ALL" | MemberStatusName;

/** `t()` as the client and the server both expose it. */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

export interface MemberWorkspace {
  id: string;
  name: string;
  role: string;
}

/** One row of `GET /api/organizations/[id]/members`. */
export interface ContractMember {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  jobTitle: string | null;
  role: OrgRoleName;
  status: MemberStatusName;
  managerId: string | null;
  managerName: string | null;
  capabilities: string[];
  revokedCapabilities: string[];
  /** OWNER rows: true for the primary owner, false for a partner «شريك» (absent: read as the primary owner). */
  primaryOwner?: boolean;
  effectiveCapabilities: string[];
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  /** `/api/avatars/<id>` — the picture the person uploaded, or null for the initials. */
  avatarUrl?: string | null;
  /** Open tasks + open tickets + active routines assigned to the person: an offboarding needs a transfer target when > 0. */
  openWork: number;
  workspaces: MemberWorkspace[];
}

export interface ContractSpace {
  id: string;
  name: string;
}

export interface MembersResponse {
  members: ContractMember[];
  actorRole: OrgRoleName;
  actorPrimaryOwner?: boolean;
  /** «صلاحيات الأقسام» in «الميزات» (absent: on). */
  sectionGrid?: boolean;
  spaces: ContractSpace[];
}

/** The signed-in person who is looking at the screen. */
export interface ActorInfo {
  id: string;
  role: OrgRoleName;
  /** The capabilities the actor holds (what they may hand out). */
  caps: readonly string[];
  /** The company's primary owner: he alone makes or unmakes a partner and takes a permission away from one. */
  primaryOwner?: boolean;
  /**
   * «صلاحيات الأقسام» is on in «الميزات» (absent: on). Off, the sheet has no section grid, the customers' two switches
   * are back among the switches, and every other section is the rank's template.
   */
  sectionGrid?: boolean;
}

export const STATUS_ORDER: readonly MemberStatusName[] = ["ACTIVE", "SUSPENDED", "OFFBOARDED"];

export const STATUS_KEYS: Record<MemberStatusName, string> = {
  ACTIVE: "members.status_active",
  SUSPENDED: "members.status_suspended",
  OFFBOARDED: "members.status_offboarded",
};

const ROLE_VALUES: readonly OrgRoleName[] = ["OWNER", "ADMIN", "LEAD", "MEMBER", "GUEST"];

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * The response is trusted for its shape but not for completeness: a missing list becomes an empty
 * one and an unknown status or rank is read as the safest value, so one odd row cannot blank the screen.
 */
export function normalizeMember(raw: Partial<ContractMember> & { id: string }): ContractMember {
  const role = ROLE_VALUES.includes(raw.role as OrgRoleName) ? (raw.role as OrgRoleName) : "GUEST";
  const status = STATUS_ORDER.includes(raw.status as MemberStatusName) ? (raw.status as MemberStatusName) : "ACTIVE";
  const capabilities = asStringArray(raw.capabilities);
  const revokedCapabilities = asStringArray(raw.revokedCapabilities);
  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : "",
    username: raw.username ?? null,
    email: raw.email ?? null,
    jobTitle: raw.jobTitle ?? null,
    role,
    status,
    managerId: raw.managerId ?? null,
    managerName: raw.managerName ?? null,
    capabilities,
    revokedCapabilities,
    primaryOwner: role === "OWNER" ? raw.primaryOwner !== false : false,
    effectiveCapabilities: Array.isArray(raw.effectiveCapabilities)
      ? asStringArray(raw.effectiveCapabilities)
      : [...effectiveCapabilities({ role, capabilities, revokedCapabilities, primaryOwner: role === "OWNER" && raw.primaryOwner !== false })],
    lastLoginAt: raw.lastLoginAt ?? null,
    mustChangePassword: raw.mustChangePassword === true,
    openWork: typeof raw.openWork === "number" && raw.openWork > 0 ? raw.openWork : 0,
    workspaces: Array.isArray(raw.workspaces) ? raw.workspaces : [],
  };
}

export function normalizeMembersResponse(raw: Partial<MembersResponse> | null | undefined): MembersResponse {
  return {
    members: Array.isArray(raw?.members) ? raw.members.map(normalizeMember) : [],
    actorRole: raw?.actorRole ?? "GUEST",
    actorPrimaryOwner: raw?.actorPrimaryOwner === true,
    spaces: Array.isArray(raw?.spaces) ? raw.spaces : [],
  };
}

// ---------------------------------------------------------------------------------- who may do what

/**
 * May this actor edit, suspend, offboard, reset or sign out a person of this rank? Never the OWNER;
 * only the OWNER administers ADMINs; everybody else only people strictly below their own rank.
 * (The server's rule.)
 */
export const canAdministrate = canAdministrateTarget;

/** The ranks this actor may give, when creating an account and when changing a rank (never OWNER). */
export function creatableRoles(actorRole: OrgRoleName): OrgRoleName[] {
  return grantableRoles(actorRole);
}

/** A rank change: the actor administers the person AND may give the new rank. */
export const canAssignRole = canChangeRole;

export type CapabilityPanelMode = "editable" | "readonly" | "guest" | "owner";

export interface OfferedActions {
  isSelf: boolean;
  /** The actor may administer this person at all. */
  manageable: boolean;
  /** Name, job title, rank, manager. */
  edit: boolean;
  rankChoices: OrgRoleName[];
  capabilities: CapabilityPanelMode;
  suspend: boolean;
  offboard: boolean;
  reactivate: boolean;
  resetPassword: boolean;
  logoutEverywhere: boolean;
}

/**
 * What the sheet of one person offers the actor. Nobody acts on the OWNER or on themselves; an
 * offboarded person can only be reactivated; a suspended one is already signed out, so there is
 * nothing to reset or end.
 */
export function offeredActions(actor: ActorInfo, target: ContractMember): OfferedActions {
  const isSelf = target.id === actor.id;
  // the primary owner also administers the partners (other OWNERs); nobody administers him
  const manageable = !isSelf && canAdministratePerson({ role: actor.role, primaryOwner: actor.primaryOwner }, target);
  const live = target.status !== "OFFBOARDED";
  const active = target.status === "ACTIVE";
  const partner = target.role === "OWNER" && target.primaryOwner === false;
  const capabilities: CapabilityPanelMode =
    target.role === "OWNER" && !(partner && manageable)
      ? "owner"
      : target.role === "GUEST"
        ? "guest"
        : manageable && live
          ? "editable"
          : "readonly";
  return {
    isSelf,
    manageable,
    edit: manageable && live,
    rankChoices: manageable && live ? grantableRolesFor({ role: actor.role, primaryOwner: actor.primaryOwner }) : [],
    capabilities,
    suspend: manageable && canTransitionStatus("suspend", target.status),
    offboard: manageable && canTransitionStatus("offboard", target.status),
    reactivate: manageable && canTransitionStatus("reactivate", target.status),
    resetPassword: manageable && active,
    logoutEverywhere: manageable && active,
  };
}

// ---------------------------------------------------------------------------------- capabilities

export type CapabilityGroupId = "people" | "customers" | "money" | "admin" | "board" | "development" | "manufacturing";

/**
 * The whole catalogue, grouped by the area of the product it touches (`archive.view` is owner-only and
 * never a switch). The panel shows only the WIRED capabilities (`WIRED_CAPABILITIES` in the policy):
 * a switch that does nothing is a lie on the screen. A group with nothing wired is not shown, and when
 * a later phase wires one more capability it appears here by itself, in its group.
 */
export const CAPABILITY_GROUPS: readonly { id: CapabilityGroupId; capabilities: readonly Capability[] }[] = [
  { id: "people", capabilities: ["spaces.create", "users.manage", "directory.view"] },
  // the customers' view / add-edit / delete are the section grid's row («العملاء»); prices stay a switch here
  { id: "customers", capabilities: ["prices.view"] },
  { id: "money", capabilities: ["cash.view", "penalties.view"] },
  { id: "admin", capabilities: ["integrations.manage", "announce.send", "escalation.configure"] },
  // «لوحتي» (own page, on by rank) and «لوحة الفريق» (the people of the spaces one manages, off until the owner switches it on)
  { id: "board", capabilities: ["board.self", "board.team"] },
  // «الأداء والتطوير»: who sets the reporting lines and the skills checklist, and who enters skills, reviews and plans (both off for every rank)
  { id: "development", capabilities: ["people.manage_lines", "people.review"] },
  // «مخزون التصنيع»: read the quantities, record movements and stocktakes, and (the owner's alone to hand out) see the costs
  { id: "manufacturing", capabilities: ["manufacturing.view", "manufacturing.edit", "manufacturing.cost"] },
];

/**
 * Switches whose power deserves a ⚠️ next to them when the owner grants them beyond the rank: they
 * open accounts, reach another system, or show the company's money to somebody the rank does not
 * give it to. Only switches that are offered: each later phase adds its own when it wires the
 * capability (cash and penalties come with the phases that use them).
 */
export const SENSITIVE_CAPABILITIES: readonly Capability[] = ["users.manage", "integrations.manage", "prices.view", "board.team", "people.manage_lines", "people.review", "manufacturing.cost"];

/** Is this capability a switch the screen offers today? */
export function isOffered(capability: Capability): boolean {
  return WIRED_CAPABILITIES.includes(capability);
}

/**
 * The capabilities the catalogue has a group for, and nothing in this repository asks yet (the
 * security review's C3: `cash.view`, `penalties.view`, `announce.send`, `escalation.configure`).
 * They are not switches — a switch that does nothing is a lie — but hiding them completely let the
 * owner believe he had closed a door that is not built yet, so the panel lists them as «قريبًا».
 * The list empties by itself as each phase wires its capability.
 */
export const SOON_CAPABILITIES: readonly Capability[] = CAPABILITY_GROUPS.flatMap((group) => group.capabilities).filter(
  (capability) => !WIRED_CAPABILITIES.includes(capability),
);

/** What a person holds as far as handing capabilities out goes (the OWNER holds everything, whatever list the page was given). */
function holderOf(actor: ActorInfo): CapabilityHolder {
  return { role: actor.role, caps: new Set<string>(actor.role === "OWNER" && actor.primaryOwner !== false ? CAPABILITIES : actor.caps) };
}

export interface CapabilityTarget {
  role: OrgRoleName;
  capabilities: readonly string[];
  revokedCapabilities: readonly string[];
  /** OWNER rows: false for a partner, whose capabilities the primary owner switches off one by one. */
  primaryOwner?: boolean;
}

/** An OWNER who is not the primary owner. */
const partnerOf = (member: CapabilityTarget): boolean => member.role === "OWNER" && member.primaryOwner === false;

export type CapabilityLock = "readonly" | "not_grantable" | "actor_lacks";

export interface CapabilityRow {
  capability: Capability;
  /** The real state: rank default + extras - revoked (the policy's own function). */
  on: boolean;
  /** What the rank alone gives. */
  rankDefault: boolean;
  /** `on` differs from the rank default: the owner changed it. */
  customized: boolean;
  /** Why the switch cannot be touched (null = it can). */
  locked: CapabilityLock | null;
  sensitive: boolean;
}

export interface CapabilityGroupRows {
  id: CapabilityGroupId;
  rows: CapabilityRow[];
}

/**
 * The switches of one person, with their state and why a switch is locked: the sheet is read-only,
 * the capability can never be held by this rank (a guest holds none), or the actor does not hold it
 * themselves (a capability is only handed out by someone who has it; the OWNER has all). Only wired
 * capabilities are rows, and a group left without any is dropped.
 */
export function capabilityGroups(member: CapabilityTarget, actor: ActorInfo, editable: boolean): CapabilityGroupRows[] {
  const rowOf = rowBuilder(member, actor, editable);
  // the grid switched off in «الميزات»: the customers' read and write are the two switches they were before it
  const groupsShown =
    actor.sectionGrid === false
      ? CAPABILITY_GROUPS.map((g) => (g.id === "customers" ? { ...g, capabilities: ["crm.view", "crm.edit", ...g.capabilities] as Capability[] } : g))
      : CAPABILITY_GROUPS;
  const groups = groupsShown.map((group) => ({
    id: group.id,
    rows: group.capabilities.filter(isOffered).map(rowOf),
  }));
  return groups.filter((group) => group.rows.length > 0);
}

/** One switch's state and lock for this person, as the server would judge it (shared by the switches and the grid). */
function rowBuilder(member: CapabilityTarget, actor: ActorInfo, editable: boolean): (capability: Capability) => CapabilityRow {
  const effective = effectiveCapabilities(member, { sectionGrid: actor.sectionGrid !== false });
  const defaults = new Set<Capability>(RANK_DEFAULTS[member.role]);
  const holder = holderOf(actor);
  return (capability) => {
    const on = effective.has(capability);
    const rankDefault = defaults.has(capability);
    let locked: CapabilityLock | null = null;
    if (!editable) {
      locked = "readonly";
    } else {
      // the server's own question: may this actor switch this capability for a person of this rank?
      const problem = capabilityChangeProblem(holder, member.role, capability, partnerOf(member));
      if (problem === "accounts.cap_not_held") locked = "actor_lacks";
      else if (problem) locked = "not_grantable";
    }
    return {
      capability,
      on,
      rankDefault,
      customized: on !== rankDefault,
      locked,
      sensitive: SENSITIVE_CAPABILITIES.includes(capability),
    };
  };
}

export interface SectionCell extends CapabilityRow {
  action: SectionAction;
  /** «يضيف ويعدّل» or «يحذف» while «يشوف» is off: shown off and not clickable (the server drops it too). */
  needsView: boolean;
}

export interface SectionGridRow {
  section: SectionId;
  /** One cell per action of the grid (view, edit, delete); null where the section has no such action. */
  cells: Record<SectionAction, SectionCell | null>;
}

export const SECTION_ACTIONS: readonly SectionAction[] = ["view", "edit", "delete"];

/**
 * The per-person grid (the owner's decision, 2026-10-26): a row per section, «يشوف / يضيف ويعدّل / يحذف» across. Each
 * cell is the same switch as on the list, with the same locks; a section the person can not see shows its other boxes
 * off and locked, since the server ignores them until «يشوف» is back.
 */
export function sectionGrid(member: CapabilityTarget, actor: ActorInfo, editable: boolean): SectionGridRow[] {
  if (actor.sectionGrid === false) return [];
  const rowOf = rowBuilder(member, actor, editable);
  return SECTIONS.map((section) => {
    const viewCap = sectionCapability(section.id, "view");
    const sees = viewCap !== null && rowOf(viewCap).on;
    const cells = {} as Record<SectionAction, SectionCell | null>;
    for (const action of SECTION_ACTIONS) {
      const capability = (section.actions as readonly SectionAction[]).includes(action) ? sectionCapability(section.id, action) : null;
      if (!capability) {
        cells[action] = null;
        continue;
      }
      const row = rowOf(capability);
      const needsView = action !== "view" && !sees;
      cells[action] = { ...row, action, needsView, locked: needsView && row.locked === null ? "not_grantable" : row.locked };
    }
    return { section: section.id, cells };
  });
}

export interface CapabilityLists {
  capabilities: string[];
  revokedCapabilities: string[];
}

/** Only real capabilities, once each, in the catalogue's order (what the server stores and accepts). */
function cleanList(list: readonly string[]): string[] {
  return inCatalogueOrder(list.filter(isCapability));
}

/**
 * The two stored lists after the owner flips ONE switch. Only that capability changes: a switch that
 * returns to the rank default leaves no trace, and every other entry stays. The lists are sent whole
 * and the server refuses a name it does not know, so anything that is not a capability is left out
 * (it had no effect anyway).
 */
export function toggleCapability(member: CapabilityTarget, capability: Capability, on: boolean): CapabilityLists {
  const defaults = new Set<string>(RANK_DEFAULTS[member.role]);
  const capabilities = member.capabilities.filter((c) => c !== capability);
  const revokedCapabilities = member.revokedCapabilities.filter((c) => c !== capability);
  if (on && !defaults.has(capability)) capabilities.push(capability);
  if (!on && defaults.has(capability)) revokedCapabilities.push(capability);
  return { capabilities: cleanList(capabilities), revokedCapabilities: cleanList(revokedCapabilities) };
}

/**
 * "Back to the rank's defaults": the lists with every DISPLAYED switch the actor may change cleared.
 * What the screen does not show stays exactly as stored (a hidden capability is not the screen's to
 * drop), and so does anything the actor does not hold: the server refuses a request that takes away
 * what its sender does not hold, so leaving those entries is what keeps the request valid.
 */
export function resetCapabilityLists(member: CapabilityTarget, actor: ActorInfo): CapabilityLists {
  const holder = holderOf(actor);
  // offered, and the actor may switch it for a person of this rank (the server's own question: it also asks that they hold it)
  // with the grid switched off its boxes are not on the screen either: they stay stored for when it is on again
  const shown = (capability: Capability) =>
    actor.sectionGrid !== false || !SECTION_CAPABILITIES.includes(capability) || capability === "crm.view" || capability === "crm.edit";
  const clearable = (capability: string) =>
    isCapability(capability) &&
    isOffered(capability) &&
    shown(capability) &&
    capabilityChangeProblem(holder, member.role, capability, partnerOf(member)) === null;
  return {
    capabilities: cleanList(member.capabilities.filter((c) => !clearable(c))),
    revokedCapabilities: cleanList(member.revokedCapabilities.filter((c) => !clearable(c))),
  };
}

/** Does a reset change anything? (Hidden entries and what the actor cannot take away do not count.) */
export function canResetCapabilities(member: CapabilityTarget, actor: ActorInfo): boolean {
  const next = resetCapabilityLists(member, actor);
  return (
    next.capabilities.length !== cleanList(member.capabilities).length ||
    next.revokedCapabilities.length !== cleanList(member.revokedCapabilities).length
  );
}

/**
 * The two lists a person ends up with after somebody changes their rank, composed exactly as the
 * server does it (accounts.ts, `updateAccount`): what the new rank can hold of the stored lists, plus
 * the new rank's defaults that the one who re-ranks does not hold themselves, switched off, so nobody
 * produces an account holding more than they hold (an explicit extra the person already has stays).
 * The OWNER holds everything, so for him nothing is added. A DB test compares this with the server.
 */
export function capabilityListsAfterRankChange(actor: ActorInfo, member: CapabilityTarget, newRole: OrgRoleName): CapabilityLists {
  const holder = holderOf(actor);
  const extras = replaceCapabilityList(holder, newRole, member.capabilities, undefined).next;
  const revoked = replaceCapabilityList(holder, newRole, member.revokedCapabilities, undefined).next;
  return {
    capabilities: extras,
    revokedCapabilities: inCatalogueOrder([...revoked, ...unheldRankDefaults(holder, newRole, extras)]),
  };
}

/** Everything the screen needs about a person's capabilities after a change, ready for the cache (in the catalogue's order, as the server answers). */
export function capabilityPatch(member: Pick<ContractMember, "role">, lists: CapabilityLists): Pick<ContractMember, "capabilities" | "revokedCapabilities" | "effectiveCapabilities"> {
  return {
    ...lists,
    effectiveCapabilities: inCatalogueOrder(effectiveCapabilities({ role: member.role, primaryOwner: (member as { primaryOwner?: boolean }).primaryOwner, ...lists })),
  };
}

// ---------------------------------------------------------------------------------- time in Arabic

/** The Arabic number form: one, two, 3-10 (plural), 11+ (singular again). */
export function arabicPlural(n: number): "one" | "two" | "few" | "many" {
  if (n === 1) return "one";
  if (n === 2) return "two";
  const m = n % 100;
  if (m >= 3 && m <= 10) return "few";
  return "many";
}

/**
 * "قبل 3 ساعات" for a timestamp, "الآن" under a minute (or in the future: a clock that runs ahead),
 * and "لم يسجّل دخولًا بعد" when there is none. The sentences live in the dictionary
 * (`members.ago.<unit>.<form>`), because Arabic needs a different word for one, two and a few.
 */
export function relativeTimeAr(iso: string | null | undefined, now: number, t: TFn): string {
  if (!iso) return t("members.never_logged");
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return t("members.never_logged");
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 45) return t("members.ago.now");
  let unit: "minute" | "hour" | "day" | "month" | "year";
  let n: number;
  if (seconds < 3600) {
    unit = "minute";
    n = Math.max(1, Math.floor(seconds / 60));
  } else if (seconds < 86400) {
    unit = "hour";
    n = Math.floor(seconds / 3600);
  } else {
    const days = Math.floor(seconds / 86400);
    if (days < 30) {
      unit = "day";
      n = days;
    } else if (days < 365) {
      unit = "month";
      n = Math.floor(days / 30);
    } else {
      unit = "year";
      n = Math.floor(days / 365);
    }
  }
  return t(`members.ago.${unit}.${arabicPlural(n)}`, { n });
}

/** "آخر دخول: قبل 3 ساعات", or "لم يسجّل دخولًا بعد" when there was none. */
export function lastLoginLine(iso: string | null | undefined, now: number, t: TFn): string {
  const when = relativeTimeAr(iso, now, t);
  return iso && !Number.isNaN(Date.parse(iso)) ? t("members.last_login", { when }) : when;
}

// ---------------------------------------------------------------------------------- list: search, filter, sort

/** Lower-cases, drops diacritics and tatweel, and folds the spellings people type (أ إ آ -> ا, ى -> ي, ة -> ه). */
export function normalizeSearch(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every word of the search must appear somewhere in the name, username, e-mail or job title. */
export function filterMembers(members: readonly ContractMember[], query: string, status: StatusFilter): ContractMember[] {
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  return members.filter((m) => {
    if (status !== "ALL" && m.status !== status) return false;
    if (words.length === 0) return true;
    const haystack = [m.name, m.username, m.email, m.jobTitle]
      .filter((v): v is string => Boolean(v))
      .map(normalizeSearch)
      .join("\n");
    return words.every((w) => haystack.includes(w));
  });
}

export function statusCounts(members: readonly ContractMember[]): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { ALL: members.length, ACTIVE: 0, SUSPENDED: 0, OFFBOARDED: 0 };
  for (const m of members) counts[m.status] += 1;
  return counts;
}

/** ACTIVE first, then SUSPENDED, then OFFBOARDED; inside a status the server's order is kept. */
export function sortMembers(members: readonly ContractMember[]): ContractMember[] {
  return [...members].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
}

/** "المقر، الشحن وغيرها (2)": the spaces a person is in, shortened for a card. */
export function spacesSummary(member: Pick<ContractMember, "role" | "workspaces">, t: TFn, max = 3): string {
  if (member.role === "OWNER") return t("members.spaces_all");
  const names = member.workspaces.map((w) => w.name);
  if (names.length === 0) return t("members.spaces_none");
  const shown = names.slice(0, max).join("، ");
  const rest = names.length - max;
  return rest > 0 ? `${shown} ${t("members.spaces_more", { n: rest })}` : shown;
}

// ---------------------------------------------------------------------------------- pickers

/** Everybody below the person in the reporting chain (directly or not). */
function reportsOf(members: readonly ContractMember[], personId: string): Set<string> {
  const found = new Set<string>();
  const queue = [personId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const m of members) {
      if (m.managerId === current && !found.has(m.id)) {
        found.add(m.id);
        queue.push(m.id);
      }
    }
  }
  return found;
}

/** Who can be somebody's manager: an ACTIVE staff member other than them and not one of their own reports (no loops). */
export function managerCandidates(members: readonly ContractMember[], personId: string): ContractMember[] {
  const reports = reportsOf(members, personId);
  return members.filter((m) => m.status === "ACTIVE" && m.role !== "GUEST" && m.id !== personId && !reports.has(m.id));
}

/** Who can receive the open work of a person who leaves: an ACTIVE staff member other than them. */
export function transferCandidates(members: readonly ContractMember[], personId: string): ContractMember[] {
  return members.filter((m) => m.status === "ACTIVE" && m.role !== "GUEST" && m.id !== personId);
}

// ---------------------------------------------------------------------------------- the add-person form

export interface AddFormValues {
  name: string;
  username: string;
  email: string;
  jobTitle: string;
  role: OrgRoleName;
  managerId: string;
  workspaceIds: string[];
  autoPassword: boolean;
  password: string;
}

export const EMPTY_ADD_FORM: AddFormValues = {
  name: "",
  username: "",
  email: "",
  jobTitle: "",
  role: "MEMBER",
  managerId: "",
  workspaceIds: [],
  autoPassword: true,
  password: "",
};

export type AddFormField = "name" | "username" | "email" | "password";

/** The server's limits for a name and a job title (accounts.ts). */
export const NAME_MAX = 80;
export const JOB_TITLE_MAX = 80;

export interface FormProblem {
  field: AddFormField;
  /** A dictionary key. */
  key: string;
}

/** A username is typed in lower case, with no spaces, whatever the keyboard did. */
export function normalizeUsername(input: string): string {
  return input.replace(/\s+/g, "").toLowerCase();
}

/** The server's password policy (credentials.ts): 8 to 200 characters with a letter and a digit. */
export function passwordProblem(password: string): string | null {
  if (password.length >= 8 && password.length <= 200 && /[A-Za-z]/.test(password) && /[0-9]/.test(password)) return null;
  return "auth.passwordRule";
}

/** The server's username rule (credentials.ts): 3 to 32 of a-z 0-9 . _ -, the first a letter or a digit. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
const USERNAME_SHAPE = /^[a-z0-9][a-z0-9._-]*$/;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The first thing wrong with the form (the server validates again), or null. */
export function validateAddForm(v: AddFormValues): FormProblem | null {
  if (v.name.trim().length < 2 || v.name.trim().length > NAME_MAX) return { field: "name", key: "members.v_name" };
  const username = normalizeUsername(v.username);
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX || !USERNAME_SHAPE.test(username)) {
    return { field: "username", key: "members.v_username" };
  }
  const email = v.email.trim();
  if (email && !EMAIL_SHAPE.test(email)) return { field: "email", key: "members.v_email" };
  if (!v.autoPassword) {
    const problem = passwordProblem(v.password);
    if (problem) return { field: "password", key: problem };
  }
  return null;
}

export interface CreatePayload {
  name: string;
  username: string;
  role: OrgRoleName;
  workspaceIds: string[];
  email?: string;
  jobTitle?: string;
  managerId?: string;
  password?: string;
}

/** `POST /api/organizations/[id]/members` body: optional fields are left out when blank, the password only when typed. */
export function buildCreatePayload(v: AddFormValues): CreatePayload {
  const payload: CreatePayload = {
    name: v.name.trim(),
    username: normalizeUsername(v.username),
    role: v.role,
    workspaceIds: [...v.workspaceIds],
  };
  const email = v.email.trim().toLowerCase();
  if (email) payload.email = email;
  const jobTitle = v.jobTitle.trim();
  if (jobTitle) payload.jobTitle = jobTitle;
  if (v.managerId && v.role !== "GUEST") payload.managerId = v.managerId;
  if (!v.autoPassword) payload.password = v.password;
  return payload;
}

// ---------------------------------------------------------------------------------- editing one person

export interface InfoForm {
  name: string;
  jobTitle: string;
  role: OrgRoleName;
  managerId: string;
}

export interface InfoPatch {
  name?: string;
  jobTitle?: string;
  role?: OrgRoleName;
  managerId?: string | null;
}

export function validateInfoForm(form: InfoForm): FormProblem | null {
  if (form.name.trim().length < 2 || form.name.trim().length > NAME_MAX) return { field: "name", key: "members.v_name" };
  return null;
}

/** Only the fields that changed. An empty job title clears it ("" is what the server expects); no manager is `null`. */
export function buildInfoPatch(member: ContractMember, form: InfoForm): InfoPatch {
  const patch: InfoPatch = {};
  const name = form.name.trim();
  if (name !== member.name) patch.name = name;
  const jobTitle = form.jobTitle.trim();
  if (jobTitle !== (member.jobTitle ?? "")) patch.jobTitle = jobTitle;
  if (form.role !== member.role) patch.role = form.role;
  const managerId = form.managerId || null;
  if (managerId !== (member.managerId ?? null)) patch.managerId = managerId;
  return patch;
}

// ---------------------------------------------------------------------------------- the login message

export function loginUrlOf(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/login`;
}

/**
 * The ready message the owner pastes into a chat: where to sign in, the username, the temporary
 * password and "change it on first sign-in". The placeholders are filled here, in one pass with a
 * function (not through `t()`'s variables): a generated password may contain `$&` or `$$`, which a
 * string replacement would turn into something else.
 */
export function buildLoginMessage(
  t: TFn,
  v: { name: string; loginUrl: string; username: string; password: string },
): string {
  const values: Record<string, string> = {
    name: v.name,
    app: t("app.name"),
    url: v.loginUrl,
    username: v.username,
    password: v.password,
  };
  return t("members.login_message").replace(/\{(name|app|url|username|password)\}/g, (_m, key: string) => values[key] ?? "");
}

// ---------------------------------------------------------------------------------- errors

interface ApiErrorLike {
  code: string;
  status: number;
  messageKey?: string;
  details?: unknown;
}

function isApiErrorLike(err: unknown): err is ApiErrorLike {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { code?: unknown }).code === "string" &&
    typeof (err as { status?: unknown }).status === "number"
  );
}

/**
 * An Arabic sentence for whatever the server said. The server answers `{ error, message }` where
 * `message` is a dictionary key (`orgm.role_denied`, `accounts.username_taken`, ...). A key nobody
 * translated is never shown: the validation details, then the HTTP status, give an honest sentence.
 */
export function memberErrorMessage(err: unknown, t: TFn): string {
  if (!isApiErrorLike(err)) return err instanceof TypeError ? t("members.err_network") : t("common.error");

  // «validation.failed» carries the field's own message in its details; show that first when it
  // translates, and the generic validation sentence only when it does not.
  if (Array.isArray(err.details)) {
    for (const detail of err.details as { message?: unknown }[]) {
      const message = typeof detail?.message === "string" ? detail.message : null;
      if (!message) continue;
      const text = t(message);
      if (text !== message) return text;
    }
  }
  const key = err.messageKey;
  if (key) {
    const text = t(key);
    if (text !== key) return text;
  }
  // A code the namespaced dictionaries do not carry may still live in the flat one (the account
  // service's codes are named after their fields there, e.g. «validation.failed», «auth.required»).
  if (err.code && err.code !== key) {
    const text = t(err.code);
    if (text !== err.code) return text;
  }

  switch (err.status) {
    case 400:
      return t("members.err_validation");
    case 401:
      return t("members.err_session");
    case 403:
      return t("forbidden");
    case 404:
      return t("members.err_not_found");
    case 409:
      return t("members.err_conflict");
    case 422:
      return t("members.err_validation");
    case 429:
      return t("members.err_rate_limited");
    default:
      return err.code === "validation.failed" ? t("members.err_validation") : t("common.error");
  }
}
