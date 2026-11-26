import type { OrgRole, Prisma } from "@prisma/client";
import { featureOn } from "@/lib/features";
import { db } from "@/server/db";

/**
 * «كل واحد بيشوف مهامه بس» (the switch `assignedTasksOnly`, ask 4 of the owner's tasks prompt, 2026-11-25).
 *
 * ON: a task is seen by the people it is ASSIGNED to (and the one asked to take it, until they answer) and by the company's
 * OWNER and ADMINs. Not by whoever made it, not by the space's supervisor, not up the reporting line: the owner chose that.
 * A project is seen by whoever holds a task in it; one with no task yet stays with whoever made it.
 *
 * The rule itself is applied in `team-scope.ts` (lists and single rows) and `auth.ts` (the doors: 403). This file says WHO is
 * held to it and what «holding a task» means. It only ever TAKES sight away: the private-task rule still applies on top.
 */

/** Is a person of this rank, in a company with these settings, held to «their own tasks only»? */
export function seesAssignedOnly(role: OrgRole | null | undefined, orgSettings: unknown): boolean {
  return role !== "OWNER" && role !== "ADMIN" && featureOn(orgSettings, "assignedTasksOnly");
}

/** The ways a task is somebody's: its first person, one of the people beside, or the one asked to take it (still waiting). */
export function heldBy(userId: string): Prisma.TaskWhereInput[] {
  return [{ assigneeId: userId }, { coAssignees: { some: { userId } } }, { assignRequests: { some: { toUserId: userId, status: "PENDING" } } }];
}

/** The projects a restricted person sees: where they hold a task, and their own while it has no task yet. */
export function heldProjects(userId: string): Prisma.ProjectWhereInput[] {
  return [{ tasks: { some: { OR: heldBy(userId) } } }, { createdById: userId, tasks: { none: {} } }];
}

type Client = Pick<Prisma.TransactionClient, "organization" | "organizationMember">;

/** Is this person held to the rule in this company? */
export async function assignedOnlyInCompany(userId: string, orgId: string, client: Client = db): Promise<boolean> {
  const org = await client.organization.findUnique({ where: { id: orgId }, select: { settings: true } });
  if (!featureOn(org?.settings, "assignedTasksOnly")) return false;
  const member = await client.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId } }, select: { role: true } }); // all-statuses: only the rank is read; who is still IN is decided by the door before this
  return seesAssignedOnly(member?.role, org?.settings);
}

/** The same, for the company that owns a space. */
export async function assignedOnlyInSpace(userId: string, workspaceId: string): Promise<boolean> {
  const space = await db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } });
  return space ? assignedOnlyInCompany(userId, space.organizationId) : false;
}

/**
 * Of these people, the ones who may be told about this task (its words go into a notification): everybody who is not held to
 * the rule, and of those who are, the ones who hold the task.
 */
export async function mayHearOfTask(userIds: readonly string[], taskId: string): Promise<string[]> {
  if (userIds.length === 0) return [];
  // task-visibility: reads only WHO holds the task, to decide who may be told; no field of it leaves this function
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      orgId: true,
      assigneeId: true,
      coAssignees: { select: { userId: true } },
      assignRequests: { where: { status: "PENDING" }, select: { toUserId: true } },
      organization: { select: { settings: true } },
    },
  });
  if (!task || !featureOn(task.organization.settings, "assignedTasksOnly")) return [...userIds];
  const holders = new Set([task.assigneeId, ...task.coAssignees.map((c) => c.userId), ...task.assignRequests.map((r) => r.toUserId)]);
  const members = await db.organizationMember.findMany({ where: { organizationId: task.orgId, userId: { in: [...userIds] } }, select: { userId: true, role: true } }); // all-statuses: only the rank is read; who is still IN is decided by the sender
  const rank = new Map(members.map((m) => [m.userId, m.role]));
  return userIds.filter((id) => holders.has(id) || !seesAssignedOnly(rank.get(id), task.organization.settings));
}
