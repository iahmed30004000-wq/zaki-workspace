import type { OrgRole } from "@prisma/client";
import { featureOn, type FeatureKey } from "@/lib/features";

/**
 * Capabilities: what a person may do ON TOP of their rank. The rank gives a sensible default set;
 * the owner switches single capabilities on or off for a person instead of inventing new ranks.
 * Stored per member in `capabilities` (extra) and `revokedCapabilities` (taken away).
 */
export const CAPABILITIES = [
  "spaces.create", // open a new space and choose its people
  // create accounts, suspend, offboard, reset passwords: ACCOUNTS ONLY (A1.3). It is no longer the guide's «managers» list
  // (src/lib/guide/audience.ts `MANAGER_CAPABILITIES`). Still read as «manages people» by the Today team widgets
  // (services/today.ts `showPulse`, services/today-dashboard.ts `showTeam`): they move to the team rule of A2.3
  // (`policy/people-scope.ts`, fix/team-scope); the settings tab and the nav entries keep it for the accounts screen.
  "users.manage",
  "directory.view", // see the staff directory (names, titles, e-mail)
  "crm.view", // read customers and opportunities
  "crm.edit", // create and edit customers and opportunities
  "crm.delete", // delete customers and opportunities
  "prices.view", // see price data
  "integrations.manage", // n8n, Telegram, Google Drive
  "announce.send", // company-wide announcements
  "escalation.configure", // the escalation thresholds
  "cash.view", // the cash custody card (data comes from the OMS)
  "penalties.view", // everybody's penalties and rewards (data comes from the OMS)
  "archive.view", // the owner's archive and "all of the company" chat view: never grantable
  "board.self", // «لوحتي»: the person's OWN page of the owner's board (their days, tasks, steps, message counts)
  "board.team", // «لوحة الفريق»: the board for the people of the spaces the person manages (never the owner's, never the company's totals)
  "people.manage_lines", // «الهيكل»: sets who answers to whom, and keeps the skills checklist («المهارات»); off for every rank, the owner switches it per person
  "people.review", // «الأداء والتطوير»: ENTERS skills, reviews, plans and notes about the people of one's own subtree (every supervisor READS the subtree without it)
  // the sections, each with «يشوف» (view), «يضيف ويعدّل» (edit) and «يحذف» (delete): the per-person grid
  "projects.view",
  "projects.edit",
  "tasks.view",
  "tasks.edit",
  "tasks.delete",
  "calls.view",
  "calls.edit",
  "watch.view",
  "watch.edit",
  "ideas.view",
  "ideas.edit",
  "ideas.delete",
  "goals.view",
  "goals.edit",
  "goals.delete",
  "production.view",
  "production.edit",
  "production.delete",
  "reports.view",
  "files.view",
  "files.edit",
  "files.delete",
  "tickets.view",
  "tickets.edit",
  "tickets.delete",
  "campaigns.view",
  "campaigns.edit",
  "campaigns.delete",
  // «مخزون التصنيع» (the stock and cost ledger of a manufacturing space): read quantities / record movements and stocktakes / see ANY cost.
  // The service (manufacturing-access.ts) asks for `view` first, so an edit or a cost box without it opens nothing.
  "manufacturing.view",
  "manufacturing.edit",
  "manufacturing.cost",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}

export type SectionAction = "view" | "edit" | "delete";

/**
 * The sections of the per-person grid (the owner's decision, 2026-10-26: «يشوف / يضيف ويعدّل / يحذف» for every
 * section, by person). Each row lists the actions the section has; a section's capability is `<section>.<action>`.
 * Only wired sections are here: a box that does nothing is a lie on the screen, so each later phase adds its own.
 */
export const SECTIONS = [
  { id: "projects", actions: ["view", "edit"] },
  { id: "tasks", actions: ["view", "edit", "delete"] },
  { id: "ideas", actions: ["view", "edit", "delete"] },
  { id: "goals", actions: ["view", "edit", "delete"] },
  { id: "production", actions: ["view", "edit", "delete"] },
  { id: "files", actions: ["view", "edit", "delete"] },
  { id: "tickets", actions: ["view", "edit", "delete"] },
  { id: "campaigns", actions: ["view", "edit", "delete"] },
  { id: "crm", actions: ["view", "edit", "delete"] },
  { id: "calls", actions: ["view", "edit"] },
  { id: "watch", actions: ["view", "edit"] },
  { id: "reports", actions: ["view"] },
] as const satisfies readonly { id: string; actions: readonly SectionAction[] }[];

