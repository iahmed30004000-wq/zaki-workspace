import type { MemberStatus, OrgRole, Prisma, TicketStatus, WorkspaceRole } from "@prisma/client";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, ValidationError, audit } from "@/server/auth";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { sectionGridOn } from "@/server/policy/section-grid";
import { RANK } from "@/server/policy/rank";
import type { Actor } from "@/server/policy/actor";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { inCatalogueOrder } from "@/server/services/member-rules";
import { assertFeatureOn, orgSummaryOf } from "@/server/services/features";
import { featureOn } from "@/lib/features";
import { appliedTemplateOf, roleTemplatesOf, templateStateOf, type AppliedTemplate, type MemberTemplate } from "@/lib/permission-templates";
import { taskParticipantFilter } from "@/server/services/team-scope";

/**
 * Organization members: the rank rules of account management and the roster.
 *
 * The rules are pure functions kept in member-rules.ts (no database, so the members screen can
 * import the very same rules) and re-exported here; tests/org-members-logic.test.ts proves them as
 * a matrix. The account lifecycle that applies them is accounts.ts.
 */
export {
  ASSIGNABLE_ROLES,
  STATUS_TRANSITIONS,
  canAdministratePerson,
  canAdministrateTarget,
  canChangeRole,
  canChangeRoleOf,
  canRemoveMember,
  canTransitionStatus,
  capabilityChangeProblem,
  grantableRoles,
  grantableRolesFor,
  inCatalogueOrder,
  isPartner,
  replaceCapabilityList,
  unheldRankDefaults,
  wouldCreateManagerCycle,
  type CapabilityHolder,
  type RankedPerson,
  type StatusAction,
} from "@/server/services/member-rules";

// ---------- open work ----------

/**
 * What "open work" is — the work assigned to a person (`assigneeId`) that still needs doing. The
 * roster's `openWork` count and the offboarding transfer use these same definitions. (Task,
 * Ticket and Routine are the only models with an assignee; campaign and opportunity owners are
 * their creators and stay as they are.)
 */
export const OPEN_TICKET_STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS"];

export function openTaskWhere(orgId: string): Prisma.TaskWhereInput {
  return { orgId, completedAt: null, archived: false };
}

export function openTicketWhere(orgId: string): Prisma.TicketWhereInput {
  return { orgId, status: { in: OPEN_TICKET_STATUSES } };
}

export function activeRoutineWhere(orgId: string): Prisma.RoutineWhereInput {
  return { orgId, active: true };
}

// ---------- the roster ----------

export interface RosterMember {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  jobTitle: string | null;
  role: OrgRole;
  status: MemberStatus;
  managerId: string | null;
  managerName: string | null;
  capabilities: string[];
  revokedCapabilities: string[];
  /** An OWNER who is the company's primary owner (false for a partner and for everybody else). */
  primaryOwner: boolean;
  effectiveCapabilities: string[];
  lastLoginAt: Date | null;
  mustChangePassword: boolean;
  /** `/api/avatars/<id>` — the picture the person uploaded, or null for the initials (the owner, 2026-10-29). */
  avatarUrl: string | null;
  /** Open tasks + open tickets + active routines assigned to the person (offboarding needs a receiver when > 0). */
  openWork: number;
  /** The person's spaces in this organization — only those the caller may see themselves. */
  workspaces: { id: string; name: string; role: WorkspaceRole }[];
  /**
   * A1.1 (switch `permissionTemplates`): the template the person was last given — «القالب: X» — and whether they were changed by hand since
   * («معدّل»). Absent while the switch is off or nobody gave them one.
   */
  template?: MemberTemplate;
  /**
   * «إشارة التوثيق» (S5.5, switch `verifiedBadge`): `true` only when the OWNER gave the person the check badge (absent otherwise, like every `verified` of the chat DTOs), never the time and never
   * who granted it. ABSENT while the company's switch is off: the card then draws no badge. (The card's own control asks the verify door for the person's state.)
   */
  verified?: boolean;
}

export interface Roster {
  members: RosterMember[];
  actorRole: OrgRole;
  /** The caller is the company's primary owner (he alone makes or unmakes a partner). */
  actorPrimaryOwner: boolean;
  /** «صلاحيات الأقسام» is on in «الميزات»: the sheet shows the section grid (off: the customers' two switches instead). */
  sectionGrid: boolean;
  /** The spaces the caller may put people into: every space for the OWNER, otherwise their own. */
  spaces: { id: string; name: string }[];
}

