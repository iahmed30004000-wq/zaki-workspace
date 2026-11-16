import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { NotFoundError, requireTeamWork } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { moveTask } from "@/server/services/tasks";
import { dispatchEvent } from "@/server/services/n8n";

const moveSchema = z.object({
  columnId: z.string().min(1),
  index: z.number().int().min(0).max(10_000).optional(),
});

/** Kanban move endpoint. MEMBERS+; guests are rejected by requireWorkspace roles. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(moveSchema, req);
    const task = await db.task.findFirst({
      where: { id: params.id },
      select: { id: true, workspaceId: true, project: { select: { teamId: true } }, visibility: true, creatorId: true, assigneeId: true, coAssignees: { select: { userId: true } }, },
    });
    if (!task) throw new NotFoundError("task.not_found");
    const ctx = await requireTeamWork(task.workspaceId, task.project.teamId, ["ADMIN", "MEMBER"], "task.not_found", task);
    const moved = await moveTask(ctx, params.id, input);
    await dispatchEvent(ctx.orgId, "task.moved", {
      taskId: moved.id,
      number: moved.number,
      title: moved.title,
      columnId: input.columnId,
    });
    return NextResponse.json({ task: moved });
  });
}
