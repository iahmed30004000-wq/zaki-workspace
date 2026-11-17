import { db } from "@/server/db";
import { audit } from "@/server/auth";

/**
 * «خلّي المهام المسندة المفتوحة خاصة»: one click for the whole space (P0.2). Every OPEN task of the space that somebody holds
 * and that is still «المساحة كلها» becomes «المعنيين بس»; closed, archived and unassigned tasks stay as they are, and
 * nothing is deleted. Each task gets its own line in its log. The route behind it is the space's managers' alone.
 */
const where = (workspaceId: string, orgId: string) => ({
  orgId,
  workspaceId,
  visibility: "SPACE",
  assigneeId: { not: null },
  completedAt: null,
  archived: false,
});

/** How many tasks the click would change (the confirmation shows it). */
export async function countPublicAssignedTasks(orgId: string, workspaceId: string): Promise<number> {
  // task-visibility: a number for a space manager's own decision; no task is shown
  return db.task.count({ where: where(workspaceId, orgId) });
}

export async function makeAssignedTasksPrivate(actor: { userId: string; orgId: string }, workspaceId: string): Promise<{ changed: number }> {
  const changed = await db.$transaction(async (tx) => {
    // task-visibility: the space manager's own bulk action; the ids are only used to write each task's log line
    const rows = await tx.task.findMany({ where: where(workspaceId, actor.orgId), select: { id: true } });
    if (!rows.length) return 0;
    await tx.task.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { visibility: "PARTICIPANTS" } });
    await tx.taskActivity.createMany({
      data: rows.map((r) => ({ taskId: r.id, actorId: actor.userId, event: "task.visibility_changed", meta: { from: "SPACE", to: "PARTICIPANTS", bulk: true } })),
    });
    return rows.length;
  });
  await audit("task.visibility_bulk", { actorId: actor.userId, orgId: actor.orgId, target: workspaceId, meta: { changed } });
  return { changed };
}