/** The template each person was LAST given: the newest `org.template_applied` audit row about them. */
async function lastAppliedTemplates(orgId: string, userIds: readonly string[]): Promise<Map<string, AppliedTemplate>> {
  const rows = await db.auditLog.findMany({
    where: { orgId, action: "org.template_applied", target: { in: [...userIds] } },
    orderBy: { createdAt: "desc" },
    distinct: ["target"],
    select: { target: true, meta: true },
  });
  const out = new Map<string, AppliedTemplate>();
  for (const row of rows) {
    const applied = row.target ? appliedTemplateOf(row.meta) : null;
    if (row.target && applied && !out.has(row.target)) out.set(row.target, applied);
  }
  return out;
}

function templateOf(
  userId: string,
  member: { role: OrgRole; capabilities: string[]; revokedCapabilities: string[] },
  applied: ReadonlyMap<string, AppliedTemplate>,
  names: ReadonlyMap<string, string>,
): { template?: MemberTemplate } {
  const a = applied.get(userId);
  if (!a) return {};
  const state = templateStateOf(a, member);
  return { template: { ...state, name: names.get(a.templateId) ?? state.name } };
}

const STATUS_ORDER: Record<MemberStatus, number> = { ACTIVE: 0, SUSPENDED: 1, OFFBOARDED: 2 };

/**
 * Everybody in the caller's organization, every status: ACTIVE first, then SUSPENDED, then
 * OFFBOARDED; inside each, the highest rank first, then by name. Never a password hash or a
 * session version (fields are selected one by one).
 */
export async function listOrgMembers(actor: Pick<Actor, "userId" | "orgId" | "role" | "isOwner" | "isPrimaryOwner">): Promise<Roster> {
  const orgId = actor.orgId;
  const sectionGrid = await sectionGridOn(orgId);
  const rows = await db.organizationMember.findMany({
    where: { organizationId: orgId },
    select: {
      role: true,
      status: true,
      capabilities: true,
      revokedCapabilities: true,
      primaryOwner: true,
      verifiedAt: true,
      managerId: true,
      manager: { select: { name: true } },
      user: {
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          jobTitle: true,
          lastLoginAt: true,
          mustChangePassword: true,
          avatarUrl: true,
        },
      },
    },
  });
  const ids = rows.map((r) => r.user.id);
  // A1.1: «القالب: X» only while the company's switch is on; the name is the template's own now (renamed since: the new name)
  const settings = (await orgSummaryOf(orgId))?.settings ?? {};
  const templatesOn = featureOn(settings, "permissionTemplates");
  const verifiedOn = featureOn(settings, "verifiedBadge");
  const applied = templatesOn ? await lastAppliedTemplates(orgId, ids) : new Map<string, AppliedTemplate>();
  const templateNames = templatesOn ? new Map(roleTemplatesOf(settings).map((t) => [t.id, t.name])) : new Map<string, string>();
  // the open-work counts the roster shows never count a private task the person asking may not see
  const visibleTasks = await taskParticipantFilter(actor.userId);

  const [tasks, tickets, routines, coTasks, links, orgSpaces, mine] = await Promise.all([
    db.task.groupBy({ by: ["assigneeId"], where: { ...openTaskWhere(orgId), assigneeId: { in: ids }, AND: [visibleTasks] }, _count: { _all: true } }),
    db.ticket.groupBy({ by: ["assigneeId"], where: { ...openTicketWhere(orgId), assigneeId: { in: ids } }, _count: { _all: true } }),
    db.routine.groupBy({ by: ["assigneeId"], where: { ...activeRoutineWhere(orgId), assigneeId: { in: ids } }, _count: { _all: true } }),
    // «لمين» with more than one person: the tasks a person holds beside their primary are theirs to count too
    db.taskCoAssignee.findMany({
      where: { userId: { in: ids }, task: { ...openTaskWhere(orgId), AND: [visibleTasks] } },
      select: { userId: true },
    }),
    db.workspaceMember.findMany({
      where: { userId: { in: ids }, workspace: { organizationId: orgId } },
      select: { userId: true, role: true, workspace: { select: { id: true, name: true } } },
      orderBy: { workspace: { name: "asc" } },
    }),
    db.workspace.findMany({ where: { organizationId: orgId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    actor.isOwner ? Promise.resolve(null) : accessibleWorkspaceIds(actor.userId),
  ]);

  const openWork = new Map<string, number>();
  for (const group of [tasks, tickets, routines]) {
    for (const g of group) {
      if (g.assigneeId) openWork.set(g.assigneeId, (openWork.get(g.assigneeId) ?? 0) + g._count._all);
    }
  }
  for (const row of coTasks) openWork.set(row.userId, (openWork.get(row.userId) ?? 0) + 1);
  const visible = mine === null ? null : new Set(mine);
  const spacesOf = new Map<string, RosterMember["workspaces"]>();
  for (const link of links) {
    if (visible && !visible.has(link.workspace.id)) continue;
    const list = spacesOf.get(link.userId) ?? [];
    list.push({ id: link.workspace.id, name: link.workspace.name, role: link.role });
    spacesOf.set(link.userId, list);
  }

  const members: RosterMember[] = rows.map((r) => ({
    id: r.user.id,
    name: r.user.name,
    username: r.user.username,
    email: r.user.email,
    jobTitle: r.user.jobTitle,
    role: r.role,
    status: r.status,
    managerId: r.managerId,
    managerName: r.manager?.name ?? null,
    capabilities: r.capabilities,
    revokedCapabilities: r.revokedCapabilities,
    primaryOwner: r.role === "OWNER" && r.primaryOwner,
    effectiveCapabilities: inCatalogueOrder(effectiveCapabilities(r, { sectionGrid })),
    lastLoginAt: r.user.lastLoginAt,
    mustChangePassword: r.user.mustChangePassword,
    avatarUrl: r.user.avatarUrl,
    openWork: openWork.get(r.user.id) ?? 0,
    workspaces: spacesOf.get(r.user.id) ?? [],
    ...templateOf(r.user.id, r, applied, templateNames),
    ...(verifiedOn && r.verifiedAt !== null ? { verified: true } : {}),
  }));
  members.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || RANK[b.role] - RANK[a.role] || a.name.localeCompare(b.name, "ar"),
  );

  return {
    members,
    actorRole: actor.role,
    actorPrimaryOwner: actor.isPrimaryOwner === true,
    sectionGrid,
    spaces: visible ? orgSpaces.filter((s) => visible.has(s.id)) : orgSpaces,
  };
}

// ---------- «إشارة التوثيق» (S5.5) ----------

/** Is this person verified? The OWNER only (the person's card asks it when it opens); the switch `verifiedBadge` off: «not found». */
export async function memberVerifiedState(actor: Pick<Actor, "orgId" | "isOwner">, userId: string): Promise<{ verified: boolean }> {
  if (!actor.isOwner) throw new ForbiddenError("verified.e.owner_only");
  await assertFeatureOn(actor.orgId, "verifiedBadge");
  // all-statuses: the owner reads (and may take back) the badge of anybody of his company, whatever their status
  const row = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: actor.orgId, userId } }, select: { verifiedAt: true } });
  if (!row) throw new NotFoundError("orgm.not_member");
  return { verified: row.verifiedAt !== null };
}

