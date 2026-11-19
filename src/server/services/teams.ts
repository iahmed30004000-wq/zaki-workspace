import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, type OrgAccessContext } from "@/server/auth";

/**
 * TEAMS INSIDE A SPACE — who is in which team, and which project belongs to which (the reading rule is in
 * team-scope.ts). Only a space manager changes anything here (the OWNER, the space's ADMIN, an org ADMIN in
 * the space: `ctx.spaceManager` from `requireWorkspace`); the routes check it before calling.
 *
 *   - a team's name is unique in its space (checked under the space's lock);
 *   - only people with a row in the space (and ACTIVE in the company) may join one of its teams;
 *   - a team with work in it (a project, a chat topic) is not deleted: its work would silently become the whole
 *     space's (409 `teams.not_empty`);
 *   - leaving a team hands back the open tasks one held in that team's projects (they are unassigned, and the
 *     audit log says so): somebody who can no longer see the work must not keep it.
 */

export class TeamConflictError extends Error {
  constructor(message: "teams.not_empty" | "teams.name_taken") {
    super(message);
    this.name = "TeamConflictError";
  }
}

export interface TeamDTO {
  id: string;
  name: string;
  description: string | null;
  leadId: string | null;
  position: number;
  members: { id: string; name: string }[];
  projects: number;
  mine: boolean;
}

/**
 * The teams of a space as this person reads them: a manager sees every team; anybody else only the teams they
 * are in (the names of the others are not theirs to know).
 */
export async function listTeams(ctx: Pick<OrgAccessContext, "userId" | "spaceManager">, workspaceId: string): Promise<TeamDTO[]> {
  const rows = await db.team.findMany({
    where: { workspaceId, ...(ctx.spaceManager ? {} : { members: { some: { userId: ctx.userId } } }) },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      leadId: true,
      position: true,
      members: { select: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } },
      _count: { select: { projects: true } },
    },
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    leadId: t.leadId,
    position: t.position,
    members: t.members.map((m) => m.user),
    projects: t._count.projects,
    mine: t.members.some((m) => m.user.id === ctx.userId),
  }));
}

function assertManager(ctx: Pick<OrgAccessContext, "spaceManager">): void {
  if (!ctx.spaceManager) throw new ForbiddenError("ws.admin_only");
}

/** The people of the space who are ACTIVE in the company: the only ones a team may hold. */
async function eligible(tx: Pick<typeof db, "workspaceMember" | "workspace">, workspaceId: string, userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const ws = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } });
  if (!ws) return new Set();
  const rows = await tx.workspaceMember.findMany({
    where: { workspaceId, userId: { in: userIds }, user: { memberships: { some: { organizationId: ws.organizationId, status: "ACTIVE" } } } },
    select: { userId: true },
  });
  return new Set(rows.map((r) => r.userId));
}

export async function createTeam(
  ctx: Pick<OrgAccessContext, "userId" | "orgId" | "spaceManager">,
  workspaceId: string,
  input: { name: string; description?: string | null; memberIds?: string[] },
): Promise<{ id: string }> {
  assertManager(ctx);
  const name = input.name.trim();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${workspaceId} FOR UPDATE`;
    const taken = await tx.team.findFirst({ where: { workspaceId, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
    if (taken) throw new TeamConflictError("teams.name_taken");
    const ids = [...new Set(input.memberIds ?? [])];
    const ok = await eligible(tx, workspaceId, ids);
    if (ids.some((id) => !ok.has(id))) throw new ForbiddenError("teams.member_not_in_space");
    const last = await tx.team.findFirst({ where: { workspaceId }, orderBy: { position: "desc" }, select: { position: true } });
    const team = await tx.team.create({
      data: { workspaceId, name, description: input.description ?? null, position: (last?.position ?? -1) + 1 },
      select: { id: true },
    });
    if (ids.length) await tx.teamMember.createMany({ data: ids.map((userId) => ({ teamId: team.id, userId })), skipDuplicates: true });
    await tx.auditLog.create({ data: { action: "team.created", actorId: ctx.userId, orgId: ctx.orgId, target: team.id, workspaceId, meta: { name } } });
    return team;
  });
}

async function teamOf(teamId: string, workspaceId: string) {
  const team = await db.team.findFirst({ where: { id: teamId, workspaceId }, select: { id: true, name: true } });
  if (!team) throw new NotFoundError("teams.not_found");
  return team;
}

export async function updateTeam(
  ctx: Pick<OrgAccessContext, "userId" | "orgId" | "spaceManager">,
  workspaceId: string,
  teamId: string,
  input: { name?: string; description?: string | null; leadId?: string | null },
): Promise<void> {
  assertManager(ctx);
  await teamOf(teamId, workspaceId);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${workspaceId} FOR UPDATE`;
    const name = input.name?.trim();
    if (name) {
      const taken = await tx.team.findFirst({ where: { workspaceId, id: { not: teamId }, name: { equals: name, mode: "insensitive" } }, select: { id: true } });
      if (taken) throw new TeamConflictError("teams.name_taken");
    }
    if (input.leadId) {
      const inTeam = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId, userId: input.leadId } }, select: { id: true } });
      if (!inTeam) throw new ForbiddenError("teams.lead_not_member");
      // «قائد الفرقة» reads as the lead on «لوحة الفريق»: somebody suspended or offboarded (still a row of the team) is not made one
      const active = await tx.organizationMember.findFirst({
        where: { organizationId: ctx.orgId, userId: input.leadId, status: "ACTIVE" },
        select: { userId: true },
      });
      if (!active) throw new ForbiddenError("teams.lead_not_active");
    }
    await tx.team.update({
      where: { id: teamId },
      data: {
        ...(name ? { name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.leadId !== undefined ? { leadId: input.leadId } : {}),
      },
    });
    await tx.auditLog.create({ data: { action: "team.updated", actorId: ctx.userId, orgId: ctx.orgId, target: teamId, workspaceId } });
  });
}

