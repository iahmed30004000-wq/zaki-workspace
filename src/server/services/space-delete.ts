import { z } from "zod";
import { db } from "@/server/db";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { SpaceConflictError } from "@/server/services/workspaces";

/**
 * DELETING A SPACE WITH ALL ITS WORK (the owner's decision, 2026-10-26: «كلها مع شغلها»). The OWNER only, after typing
 * the space's name. Everything that lives in it goes, for good, in one transaction — nothing is left half-deleted:
 * its tasks and projects (boards, columns, comments with them), its conversations (topics and DMs, their messages,
 * boards and calls), its ideas, goals, routines, customers and opportunities, its notifications; its library files
 * are deleted the way the library deletes them (`deletedAt`). Its members and «مقاطع» go with the space.
 *
 * Never «الشركة» (HQ: the company's own talk), and never a department's space (it goes with its department).
 * A space without work is still deleted by its ADMINs through `DELETE /api/workspaces/[id]` (`deleteEmptyWorkspace`).
 */

export const deleteAllSchema = z.object({ confirmName: z.string().trim().min(1).max(200) });

export interface SpaceContents {
  name: string;
  projects: number;
  tasks: number;
  conversations: number;
  messages: number;
  files: number;
  ideas: number;
  goals: number;
  routines: number;
  customers: number;
}

async function spaceOf(actor: Actor, spaceId: string) {
  if (actor.role !== "OWNER") throw new ForbiddenError("spaces.delete_owner_only");
  const space = await db.workspace.findFirst({
    where: { id: spaceId, organizationId: actor.orgId },
    select: { id: true, name: true, kind: true },
  });
  if (!space) throw new NotFoundError("workspace.not_found");
  if (space.kind === "HQ") throw new SpaceConflictError("spaces.delete_hq");
  if (space.kind === "DEPARTMENT") throw new SpaceConflictError("spaces.delete_department");
  return space;
}

/** What would go with the space (the confirmation shows it before anything is deleted). */
export async function spaceContents(actor: Actor, spaceId: string): Promise<SpaceContents> {
  const space = await spaceOf(actor, spaceId);
  const here = { workspaceId: space.id };
  const [projects, tasks, conversations, messages, files, ideas, goals, routines, customers] = await Promise.all([
    db.project.count({ where: here }),
    // task-visibility: a number for a manager's own decision (delete / confirm); no task is shown
    db.task.count({ where: here }),
    db.conversation.count({ where: { spaceId: space.id } }),
    db.chatMessage.count({ where: { conversation: { spaceId: space.id }, kind: { not: "SYSTEM" } } }),
    db.storedFile.count({ where: { ...here, purpose: "LIBRARY", isLatest: true, deletedAt: null } }),
    db.idea.count({ where: here }),
    db.goal.count({ where: here }),
    db.routine.count({ where: here }),
    db.customer.count({ where: here }),
  ]);
  return { name: space.name, projects, tasks, conversations, messages, files, ideas, goals, routines, customers };
}

/** Deletes the space and everything in it; the typed name must be the space's own. */
export async function deleteSpaceWithWork(actor: Actor, spaceId: string, confirmName: string): Promise<void> {
  const space = await spaceOf(actor, spaceId);
  if (confirmName.trim() !== space.name.trim()) throw new SpaceConflictError("spaces.delete_name_mismatch");
  const here = { workspaceId: space.id };

  await db.$transaction(
    async (tx) => {
      // nothing is created in the space while it goes
      await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${space.id} FOR UPDATE`;
      // the work: tasks first (a task holds its board's column), then the projects with their boards
      const projectIds = (await tx.project.findMany({ where: here, select: { id: true } })).map((p) => p.id);
      await tx.task.deleteMany({ where: { OR: [here, { projectId: { in: projectIds } }] } });
      await tx.project.deleteMany({ where: here });
      // the talk: its conversations take their messages, members, boards and calls with them
      await tx.conversation.deleteMany({ where: { spaceId: space.id } });
      // what would otherwise fall back to «الشركة» (no space): it was this space's, it goes with it
      await tx.opportunity.deleteMany({ where: here });
      await tx.customer.deleteMany({ where: here });
      await tx.idea.deleteMany({ where: here });
      await tx.goal.deleteMany({ where: here });
      await tx.routine.deleteMany({ where: here });
      await tx.notification.deleteMany({ where: here });
      await tx.storedFile.updateMany({ where: { ...here, deletedAt: null }, data: { deletedAt: new Date() } });
      // the space itself: its members, «مقاطع» and calls go with it
      await tx.workspace.delete({ where: { id: space.id } });
    },
    { timeout: 60_000 },
  );
}