export type SectionId = (typeof SECTIONS)[number]["id"];

export function sectionCapability(section: SectionId, action: SectionAction): Capability | null {
  const capability = `${section}.${action}`;
  return isCapability(capability) ? capability : null;
}

/** The boxes of the section grid (each wired): the people screen shows them as the grid, never as switches. */
export const SECTION_CAPABILITIES: readonly Capability[] = SECTIONS.flatMap((section) =>
  section.actions.map((action) => `${section.id}.${action}` as Capability),
);

/**
 * A grid section's add/edit and delete need its view: whoever can not see a section can not change it either. Only the
 * grid's sections: the customers' `crm.view` / `crm.edit` keep their own meaning until they join the grid.
 */
function dropWithoutView(caps: Set<Capability>): Set<Capability> {
  for (const section of SECTIONS) {
    const view = sectionCapability(section.id, "view");
    if (view && caps.has(view)) continue;
    for (const action of ["edit", "delete"] as const) {
      const c = sectionCapability(section.id, action);
      if (c) caps.delete(c);
    }
  }
  return caps;
}

/**
 * The switches that change something TODAY. The rest are in the catalogue so that stored values and
 * later phases stay valid, but a switch that does nothing is a lie on the people screen, so only
 * these are offered there (each later phase adds its own: announcements, escalation, cash and
 * penalties come with the phases that use them). `prices.view` joined the list with the customers
 * screen's own fix (security review C2): from then on the CRM service hides the amount from whoever
 * lacks it, so the switch really closes a door.
 */
export const WIRED_CAPABILITIES: readonly Capability[] = [
  "spaces.create",
  "users.manage",
  "directory.view",
  "integrations.manage",
  // A1.2: wired by Q1.6 (who may mark a message «لازم ينقرأ») and Q1.5 (the door of «المشاكل تصير تذاكر»), so the sheet offers them again;
  // I1.3 wires `cash.view`: the amount of an office-expense request («طلب مصروف», «تحويل بين الصناديق») is cut on the server for anybody who
  // holds neither it nor `prices.view` (src/server/services/approval-access.ts `seesMoney`); `penalties.view` stays out (R12 of docs/PHASE0-AUDIT.md)
  "announce.send",
  "escalation.configure",
  "prices.view",
  "cash.view",
  "board.self",
  "board.team",
  "people.manage_lines",
  "people.review",
  "manufacturing.view",
  "manufacturing.edit",
  "manufacturing.cost",
  ...SECTION_CAPABILITIES,
];

/**
 * What each rank can do without anyone switching anything on. The OWNER can do everything.
 *
 * `spaces.create` is the owner's and the admins' by default (the owner's decision, 2026-10-25: «المالك
 * والمديرين بس بيفتحوا مساحات»): a lead or a member opens a space only if the owner switches it on for
 * them by name (a per-person extra in `capabilities`, which this change leaves untouched).
 *
 * The sections give each rank exactly what it could do before the grid existed, so nothing changes until the owner
 * flips a box: ideas are everyone's; goals and production routines are seen by all staff and managed by the
 * admins; the reports are a lead's and up; the library, the tickets, the campaigns and the customers are all staff's;
 * the projects and the tasks too (an external partner works in their shared spaces by the space's own rules, not the
 * grid; deleting a task still takes the space's admin); the calls (join; start and run one) and «نتفرّج سوا» (watch; start
 * and end one) too.
 */
