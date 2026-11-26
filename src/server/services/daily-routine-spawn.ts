import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";
import { notifyAssignment } from "@/server/notify";
import { assertMemberCan, memberCan } from "@/server/policy/actor";
import { dispatchEvent } from "@/server/services/n8n";
import { judgeAssignment } from "@/server/services/task-assign";
import { userSeesProject } from "@/server/services/team-scope";
import { createTaskInTx, notifyCreatedRequests, type Tx } from "@/server/services/tasks";
import { afterTaskEvents } from "@/server/services/task-rules-hook";
import { zonedParts, zonedWallTime } from "@/lib/zoned-time";
import type { RoutineStopReason } from "@/lib/daily-routine";

/**
 * «روتين يومي» — how a routine's card of one day is born, and what stops a routine. The card is a REAL task made by
 * `createTaskInTx`, the same function a hand-made task goes through, on behalf of the routine's `createdById`.
 */

export interface RoutineRow {
  id: string;
  orgId: string;
  workspaceId: string;
  projectId: string;
  boardId: string;
  title: string;
  description: string | null;
  assigneeId: string;
  createdById: string;
  days: number[];
  time: string;
  dueTime: string;
  nextRunAt: Date | null;
}

type Client = Tx | PrismaClient | Prisma.TransactionClient;

/** Is the person an ACTIVE member of the company who is in the space (the OWNER rank needs no row to be handed a task)? */
async function holdsASeat(client: Client, orgId: string, workspaceId: string, userId: string, ownerNeedsRow: boolean): Promise<"inactive" | "outside" | "in"> {
  const member = await client.organizationMember.findFirst({ where: { organizationId: orgId, userId, status: "ACTIVE" }, select: { role: true } });
  if (!member) return "inactive";
  // oversight-ok: not a door: the question is only whether a routine may still run for this person
  if (member.role === "OWNER" && !ownerNeedsRow) return "in";
  const row = await client.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } }, select: { id: true } });
  return row ? "in" : "outside";
}

/** Why the routine can no longer go on, or null. */
export async function routineObstacle(tx: Tx, routine: RoutineRow): Promise<RoutineStopReason | null> {
  const maker = await holdsASeat(tx, routine.orgId, routine.workspaceId, routine.createdById, true);
  if (maker === "inactive") return "CREATOR_INACTIVE";
  const home = await tx.workspace.findUnique({
    where: { id: routine.workspaceId },
    select: { archivedAt: true, projects: { where: { id: routine.projectId }, select: { status: true, teamId: true, boards: { where: { id: routine.boardId }, select: { archived: true } } } } },
  });
  const project = home?.projects[0];
  const board = project?.boards[0];
  if (!home || home.archivedAt || !project || project.status === "ARCHIVED" || !board || board.archived) return "ARCHIVED";
  // a maker taken off the space, or who may no longer make tasks, makes nothing in it any more (and «تشغيل» hands the routine to whoever presses it)
  if (maker === "outside" || (await memberCan({ orgId: routine.orgId, userId: routine.createdById }, "tasks.edit", { spaceGuestsPass: true })) !== true) return "FAILED";
  if ((await holdsASeat(tx, routine.orgId, routine.workspaceId, routine.assigneeId, false)) !== "in") return "ASSIGNEE_INACTIVE";
  if (project.teamId && !(await userSeesProject(routine.assigneeId, { workspaceId: routine.workspaceId, teamId: project.teamId }))) return "ASSIGNEE_INACTIVE";
  // the person moved above the maker: every day would only ask them, so the routine stops and says so
  const verdict = await judgeAssignment(tx, { userId: routine.createdById, orgId: routine.orgId }, routine.assigneeId, routine.workspaceId);
  return verdict === "direct" ? null : "FAILED";
}

export async function stopRoutine(client: Client, routineId: string, reason: RoutineStopReason): Promise<void> {
  await client.dailyRoutine.update({ where: { id: routineId }, data: { active: false, stoppedReason: reason, nextRunAt: null } });
}

/**
 * Makes the card of the company day `day` unless that day already has one. The day's row is written FIRST and its unique
 * key decides: a retry, a second runner or an edited time finds the row and makes nothing. Same transaction as the card,
 * so a card that failed leaves no row behind. Returns what to do after the commit, or null when nothing was made.
 */
export async function makeCardOfDay(tx: Tx, routine: RoutineRow, day: string, now: Date, zone: string): Promise<(() => Promise<void>) | null> {
  const claimed = await tx.dailyRoutineRun.createMany({ data: [{ routineId: routine.id, day }], skipDuplicates: true });
  if (claimed.count === 0) return null;
  const actor = { userId: routine.createdById, orgId: routine.orgId };
  await assertMemberCan(actor, "tasks.edit", "section.edit_denied", { spaceGuestsPass: true });
  const p = zonedParts(now, zone);
  const [hour, minute] = routine.dueTime.split(":").map(Number) as [number, number];
  const made = await createTaskInTx(tx, actor, {
    workspaceId: routine.workspaceId,
    projectId: routine.projectId,
    boardId: routine.boardId,
    title: routine.title,
    description: routine.description,
    assigneeId: routine.assigneeId,
    dueDate: zonedWallTime({ year: p.year, month: p.month, day: p.day, hour, minute }, zone),
  });
  await tx.dailyRoutineRun.update({ where: { routineId_day: { routineId: routine.id, day } }, data: { taskId: made.id } });

  return async () => {
    try {
      await notifyCreatedRequests(made, actor);
      if (made.assigneeId && made.assigneeId !== actor.userId) {
        const org = await db.organization.findUnique({ where: { id: routine.orgId }, select: { keyPrefix: true } });
        await notifyAssignment({ assigneeId: made.assigneeId, taskNumber: made.number, orgPrefix: org?.keyPrefix ?? "", taskId: made.id, title: made.title, workspaceId: routine.workspaceId });
      }
      await dispatchEvent(routine.orgId, "task.created", { taskId: made.id, number: made.number, title: made.title });
      await afterTaskEvents([{ trigger: "CREATED", taskId: made.id }]);
    } catch (err) {
      log.warn("routine.after_failed", { taskId: made.id, message: err instanceof Error ? err.message : String(err) });
    }
  };
}