/**
 * The OWNER gives a person the check badge, or takes it back (`verified` false). The OWNER RANK decides (`actor.isOwner`): no capability an admin can hold opens this door.
 * The company's switch `verifiedBadge` must be on (off: «not found»; the stored grants stay). A guest (an external partner) is never verified, and a person who is not ACTIVE
 * is not given a first badge (taking one back works for anybody). Repeating what is already true changes nothing and writes no audit line; every real change is a line of the
 * audit log (who, whom, when): `org.member_verified` / `org.member_unverified`. Returns whether the person is verified after the call.
 */
export async function setMemberVerified(actor: Pick<Actor, "userId" | "orgId" | "isOwner">, userId: string, verified: boolean): Promise<{ verified: boolean; changed: boolean }> {
  if (!actor.isOwner) throw new ForbiddenError("verified.e.owner_only");
  await assertFeatureOn(actor.orgId, "verifiedBadge");
  const target = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: actor.orgId, userId } },
    select: { id: true, role: true, status: true, verifiedAt: true },
  });
  if (!target) throw new NotFoundError("orgm.not_member");
  if (verified) {
    if (target.role === "GUEST") throw new ValidationError([{ path: "userId", message: "verified.e.guest" }]);
    if (target.status !== "ACTIVE") throw new ValidationError([{ path: "userId", message: "verified.e.inactive" }]);
  }
  // one conditional write: two owners tapping at the same moment make ONE change and ONE audit line
  const res = await db.organizationMember.updateMany({
    where: { id: target.id, verifiedAt: verified ? null : { not: null } },
    data: { verifiedAt: verified ? new Date() : null },
  });
  if (res.count === 0) return { verified, changed: false };
  await audit(verified ? "org.member_verified" : "org.member_unverified", { actorId: actor.userId, orgId: actor.orgId, target: userId });
  return { verified, changed: true };
}
