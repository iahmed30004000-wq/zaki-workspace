import type { OrgRole } from "@prisma/client";

/**
 * Capabilities: what a person may do ON TOP of their rank. The rank gives a sensible default set;
 * the owner switches single capabilities on or off for a person instead of inventing new ranks.
 * Stored per member in `capabilities` (extra) and `revokedCapabilities` (taken away).
 */
export const CAPABILITIES = [
  "spaces.create", // open a new space and choose its people
  "users.manage", // create accounts, suspend, offboard, reset passwords
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
  "prices.view",
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


export interface CapabilitySource {
  role: OrgRole;
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
