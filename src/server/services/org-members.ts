import type { MemberStatus, OrgRole, Prisma, TicketStatus, WorkspaceRole } from "@prisma/client";
import { db } from "@/server/db";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { sectionGridOn } from "@/server/policy/section-grid";
import { RANK } from "@/server/policy/rank";
import type { Actor } from "@/server/policy/actor";
import { accessibleWorkspaceIds } from "@/server/services/access";
import { inCatalogueOrder } from "@/server/services/member-rules";
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
