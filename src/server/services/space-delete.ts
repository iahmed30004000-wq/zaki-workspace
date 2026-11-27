import { touchCrossReplies } from "@/server/chat/cross-reply";
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
 * Never «الشركة» (HQ: the company's own talk; the app makes it again by itself).
 *
 * A DEPARTMENT's space (2026-11-27, the owner's list of old spaces to remove holds some): while its department exists the two go TOGETHER, because a
 * space left behind is made again the next time the department is touched. The department takes its tickets, its campaigns and its list of people with it,
 * so the confirmation counts them too. A space whose department is already gone (deleting a department only unlinks its space) is deleted like any other.
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
  /** the people with a seat in the space */
  members: number;
  /** only while the space's department still exists: it goes too, with these */
  department: { tickets: number; campaigns: number; people: number } | null;
}

async function spaceOf(actor: Actor, spaceId: string) {
  if (actor.role !== "OWNER") throw new ForbiddenError("spaces.delete_owner_only");
  const space = await db.workspace.findFirst({
    where: { id: spaceId, organizationId: actor.orgId },
    select: { id: true, name: true, kind: true, departmentId: true },
  });
  if (!space) throw new NotFoundError("workspace.not_found");
  if (space.kind === "HQ") throw new SpaceConflictError("spaces.delete_hq");
  return space;
}

/** What would go with the space (the confirmation shows it before anything is deleted). */
export async function spaceContents(actor: Actor, spaceId: string): Promise<SpaceContents> {
  const space = await spaceOf(actor, spaceId);
  const here = { workspaceId: space.id };
  const [projects, tasks, conversations, messages, files, ideas, goals, routines, daily, customers, members] = await Promise.all([
    db.project.count({ where: here }),
    // task-visibility: a number for a manager's own decision (delete / confirm); no task is shown
    db.task.count({ where: here }),
    db.conversation.count({ where: { spaceId: space.id } }),
    db.chatMessage.count({ where: { conversation: { spaceId: space.id }, kind: { not: "SYSTEM" } } }),
    db.storedFile.count({ where: { ...here, purpose: "LIBRARY", isLatest: true, deletedAt: null } }),
    db.idea.count({ where: here }),
    db.goal.count({ where: here }),
    db.routine.count({ where: here }),
    db.dailyRoutine.count({ where: here }),
    db.customer.count({ where: here }),
    // all-statuses: every seat goes with the space, whatever its holder's standing
    db.workspaceMember.count({ where: here }),
  ]);
  return { name: space.name, projects, tasks, conversations, messages, files, ideas, goals, routines: routines + daily, customers, members, department: await departmentContents(space.departmentId) };
}

/** What the space's department would take with it, or null when there is no department any more. */
async function departmentContents(departmentId: string | null): Promise<SpaceContents["department"]> {
  if (!departmentId) return null;
  const here = { departmentId };
  const [tickets, campaigns, people] = await Promise.all([db.ticket.count({ where: here }), db.campaign.count({ where: here }), db.departmentMember.count({ where: here })]);
  return { tickets, campaigns, people };
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
      // (a reply in another space that quoted one of these messages stops showing the quote, on the open screens too)
      await touchCrossReplies(tx, actor.orgId, { conversation: { spaceId: space.id } });
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
      // a department's space goes WITH its department (its tickets, campaigns and people cascade): left behind, it would make the space again
      if (space.departmentId) await tx.department.deleteMany({ where: { id: space.departmentId, orgId: actor.orgId } });
    },
    { timeout: 60_000 },
  );
}
