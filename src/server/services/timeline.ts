import { db } from "@/server/db";
import { NotFoundError } from "@/server/auth";
import { taskParticipantFilter } from "@/server/services/team-scope";
/**
 * Microsoft-Project-style timeline data for one project: dated tasks become
 * bars, milestones become diamonds, undated tasks are reported separately.
 */
export async function getProjectTimeline(projectId: string, userId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      startDate: true,
      targetDate: true,
      workspaceId: true,
    },
  });
  if (!project) throw new NotFoundError("project.not_found");

  const [tasks, milestones] = await Promise.all([
    db.task.findMany({
      where: { projectId, archived: false, AND: [await taskParticipantFilter(userId)] },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        title: true,
        startDate: true,
        dueDate: true,
        completedAt: true,
        priority: true,
        assignee: { select: { id: true, name: true } },
        column: { select: { done: true } },
      },
    }),
    db.milestone.findMany({
      where: { projectId },
      orderBy: { targetDate: "asc" },
      select: { id: true, name: true, targetDate: true, status: true },
    }),
  ]);

  const dated = tasks.filter((t) => t.startDate || t.dueDate);
  const undated = tasks.filter((t) => !t.startDate && !t.dueDate).map((t) => ({ id: t.id, title: t.title }));

  return {
    project: {
      id: project.id,
      name: project.name,
      startDate: project.startDate,
      targetDate: project.targetDate,
      workspaceId: project.workspaceId,
    },
    tasks: dated.map((t) => {
      const start = (t.startDate ?? t.dueDate) as Date;
      const end = (t.dueDate ?? t.startDate) as Date;
      return {
        id: t.id,
        title: t.title,
        start,
        end,
        // an end that is also a due date renders as a finishing bar of ≥1 day
        done: t.completedAt != null || t.column?.done === true,
        priority: t.priority as string,
        assignee: t.assignee?.name ?? null,
      };
    }),
    milestones: milestones.map((m) => ({
      id: m.id,
      name: m.name,
      date: m.targetDate,
      status: m.status as string,
    })),
    undated,
  };
}
