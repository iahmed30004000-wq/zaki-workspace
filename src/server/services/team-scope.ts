import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { isSpaceManager } from "@/server/workspace-role";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { loadReportIds } from "@/server/services/reporting-line";

/**
 * TEAMS INSIDE A SPACE — the one place that says which projects and tasks a person may see.
 *
 * The owner's decision (2026-10-25, «اعزل كل مساحة عمل»): a space can be split into teams, each with its own
 * projects (and chat topics). Inside such a space a person sees
 *   - the space's own work: projects with no team, and their tasks;
 *   - the work of the teams they are in;
 *   - everything, if they manage the space (`isSpaceManager`: the org OWNER, the space's ADMIN, an org ADMIN
 *     who is in it).
 * A space with NO team is unchanged: everybody in it sees all of it, exactly as before teams existed.
 *
 * Every list reads through `projectVisibleWhere` / `taskVisibleWhere`; every single row through
 * `canSeeProject` / `canSeeTask` (or `requireProjectAccess` / `requireTaskAccess` in src/server/auth.ts). A miss is "not
 * found", never "forbidden", so a link to another team's work does not even say it exists.
 *
 * A TASK can also be private to the people it concerns (`Task.visibility = "PARTICIPANTS"`, «المعنيين بس»): then, on
 * top of the space and the team, only its creator, its assignees, their managers up the reporting line, the managers
 * of its space, and whoever holds silent oversight (`archive.view`) see it. A raw-SQL reader uses `taskVisibleSql`.
 */

/** The two values of `Task.visibility`. */
export const TASK_VISIBILITY = ["SPACE", "PARTICIPANTS"] as const;
export type TaskVisibility = (typeof TASK_VISIBILITY)[number];
export const isTaskVisibility = (v: unknown): v is TaskVisibility => (TASK_VISIBILITY as readonly string[]).includes(v as string);

export interface WorkScope {
  /** Spaces whose every project the person sees (they manage it, or it has no team at all). */
  full: ReadonlySet<string>;
  /** Spaces the person is in that have teams they do not manage: only the space's own work and their teams'. */
  partial: ReadonlySet<string>;
  /** The person's teams inside the `partial` spaces. */
  teamIds: ReadonlySet<string>;
  /** Who is asking: a private task is theirs when they made it or are assigned to it. */
  userId: string;
  /**
   * The spaces the person manages (the space's ADMIN, an org ADMIN who is in it — and the OWNER RANK only where he
   * holds oversight or has an ADMIN row: the rank alone reads nothing private, P0.1): they read the space's private tasks.
   */
  managedSpaces: ReadonlySet<string>;
  /** Everybody below the person in the reporting line: their private tasks are read by the person too. */
  reportIds: ReadonlySet<string>;
  /** Spaces of the companies where the person holds silent oversight (`archive.view`): every task, private ones included. */
  oversightSpaces: ReadonlySet<string>;
}

/** Everything a person may open, with the teams taken into account. Three queries. */
export async function loadWorkScope(userId: string): Promise<WorkScope> {
  const memberships = await db.organizationMember.findMany({
    where: { userId, status: "ACTIVE" },
    select: { role: true, organizationId: true, capabilities: true, revokedCapabilities: true, primaryOwner: true },
  });
  const full = new Set<string>();
  const partial = new Set<string>();
  const teamIds = new Set<string>();
  const managedSpaces = new Set<string>();
  const oversightSpaces = new Set<string>();
  if (memberships.length === 0) return { full, partial, teamIds, userId, managedSpaces, reportIds: new Set<string>(), oversightSpaces };

  const orgRole = new Map(memberships.map((m) => [m.organizationId, m.role]));
  // silent oversight is the capability archive.view, held by an OWNER-rank person only (P0.1: the rank alone is not enough)
  const oversightOrgs = new Set(memberships.filter((m) => m.role === "OWNER" && effectiveCapabilities(m).has("archive.view")).map((m) => m.organizationId));
  const ownedOrgIds = memberships.filter((m) => m.role === "OWNER").map((m) => m.organizationId);
  const [owned, rows, reportIds] = await Promise.all([
    ownedOrgIds.length ? db.workspace.findMany({ where: { organizationId: { in: ownedOrgIds } }, select: { id: true, organizationId: true } }) : Promise.resolve([]),
    db.workspaceMember.findMany({
      where: { userId, workspace: { organizationId: { in: [...orgRole.keys()] } } },
      select: { workspaceId: true, role: true, workspace: { select: { organizationId: true } } },
    }),
    loadReportIds(userId),
  ]);
  for (const w of owned) {
    full.add(w.id);
    if (oversightOrgs.has(w.organizationId)) {
      oversightSpaces.add(w.id);
      managedSpaces.add(w.id);
    }
  }
  // an explicit space-ADMIN row (or an org ADMIN who is in the space) manages it, whatever the rank
  for (const row of rows) {
    const rank = orgRole.get(row.workspace.organizationId);
    if (rank !== "OWNER" && isSpaceManager(rank, row.role)) managedSpaces.add(row.workspaceId);
    else if (rank === "OWNER" && row.role === "ADMIN") managedSpaces.add(row.workspaceId);
  }

  const candidates: string[] = [];
  for (const row of rows) {
    if (full.has(row.workspaceId)) continue;
    if (isSpaceManager(orgRole.get(row.workspace.organizationId), row.role)) full.add(row.workspaceId);
    else candidates.push(row.workspaceId);
  }
  if (candidates.length) {
    const teams = await db.team.findMany({
      where: { workspaceId: { in: candidates } },
      select: { id: true, workspaceId: true, members: { where: { userId }, select: { id: true } } },
    });
    const withTeams = new Set(teams.map((t) => t.workspaceId));
    for (const id of candidates) (withTeams.has(id) ? partial : full).add(id);
    for (const t of teams) if (t.members.length) teamIds.add(t.id);
  }
  return { full, partial, teamIds, userId, managedSpaces, reportIds, oversightSpaces };
}