export const RANK_DEFAULTS: Record<OrgRole, readonly Capability[]> = {
  OWNER: CAPABILITIES,
  ADMIN: [
    "spaces.create",
    "users.manage",
    "board.self",
    "directory.view",
    "crm.view",
    "crm.edit",
    "prices.view",
    "integrations.manage",
    "announce.send",
    "escalation.configure",
    "ideas.view",
    "ideas.edit",
    "ideas.delete",
    "goals.view",
    "goals.edit",
    "goals.delete",
    "production.view",
    "production.edit",
    "production.delete",
    "reports.view",
    "files.view",
    "files.edit",
    "files.delete",
    "tickets.view",
    "tickets.edit",
    "tickets.delete",
    "campaigns.view",
    "campaigns.edit",
    "campaigns.delete",
    "crm.delete",
    "projects.view",
    "projects.edit",
    "tasks.view",
    "tasks.edit",
    "tasks.delete",
    "calls.view",
    "calls.edit",
    "watch.view",
    "watch.edit",
    // the stock ledger: an ADMIN reads and records (inside a manufacturing space he is in); the COST is the owner's alone to hand out
    "manufacturing.view",
    "manufacturing.edit",
  ],
  LEAD: [
    "board.self",
    "directory.view",
    "crm.view",
    "crm.edit",
    "prices.view",
    "ideas.view",
    "ideas.edit",
    "ideas.delete",
    "goals.view",
    "production.view",
    "reports.view",
    "files.view",
    "files.edit",
    "files.delete",
    "tickets.view",
    "tickets.edit",
    "tickets.delete",
    "campaigns.view",
    "campaigns.edit",
    "campaigns.delete",
    "crm.delete",
    "projects.view",
    "projects.edit",
    "tasks.view",
    "tasks.edit",
    "tasks.delete",
    "calls.view",
    "calls.edit",
    "watch.view",
    "watch.edit",
  ],
  MEMBER: [
    "board.self",
    "directory.view",
    "crm.view",
    "crm.edit",
    "ideas.view",
    "ideas.edit",
    "ideas.delete",
    "goals.view",
    "production.view",
    "files.view",
    "files.edit",
    "files.delete",
    "tickets.view",
    "tickets.edit",
    "tickets.delete",
    "campaigns.view",
    "campaigns.edit",
    "campaigns.delete",
    "crm.delete",
    "projects.view",
    "projects.edit",
    "tasks.view",
    "tasks.edit",
    "tasks.delete",
    "calls.view",
    "calls.edit",
    "watch.view",
    "watch.edit",
  ],
  GUEST: [],
};

/**
 * An external partner (GUEST) can never hold any capability, even if one is stored: they must
 * never see prices or the staff directory, and never run anything. Enforced here AND when granting.
 */
export const EXTERNAL_FORBIDDEN: readonly Capability[] = CAPABILITIES;

/** Only the OWNER has these, and they can not be handed to anyone. */
export const OWNER_ONLY: readonly Capability[] = ["archive.view"];


/**
 * «محصور بمساحة» (src/server/policy/space-only.ts): the boxes that reach the whole company, so an account that works only in its
 * spaces never holds them, whatever its rank gives or somebody switches on for it.
 */
export const SPACE_ONLY_WITHHELD: readonly Capability[] = [
  "spaces.create",
  "users.manage",
  "integrations.manage",
  "announce.send",
  "escalation.configure",
  "board.team",
  "people.manage_lines",
  "people.review",
  "reports.view",
  "crm.view",
  "crm.edit",
  "crm.delete",
  "tickets.view",
  "tickets.edit",
  "tickets.delete",
  "campaigns.view",
  "campaigns.edit",
  "campaigns.delete",
];

export interface CapabilitySource {
  role: OrgRole;
  /** «محصور بمساحة»: the company-wide boxes (`SPACE_ONLY_WITHHELD`) are taken away. */
  spaceOnly?: boolean | null;
  capabilities?: readonly string[] | null;
  revokedCapabilities?: readonly string[] | null;
  /** OWNER rows: false for a partner («شريك»), whose permissions the primary owner may take away one by one. */
  primaryOwner?: boolean | null;
}

/** An OWNER who is not the primary owner: a partner. */
export function isPartner(member: Pick<CapabilitySource, "role" | "primaryOwner">): boolean {
  return member.role === "OWNER" && member.primaryOwner === false;
}

/**
 * rank defaults + extras - revoked, then the hard limits (guests none, owner-only capabilities, no add/edit or delete
 * in a section one can not see). The primary owner holds everything; a partner everything but what the primary owner
 * took away from him.
 */
export function effectiveCapabilities(member: CapabilitySource, opts: CapabilityOptions = {}): Set<Capability> {
  const caps = rankAndBoxes(member, opts);
  if (member.spaceOnly) for (const c of SPACE_ONLY_WITHHELD) caps.delete(c);
  return caps;
}

function rankAndBoxes(member: CapabilitySource, opts: CapabilityOptions): Set<Capability> {
  if (opts.sectionGrid === false) return withoutGrid(member);
  if (isPartner(member)) {
    const caps = new Set<Capability>(CAPABILITIES);
    for (const c of member.revokedCapabilities ?? []) if (isCapability(c)) caps.delete(c);
    return dropWithoutView(caps);
  }
  if (member.role === "OWNER") return new Set(CAPABILITIES);
  if (member.role === "GUEST") return new Set();
  const caps = new Set<Capability>(RANK_DEFAULTS[member.role]);
  for (const c of member.capabilities ?? []) if (isCapability(c)) caps.add(c);
  for (const c of member.revokedCapabilities ?? []) if (isCapability(c)) caps.delete(c);
  for (const c of OWNER_ONLY) caps.delete(c);
  return dropWithoutView(caps);
}

