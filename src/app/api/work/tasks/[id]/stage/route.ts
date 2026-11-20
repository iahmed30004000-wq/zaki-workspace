import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { NotFoundError, ValidationError, requireTeamWork } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { assertFeatureOn } from "@/server/services/features";
import { moveTask } from "@/server/services/tasks";
import { dispatchEvent } from "@/server/services/n8n";
import { workStageSchema } from "@/lib/work/stage";

const bodySchema = z.object({ stage: workStageSchema });

/**
 * POST /api/work/tasks/[id]/stage {stage} — move a task to a stage from «مهامي»'s board view (W1.1). A stage is the shared vocabulary on top of each
 * board's own columns (`BoardColumn.stage`, W1.3), so the task goes to the first column of ITS OWN board that carries that stage (for DONE, a column that
 * finishes work comes first), through the ordinary `moveTask`: the same rules, log line, recurrence and project rules as dragging a card on the board. A board
 * with no column of that stage: 422 `work.stage_missing` and nothing moves. The rule of the move route: members and above; a task the caller may not see is 404.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const { stage } = await parseJson(bodySchema, req);
    const task = await db.task.findFirst({
      where: { id: params.id },
      select: { id: true, workspaceId: true, boardId: true, columnId: true, project: { select: { teamId: true } }, visibility: true, creatorId: true, assigneeId: true, coAssignees: { select: { userId: true } } },
    });
    if (!task) throw new NotFoundError("task.not_found");
    const ctx = await requireTeamWork(task.workspaceId, task.project.teamId, ["ADMIN", "MEMBER"], "task.not_found", task);
    await assertFeatureOn(ctx.orgId, "workMyTasks");
    const column = await db.boardColumn.findFirst({
      where: { boardId: task.boardId, stage },
      orderBy: [...(stage === "DONE" ? [{ done: "desc" as const }] : []), { position: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!column) throw new ValidationError([{ path: "stage", message: "work.stage_missing" }]);
    const moved = await moveTask(ctx, params.id, { columnId: column.id });
    await dispatchEvent(ctx.orgId, "task.moved", { taskId: moved.id, number: moved.number, title: moved.title, columnId: column.id });
    return NextResponse.json({ task: moved });
  });
}

export const dynamic = "force-dynamic";