export async function deleteTeam(ctx: Pick<OrgAccessContext, "userId" | "orgId" | "spaceManager">, workspaceId: string, teamId: string): Promise<void> {
  assertManager(ctx);
  await teamOf(teamId, workspaceId);
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`;
    const [projects, topics] = await Promise.all([tx.project.count({ where: { teamId } }), tx.conversation.count({ where: { teamId } })]);
    if (projects + topics > 0) throw new TeamConflictError("teams.not_empty");
    await tx.team.delete({ where: { id: teamId } });
    await tx.auditLog.create({ data: { action: "team.deleted", actorId: ctx.userId, orgId: ctx.orgId, target: teamId, workspaceId } });
  });
}

/** Adds and removes people. Somebody who leaves hands back the open tasks they held in the team's projects. */
export async function setTeamMembers(
  ctx: Pick<OrgAccessContext, "userId" | "orgId" | "spaceManager">,
  workspaceId: string,
  teamId: string,
  changes: { add?: string[]; remove?: string[] },
): Promise<{ added: string[]; removed: string[]; unassigned: number }> {
  assertManager(ctx);
  await teamOf(teamId, workspaceId);
  const add = [...new Set(changes.add ?? [])];
  const remove = [...new Set(changes.remove ?? [])].filter((id) => !add.includes(id));
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${teamId} FOR UPDATE`;
    const ok = await eligible(tx, workspaceId, add);
    if (add.some((id) => !ok.has(id))) throw new ForbiddenError("teams.member_not_in_space");
    const before = new Set((await tx.teamMember.findMany({ where: { teamId }, select: { userId: true } })).map((r) => r.userId));
    const added = add.filter((id) => !before.has(id));
    const removed = remove.filter((id) => before.has(id));
    if (added.length) await tx.teamMember.createMany({ data: added.map((userId) => ({ teamId, userId })), skipDuplicates: true });
    let unassigned = 0;
    if (removed.length) {
      await tx.teamMember.deleteMany({ where: { teamId, userId: { in: removed } } });
      await tx.team.updateMany({ where: { id: teamId, leadId: { in: removed } }, data: { leadId: null } });
      const freed = await tx.task.updateMany({
        where: { project: { teamId }, assigneeId: { in: removed }, completedAt: null, archived: false },
        data: { assigneeId: null },
      });
      // «لمين» with more than one person: leaving the team also drops the person from the tasks they merely
      // shared, or they would keep work in a project they no longer see (the primary ones are freed above)
      await tx.taskCoAssignee.deleteMany({
        where: { userId: { in: removed }, task: { project: { teamId }, completedAt: null, archived: false } },
      });
      unassigned = freed.count;
    }
    await tx.auditLog.create({
      data: { action: "team.members_updated", actorId: ctx.userId, orgId: ctx.orgId, target: teamId, workspaceId, meta: { added, removed, unassigned } },
    });
    return { added, removed, unassigned };
  });
}

/**
 * Puts a project in a team of its space, or back in the space as a whole (`teamId: null`). Managers only:
 * moving a project changes who sees it.
 */
export async function moveProjectToTeam(
  ctx: Pick<OrgAccessContext, "userId" | "orgId" | "spaceManager">,
  project: { id: string; workspaceId: string },
  teamId: string | null,
): Promise<void> {
  assertManager(ctx);
  if (teamId) await teamOf(teamId, project.workspaceId);
  await db.project.update({ where: { id: project.id }, data: { teamId } });
  await db.auditLog.create({
    data: { action: "project.team_changed", actorId: ctx.userId, orgId: ctx.orgId, target: project.id, workspaceId: project.workspaceId, meta: { teamId } },
  });
}

/**
 * May this person open a project in this team (when creating one)? A manager anywhere in the space; anybody
 * else only in a team they are in. `null` (the space as a whole) is open to everybody who may write there.
 */
export async function assertMayCreateInTeam(
  ctx: Pick<OrgAccessContext, "userId" | "spaceManager">,
  workspaceId: string,
  teamId: string | null | undefined,
): Promise<void> {
  if (!teamId) return;
  await teamOf(teamId, workspaceId);
  if (ctx.spaceManager) return;
  const row = await db.teamMember.findUnique({ where: { teamId_userId: { teamId, userId: ctx.userId } }, select: { id: true } });
  if (!row) throw new ForbiddenError("teams.not_member");
}
