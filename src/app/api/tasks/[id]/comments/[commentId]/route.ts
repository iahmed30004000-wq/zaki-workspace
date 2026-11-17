import { NextResponse } from "next/server";
import { assertMemberCan } from "@/server/policy/actor";
import { z } from "zod";
import { ForbiddenError, NotFoundError, requireTeamWork } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { parseJson } from "@/server/validation";
import { activity } from "@/server/activity";

const editSchema = z.object({
  body: z.string().trim().min(1, "comment.required").max(10_000),
});

async function loadTaskComment(taskId: string, commentId: string) {
  // task-visibility: the callers pass this task to requireTeamWork(…, task) before anything is shown
  const task = await db.task.findFirst({
    where: { id: taskId },
    select: { id: true, workspaceId: true, project: { select: { teamId: true } }, visibility: true, creatorId: true, assigneeId: true, coAssignees: { select: { userId: true } }, },
  });
  if (!task) throw new NotFoundError("task.not_found");
  const comment = await db.taskComment.findFirst({
    where: { id: commentId, taskId: task.id },
    select: { id: true, authorId: true },
  });
  if (!comment) throw new NotFoundError("comment.not_found");
  return { task, comment };
}

/** PATCH: edit own comment (author only). */
export async function PATCH(req: Request, { params }: { params: { id: string; commentId: string } }) {
  return withApi(async () => {
    const input = await parseJson(editSchema, req);
    const { task, comment } = await loadTaskComment(params.id, params.commentId);
    const ctx = await requireTeamWork(task.workspaceId, task.project.teamId, ["ADMIN", "MEMBER"], "task.not_found", task);
    await assertMemberCan(ctx, "tasks.edit", "section.edit_denied", { spaceGuestsPass: true });
    if (comment.authorId !== ctx.userId) throw new ForbiddenError("comment.not_yours");
    const updated = await db.taskComment.update({
      where: { id: comment.id },
      data: { body: input.body },
      include: { author: { select: { id: true, name: true } } },
    });
    // an edited comment is a change in the task's story, like every other one (Phase E)
    await activity(db, { taskId: task.id, actorId: ctx.userId, event: "task.comment_edited", meta: { commentId: comment.id } });
    return NextResponse.json({ comment: updated });
  });
}

/** DELETE: remove own comment (author only; task admins may also — authors only for now). */
export async function DELETE(_req: Request, { params }: { params: { id: string; commentId: string } }) {
  return withApi(async () => {
    const { task, comment } = await loadTaskComment(params.id, params.commentId);
    const ctx = await requireTeamWork(task.workspaceId, task.project.teamId, ["ADMIN", "MEMBER"], "task.not_found", task);
    await assertMemberCan(ctx, "tasks.edit", "section.edit_denied", { spaceGuestsPass: true });
    if (comment.authorId !== ctx.userId) throw new ForbiddenError("comment.not_yours");
    await db.taskComment.delete({ where: { id: comment.id } });
    await activity(db, { taskId: task.id, actorId: ctx.userId, event: "task.comment_deleted", meta: { commentId: comment.id } });
    return NextResponse.json({ ok: true });
  });
}
