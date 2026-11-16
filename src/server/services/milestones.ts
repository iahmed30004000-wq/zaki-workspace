import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError, audit, requireTeamWork } from "@/server/auth";
import { assertMemberCan } from "@/server/policy/actor";
import { assertFeatureOn } from "@/server/services/features";
import { orgDayStart } from "@/server/services/org-day";
import { dueInstantForDay } from "@/lib/due-day";

/**
 * «المعالم» — the milestones of a project (the owner, 2026-10-30: the table, the project page's list and
 * the timeline's diamonds all existed and nothing in the repository ever created a row).
 *
 * A milestone is a date the project is measured against — «نسلّم النسخة الأولى» — and the tasks of the
 * project can be attached to it (`Task.milestoneId`, already honoured by `updateTask`). It is not a lock:
 * a task attached to a milestone still moves and still closes.
 *
 * One guard for every write: the project's space AND its team (`requireTeamWork`, the same door the
 * board uses), then the «projects.edit» box. A guest of the space holds no box, so a partner reads the
 * milestones of a project shared with them and creates none.
 *
 * `OVERDUE` is never stored: a milestone that is still open and whose day has passed reads as late on
 * the screen (`overdue` in the DTO). Storing it would need a job to un-store it the moment the owner
 * moves the date.
 */

export const MILESTONE_STATUSES = ["OPEN", "COMPLETED"] as const;
export type MilestoneStatusT = (typeof MILESTONE_STATUSES)[number];

export const milestoneInput = z.object({
  name: z.string().trim().min(1, "milestone.name_required").max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  /** `YYYY-MM-DD` — the day the company is measured against, converted once on the server (review B5's rule). */
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "milestone.bad_date").nullable().optional(),
});

export const milestonePatch = milestoneInput.partial().extend({
  status: z.enum(MILESTONE_STATUSES).optional(),
});

export interface MilestoneDto {
  id: string;
  name: string;
  description: string | null;
  status: MilestoneStatusT | "OVERDUE";
  targetDate: Date | null;
  /** Open, and its day has passed in the COMPANY's zone. */
  overdue: boolean;
  /** How many open tasks of the project are attached to it. */
  openTasks: number;
}

const SELECT = { id: true, name: true, description: true, status: true, targetDate: true } as const;

/** The door every write goes through: the project's space and team, then «projects.edit». */
async function assertMayEditProject(projectId: string): Promise<{ orgId: string; userId: string }> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, workspaceId: true, teamId: true },
  });
  if (!project) throw new NotFoundError("project.not_found");
  const access = await requireTeamWork(project.workspaceId, project.teamId, ["ADMIN", "MEMBER"], "project.not_found");
  await assertMemberCan(access, "projects.edit", "section.edit_denied", { spaceGuestsPass: true });
  await assertFeatureOn(access.orgId, "milestones");
  return { orgId: access.orgId, userId: access.userId };
}

/** A milestone named by id, with the project it belongs to (for the patch and the delete). */
async function milestoneForWrite(milestoneId: string): Promise<{ id: string; projectId: string }> {
  const row = await db.milestone.findUnique({
    where: { id: milestoneId },
    select: { id: true, projectId: true },
  });
  if (!row) throw new NotFoundError("milestone.not_found");
  return row;
}

function toDto(
  row: { id: string; name: string; description: string | null; status: string; targetDate: Date | null; _count?: { tasks: number } },
  dayStart: Date,
): MilestoneDto {
  const overdue = row.status === "OPEN" && row.targetDate != null && row.targetDate < dayStart;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: overdue ? "OVERDUE" : (row.status as MilestoneStatusT),
    targetDate: row.targetDate,
    overdue,
    openTasks: row._count?.tasks ?? 0,
  };
}

/** The milestones of one project, oldest day first — what the project page and the picker read. */
export async function listMilestones(projectId: string, orgId: string): Promise<MilestoneDto[]> {
  const dayStart = await orgDayStart(orgId);
  const rows = await db.milestone.findMany({
    where: { projectId },
    orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }],
    select: { ...SELECT, _count: { select: { tasks: { where: { archived: false, completedAt: null } } } } },
  });
  return rows.map((r) => toDto(r, dayStart));
}

/** One milestone of a project the caller may read (the project page's own guard is the caller's). */
export async function getMilestone(milestoneId: string, orgId: string): Promise<MilestoneDto> {
  const dayStart = await orgDayStart(orgId);
  const row = await db.milestone.findUnique({
    where: { id: milestoneId },
    select: { ...SELECT, _count: { select: { tasks: { where: { archived: false, completedAt: null } } } } },
  });
  if (!row) throw new NotFoundError("milestone.not_found");
  return toDto(row, dayStart);
}

export async function createMilestone(
  projectId: string,
  input: z.infer<typeof milestoneInput>,
  timeZone: string,
): Promise<MilestoneDto> {
  const { orgId, userId } = await assertMayEditProject(projectId);
  const dayStart = await orgDayStart(orgId);
  const row = await db.milestone.create({
    data: {
      projectId,
      name: input.name,
      description: input.description ?? null,
      targetDate: dayToInstant(input.targetDate, timeZone),
      // the person who wrote it holds it, so offboarding hands it to somebody else (accounts.ts)
      ownerId: userId,
    },
    select: SELECT,
  });
  await audit("milestone.created", { actorId: userId, orgId, target: row.id, meta: { projectId, name: row.name } });
  return toDto(row, dayStart);
}

export async function updateMilestone(
  milestoneId: string,
  input: z.infer<typeof milestonePatch>,
  timeZone: string,
): Promise<MilestoneDto> {
  const target = await milestoneForWrite(milestoneId);
  const { orgId, userId } = await assertMayEditProject(target.projectId);
  const dayStart = await orgDayStart(orgId);
  const data: { name?: string; description?: string | null; status?: MilestoneStatusT; targetDate?: Date | null } = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description ?? null;
  if (input.status !== undefined) data.status = input.status;
  if (input.targetDate !== undefined) data.targetDate = dayToInstant(input.targetDate, timeZone);
  const row = await db.milestone.update({ where: { id: milestoneId }, data, select: SELECT });
  await audit("milestone.updated", { actorId: userId, orgId, target: row.id, meta: { projectId: target.projectId } });
  return toDto(row, dayStart);
}

/**
 * Deletes one milestone. Its tasks are NOT deleted: `Task.milestoneId` is `onDelete: SetNull`, so they
 * stay where they are and simply stop pointing at a milestone that is gone.
 */
export async function deleteMilestone(milestoneId: string): Promise<void> {
  const target = await milestoneForWrite(milestoneId);
  const { orgId, userId } = await assertMayEditProject(target.projectId);
  // task-visibility: a number for a manager's own decision (delete / confirm); no task is shown
  const attached = await db.task.count({ where: { milestoneId, archived: false } });
  if (attached > 0) throw new ForbiddenError("milestone.has_tasks");
  await db.milestone.delete({ where: { id: milestoneId } });
  await audit("milestone.deleted", { actorId: userId, orgId, target: milestoneId, meta: { projectId: target.projectId } });
}

/** `YYYY-MM-DD` (company zone) → the instant stored; null for null or an unparsable day. */
function dayToInstant(day: string | null | undefined, timeZone: string): Date | null {
  if (!day) return null;
  return dueInstantForDay(day, timeZone);
}
