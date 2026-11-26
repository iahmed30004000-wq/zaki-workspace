import { NextResponse } from "next/server";
import { assertMemberCan } from "@/server/policy/actor";
import { z } from "zod";
import { db } from "@/server/db";
import { NotFoundError, requireTeamWork } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { dispatchEvent } from "@/server/services/n8n";
import { notifyComment } from "@/server/notify";

const commentSchema = z.object({
  body: z.string().trim().min(1, "comment.required").max(10_000),
});

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  return withApi(async () => {
        const input = await parseJson(commentSchema, req);
    const task = await db.task.findFirst({
      where: { id: params.id },
      select: {
        id: true,
        workspaceId: true,
        project: { select: { teamId: true } },
        number: true,
        assigneeId: true,
        creatorId: true,
        visibility: true,
        coAssignees: { select: { userId: true } },
        organization: { select: { keyPrefix: true } },
      },
    });
    if (!task) throw new NotFoundError("task.not_found");
    // writing needs a member of the space: an external partner (GUEST) only reads
    const ctx = await requireTeamWork(task.workspaceId, task.project.teamId, ["ADMIN", "MEMBER"], "task.not_found", task);
    await assertMemberCan(ctx, "tasks.edit", "section.edit_denied", { spaceGuestsPass: true });
    const comment = await db.taskComment.create({
      data: { taskId: task.id, authorId: ctx.userId, body: input.body },
      include: { author: { select: { id: true, name: true } } },
    });
    await db.taskActivity.create({
      data: { taskId: task.id, actorId: ctx.userId, event: "task.commented" },
    });
    await dispatchEvent(ctx.orgId, "comment.created", { taskId: task.id, commentId: comment.id });
    await notifyComment({
      taskId: task.id,
      taskNumber: task.number,
      orgPrefix: task.organization.keyPrefix,
      authorId: ctx.userId,
      authorName: comment.author.name,
      body: input.body,
      watcherIds: [task.assigneeId, task.creatorId].filter((x): x is string => x !== null),
      workspaceId: task.workspaceId,
    });
    return NextResponse.json({ comment }, { status: 201 });
  });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const task = await db.task.findFirst({
      where: { id: params.id },
      select: { id: true, workspaceId: true, project: { select: { teamId: true } }, visibility: true, creatorId: true, assigneeId: true, coAssignees: { select: { userId: true } }, },
    });
    if (!task) throw new NotFoundError("task.not_found");
    const access = await requireTeamWork(task.workspaceId, task.project.teamId, undefined, "task.not_found", task);
    await assertMemberCan(access, "tasks.view", "section.view_denied", { spaceGuestsPass: true });
    const comments = await db.taskComment.findMany({
      where: { taskId: params.id },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ comments });
  });
}