export interface CapabilityOptions {
  /**
   * «الميزات» → «صلاحيات الأقسام» (src/lib/features.ts, `sectionPermissions`). Off (`false`), the site is as it was
   * before the grid: every section box is the rank's template, whatever was stored for the person (kept for when it
   * is switched on again), except the customers' `crm.view` / `crm.edit`, which were switches of their own before
   * and stay so, with deleting following `crm.edit` as it did. Absent or `true`: the grid decides.
   */
  sectionGrid?: boolean;
}

/** BEFORE THE GRID: the person's switches as stored, the section boxes from the rank's template. */
const PRE_GRID_SWITCHES: readonly Capability[] = ["crm.view", "crm.edit"];
function withoutGrid(member: CapabilitySource): Set<Capability> {
  const gridOnly = (c: string) => isCapability(c) && SECTION_CAPABILITIES.includes(c) && !PRE_GRID_SWITCHES.includes(c);
  const stored = {
    ...member,
    capabilities: (member.capabilities ?? []).filter((c) => !gridOnly(c)),
    revokedCapabilities: (member.revokedCapabilities ?? []).filter((c) => !gridOnly(c)),
  };
  // the rules without the grid's own: no «without view, no edit»; deleting customers went with editing them
  let caps: Set<Capability>;
  if (isPartner(stored)) {
    caps = new Set<Capability>(CAPABILITIES);
    for (const c of stored.revokedCapabilities) if (isCapability(c)) caps.delete(c);
  } else if (stored.role === "OWNER") {
    return new Set(CAPABILITIES);
  } else if (stored.role === "GUEST") {
    return new Set();
  } else {
    caps = new Set<Capability>(RANK_DEFAULTS[stored.role]);
    for (const c of stored.capabilities) if (isCapability(c)) caps.add(c);
    for (const c of stored.revokedCapabilities) if (isCapability(c)) caps.delete(c);
    for (const c of OWNER_ONLY) caps.delete(c);
  }
  if (caps.has("crm.edit")) caps.add("crm.delete");
  else caps.delete("crm.delete");
  return caps;
}

export function can(source: CapabilitySource, capability: Capability, opts: CapabilityOptions = {}): boolean {
  return effectiveCapabilities(source, opts).has(capability);
}

// ---------------------------------------------------------------------------------------------------
// «شو بيقدر يعمل؟»: what a person can do and WHY, as a pure function next to effectiveCapabilities
// ---------------------------------------------------------------------------------------------------

/**
 * The capabilities that live behind one of the company's switches («الميزات»): the server refuses the door of that
 * feature while its switch is off, whatever the person holds. Only doors that really check the switch are listed:
 * calls (calls/*), «نتفرّج سوا» (watch routes), the owner board (`boardAccess`), «الأداء والتطوير» (`devAccess`), the stock
 * ledger (its pages and services), «ضبط التصعيد» (`problem-settings.ts`: autoTickets) and «إعلانات للجميع» (the «لازم ينقرأ»
 * door, `must-read.ts`: mustRead).
 */
export const CAPABILITY_FEATURE: Readonly<Partial<Record<Capability, FeatureKey>>> = {
  "calls.view": "calls",
  "calls.edit": "calls",
  "watch.view": "watch",
  "watch.edit": "watch",
  "board.self": "ownerBoard",
  "board.team": "ownerBoard",
  "people.manage_lines": "teamDevelopment",
  "people.review": "teamDevelopment",
  "manufacturing.view": "mfgLedger",
  "manufacturing.edit": "mfgLedger",
  "manufacturing.cost": "mfgLedger",
  "escalation.configure": "autoTickets",
  "announce.send": "mustRead",
};