/**
 * The scope inside ONE space: the space the person is in (src/server/services/current-space.ts). Lists read
 * through it so another space's work never shows; a space outside the scope leaves nothing.
 */
export function narrowScope(scope: WorkScope, spaceId: string | null | undefined): WorkScope {
  const only = (ids: ReadonlySet<string>) => new Set(spaceId && ids.has(spaceId) ? [spaceId] : []);
  return { ...scope, full: only(scope.full), partial: only(scope.partial), managedSpaces: only(scope.managedSpaces), oversightSpaces: only(scope.oversightSpaces) };
}

/** Every space id of the scope (what `accessibleWorkspaceIds` answers). */
export function scopeSpaceIds(scope: WorkScope): string[] {
  return [...scope.full, ...scope.partial];
}

/** Projects the person may see. An empty scope matches nothing. */
export function projectVisibleWhere(scope: WorkScope): Prisma.ProjectWhereInput {
  const or: Prisma.ProjectWhereInput[] = [];
  if (scope.full.size) or.push({ workspaceId: { in: [...scope.full] } });
  if (scope.partial.size) {
    or.push({ workspaceId: { in: [...scope.partial] }, OR: [{ teamId: null }, ...(scope.teamIds.size ? [{ teamId: { in: [...scope.teamIds] } }] : [])] });
  }
  return or.length ? { OR: or } : { id: { in: [] } };
}

/**
 * Tasks the person may see: the task's space and its project's team, AND — for a private task («المعنيين بس») — being
 * one of the people it concerns (the participants rule below).
 */
export function taskVisibleWhere(scope: WorkScope): Prisma.TaskWhereInput {
  const or: Prisma.TaskWhereInput[] = [];
  if (scope.full.size) or.push({ workspaceId: { in: [...scope.full] } });
  if (scope.partial.size) {
    or.push({
      workspaceId: { in: [...scope.partial] },
      project: { OR: [{ teamId: null }, ...(scope.teamIds.size ? [{ teamId: { in: [...scope.teamIds] } }] : [])] },
    });
  }
  if (!or.length) return { id: { in: [] } };
  return { AND: [{ OR: or }, taskParticipantWhere(scope)] };
}

/** The participants rule alone: a public task, or one the person is a participant of (or manages, or oversees). */
export function taskParticipantWhere(scope: WorkScope): Prisma.TaskWhereInput {
  const reports = [...scope.reportIds];
  const or: Prisma.TaskWhereInput[] = [
    { visibility: "SPACE" },
    { creatorId: scope.userId },
    { assigneeId: scope.userId },
    { coAssignees: { some: { userId: scope.userId } } },
  ];
  if (scope.managedSpaces.size) or.push({ workspaceId: { in: [...scope.managedSpaces] } });
  if (scope.oversightSpaces.size) or.push({ workspaceId: { in: [...scope.oversightSpaces] } });
  if (reports.length) or.push({ assigneeId: { in: reports } }, { coAssignees: { some: { userId: { in: reports } } } });
  return { OR: or };
}

/** The participants rule for a caller that has only the person's id (a few queries: use `loadWorkScope` once when several readers share a request). */
export async function taskParticipantFilter(userId: string): Promise<Prisma.TaskWhereInput> {
  return taskParticipantWhere(await loadWorkScope(userId));
}