/**
 * Why a person holds a capability or not (the verdict of `effectiveCapabilities`, in words):
 *  - `owner`         the primary owner holds everything, and a partner everything the primary owner did not take away
 *  - `rank_default`  the rank gives it
 *  - `added`         the owner switched it on by hand, on top of the rank
 *  - `removed`       the owner switched it off by hand (for a partner: took it away)
 *  - `rank_lacks`    the rank does not give it and nobody added it
 *  - `guest`         an external partner holds nothing
 *  - `owner_only`    the owner rank's alone (`archive.view`), never grantable
 *  - `needs_view`    an add/edit or delete box of a section whose «يشوف» is off
 *  - `grid_off`      «صلاحيات الأقسام» is off: the section boxes are the rank's template, whatever was stored
 *  - `space_only`    the account works only in its spaces: the company-wide boxes are never its
 *  - `feature_off`   the person holds it, but the company switched the feature behind it off (`reason` only, never `basis`)
 */
export type ExplainReason =
  | "owner"
  | "rank_default"
  | "added"
  | "removed"
  | "rank_lacks"
  | "guest"
  | "owner_only"
  | "needs_view"
  | "grid_off"
  | "space_only"
  | "feature_off";

export interface CapabilityExplanation {
  capability: Capability;
  /** EXACTLY what `effectiveCapabilities` says: what the server holds against the person's rank and boxes. */
  held: boolean;
  /** `held` and the company's switch behind it (if any) is on: never more than `held`. */
  usable: boolean;
  /** Why `held` is what it is (never `feature_off`). */
  basis: Exclude<ExplainReason, "feature_off">;
  /** The reason to show: `basis`, except `feature_off` for a held capability whose company switch is off. */
  reason: ExplainReason;
  /** The company switch behind this capability, when it has one. */
  feature?: FeatureKey;
}

/** A section's box of the grid (the customers' view and edit were switches of their own before it). */
function isGridBox(capability: Capability): boolean {
  return SECTION_CAPABILITIES.includes(capability) && !PRE_GRID_SWITCHES.includes(capability);
}

/**
 * EVERY capability of the catalogue with ✓/✗ and the reason, for one person under one company's settings
 * (`Organization.settings`). `held` is `effectiveCapabilities` itself (the screen may never promise what the server
 * refuses: tests/policy-capabilities.test.ts compares them for every rank x switch); the reasons only describe it.
 */
export function explainCapabilities(member: CapabilitySource, settings: unknown): CapabilityExplanation[] {
  const sectionGrid = featureOn(settings, "sectionPermissions");
  const effective = effectiveCapabilities(member, { sectionGrid });
  const partner = isPartner(member);
  const primaryOwner = member.role === "OWNER" && !partner;
  const defaults = new Set<Capability>(RANK_DEFAULTS[member.role]);
  const added = new Set<Capability>((member.capabilities ?? []).filter(isCapability));
  const removed = new Set<Capability>((member.revokedCapabilities ?? []).filter(isCapability));

  const basisOf = (capability: Capability, held: boolean): CapabilityExplanation["basis"] => {
    if (member.role === "GUEST") return "guest";
    if (primaryOwner) return "owner";
    if (member.spaceOnly && SPACE_ONLY_WITHHELD.includes(capability)) return "space_only";
    if (!partner && OWNER_ONLY.includes(capability)) return "owner_only";
    if (!sectionGrid && isGridBox(capability)) return "grid_off";
    if (held) return partner ? "owner" : defaults.has(capability) ? "rank_default" : "added";
    // the rank (or the owner's hand) would have given it: a partner has everything by default
    const wouldHave = partner || defaults.has(capability) || added.has(capability);
    if (removed.has(capability) && wouldHave) return "removed";
    return wouldHave ? "needs_view" : "rank_lacks";
  };

  return CAPABILITIES.map((capability) => {
    const held = effective.has(capability);
    const basis = basisOf(capability, held);
    const feature = CAPABILITY_FEATURE[capability];
    const featureOff = feature !== undefined && !featureOn(settings, feature);
    const usable = held && !featureOff;
    return {
      capability,
      held,
      usable,
      basis,
      reason: held && featureOff ? "feature_off" : basis,
      ...(feature ? { feature } : {}),
    };
  });
}

export type GrantProblem = "unknown_capability" | "owner_only" | "not_for_guests" | "owner_has_all";

/**
 * Why this capability may not be switched on for a person with this role (null = fine). A partner (`partner`: an OWNER
 * who is not the primary owner) can hold or lose any capability, the owner-only ones included.
 */
export function grantProblem(role: OrgRole, capability: string, partner = false): GrantProblem | null {
  if (!isCapability(capability)) return "unknown_capability";
  if (role === "OWNER") return partner ? null : "owner_has_all";
  if (OWNER_ONLY.includes(capability)) return "owner_only";
  if (role === "GUEST") return "not_for_guests";
  return null;
}