/** One task row against the scope (the same rule as `taskVisibleWhere`, for a row already loaded). */
export function canSeeTask(
  scope: WorkScope,
  task: { workspaceId: string; teamId: string | null; visibility: string; creatorId: string; assigneeId: string | null; coAssigneeIds?: readonly string[] },
): boolean {
  const inSpace = scope.full.has(task.workspaceId) || (scope.partial.has(task.workspaceId) && (task.teamId === null || scope.teamIds.has(task.teamId)));
  if (!inSpace) return false;
  return canSeeTaskParticipants(scope, task);
}

/** Only the participants half (when the space and team were already checked, as `requireTaskAccess` does). */
export function canSeeTaskParticipants(
  scope: WorkScope,
  task: { workspaceId: string; visibility: string; creatorId: string; assigneeId: string | null; coAssigneeIds?: readonly string[] },
): boolean {
  if (task.visibility !== "PARTICIPANTS") return true;
  const me = scope.userId;
  if (task.creatorId === me || task.assigneeId === me) return true;
  const co = task.coAssigneeIds ?? [];
  if (co.includes(me)) return true;
  if (scope.managedSpaces.has(task.workspaceId) || scope.oversightSpaces.has(task.workspaceId)) return true;
  if (task.assigneeId && scope.reportIds.has(task.assigneeId)) return true;
  return co.some((id) => scope.reportIds.has(id));
}

/**
 * The participants rule as a SQL fragment for a raw query on "Task" aliased `alias` (the space and team part stays the
 * caller's, as it always was; this adds the participants part). Ids go in as parameters, never as text.
 */
export function taskVisibleSql(scope: WorkScope, alias = "t"): Prisma.Sql {
  const a = Prisma.raw(`"${alias.replace(/[^A-Za-z0-9_]/g, "")}"`);
  const reports = [...scope.reportIds];
  const managed = [...scope.managedSpaces, ...scope.oversightSpaces];
  return Prisma.sql`(${a}."visibility" = 'SPACE'
    OR ${a}."creatorId" = ${scope.userId}
    OR ${a}."assigneeId" = ${scope.userId}
    OR EXISTS (SELECT 1 FROM "TaskCoAssignee" ca WHERE ca."taskId" = ${a}."id" AND ca."userId" = ${scope.userId})
    OR ${a}."workspaceId" = ANY(${managed}::text[])
    OR ${a}."assigneeId" = ANY(${reports}::text[])
    OR EXISTS (SELECT 1 FROM "TaskCoAssignee" cb WHERE cb."taskId" = ${a}."id" AND cb."userId" = ANY(${reports}::text[])))`;
}

/** One project (or anything that hangs off one) against the scope. */
export function canSeeProject(scope: WorkScope, project: { workspaceId: string; teamId: string | null }): boolean {
  if (scope.full.has(project.workspaceId)) return true;
  if (!scope.partial.has(project.workspaceId)) return false;
  return project.teamId === null || scope.teamIds.has(project.teamId);
}

/**
 * One team-bound item for a person who already passed the space guard: they see it if it has no team, if
 * they manage the space, or if they are in the team. One query at most.
 */
export async function seesTeam(userId: string, teamId: string | null, manager: boolean): Promise<boolean> {
  if (!teamId || manager) return true;
  const row = await db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId } }, select: { id: true } });
  return !!row;
}

/**
 * Inside ONE space the caller already passed the guard for: the projects they see there. A manager sees all
 * (`{}`); anybody else the space's own projects (no team) and their teams'. Use it as a `project` filter.
 */
export async function teamFilterInSpace(userId: string, workspaceId: string, manager: boolean): Promise<Prisma.ProjectWhereInput> {
  if (manager) return {};
  const mine = await db.teamMember.findMany({ where: { userId, team: { workspaceId } }, select: { teamId: true } });
  return { OR: [{ teamId: null }, ...(mine.length ? [{ teamId: { in: mine.map((m) => m.teamId) } }] : [])] };
}

/**
 * Does this person see this project (for a service that has only the person's id: creating a task, converting
 * an idea)? The space must be theirs (or their company's, for the OWNER), then the team. A few queries.
 */
export async function userSeesProject(userId: string, project: { workspaceId: string; teamId: string | null }): Promise<boolean> {
  const ws = await db.workspace.findUnique({ where: { id: project.workspaceId }, select: { organizationId: true } });
  if (!ws) return false;
  const [om, row] = await Promise.all([
    db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: ws.organizationId, userId } }, select: { role: true, status: true } }),
    db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: project.workspaceId, userId } }, select: { role: true } }),
  ]);
  if (!om || om.status !== "ACTIVE") return false;
  if (om.role !== "OWNER" && !row) return false;
  return seesTeam(userId, project.teamId, isSpaceManager(om.role, row?.role));
}
