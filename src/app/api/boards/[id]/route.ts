import { NextResponse } from "next/server";
import { assertMemberCan } from "@/server/policy/actor";
import { z } from "zod";
import { db } from "@/server/db";
import { audit, NotFoundError, requireTeamWork } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import type { Prisma } from "@prisma/client";
import { taskParticipantFilter } from "@/server/services/team-scope";

/**
 * Board detail: columns + tasks (non-archived) with the canonical task select.
 * Scoped by org through membership resolution; guests see the board but
 * ensureWorkspace handles role gating.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  return withApi(async () => {
    const board = await db.board.findFirst({
      where: { id: params.id },
      include: { project: { select: { id: true, name: true, workspaceId: true, teamId: true, workspace: { select: { name: true } } } } },
    });
    if (!board) throw new NotFoundError("board.not_found");
    const access = await requireTeamWork(board.project.workspaceId, board.project.teamId, undefined, "board.not_found", undefined, board.project.id);
    await assertMemberCan(access, "projects.view", "section.view_denied", { spaceGuestsPass: true });

    const [columns, tasks] = await Promise.all([
      db.boardColumn.findMany({
        where: { boardId: board.id },
        orderBy: { position: "asc" },
        select: { id: true, name: true, color: true, position: true, done: true },
      }),
      db.task.findMany({
        where: { boardId: board.id, archived: false, AND: [await taskParticipantFilter(access.userId)] },
        orderBy: [{ columnId: "asc" }, { position: "asc" }, { id: "asc" }],
        select: {
          id: true,
          number: true,
          organization: { select: { keyPrefix: true } },
          title: true,
          priority: true,
          type: true,
          columnId: true,
          dueDate: true,
          position: true,
          updatedAt: true,
          labels: { select: { label: { select: { id: true, name: true, color: true } } } },
          assignee: { select: { id: true, name: true } },
          _count: { select: { comments: true } },
        },
      }),
    ]);

    return NextResponse.json({
      board: {
        id: board.id,
        name: board.name,
        description: board.description,
        project: { id: board.project.id, name: board.project.name, workspaceName: board.project.workspace.name },
      },
      columns,
      tasks,
    });
  });
}

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  archived: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  return withApi(async () => {
    const input = await parseJson(patchSchema, req);
    const board = await db.board.findFirst({
      where: { id: params.id },
      select: { id: true, projectId: true, project: { select: { id: true, workspaceId: true, teamId: true } } },
    });
    if (!board) throw new NotFoundError("board.not_found");
    const access = await requireTeamWork(board.project.workspaceId, board.project.teamId, ["ADMIN", "MEMBER"], "board.not_found", undefined, board.project.id);
    await assertMemberCan(access, "projects.edit", "section.edit_denied", { spaceGuestsPass: true });
    const updated = await db.board.update({
      where: { id: board.id },
      data: input,
      select: { id: true, name: true, archived: true },
    });
    // a renamed or archived board leaves a trail, like every other change of a name (Phase E)
    await audit("board.updated", { actorId: access.userId, orgId: access.orgId, target: board.id, meta: input });
    return NextResponse.json({ board: updated });
  });
}

const columnsSchema = z.object({
  order: z.array(z.string().min(1)).max(50),
});

/** Persists full column order for the board after a reorder drag. */
// PATCH on /api/boards/[id]/columns
export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  return withApi(async () => {
    const { order } = await parseJson(columnsSchema, req);
    const board = await db.board.findFirst({
      where: { id: params.id },
      select: { id: true, project: { select: { id: true, workspaceId: true, teamId: true } } },
    });
    if (!board) throw new NotFoundError("board.not_found");
    const access = await requireTeamWork(board.project.workspaceId, board.project.teamId, ["ADMIN", "MEMBER"], "board.not_found", undefined, board.project.id);
    await assertMemberCan(access, "projects.edit", "section.edit_denied", { spaceGuestsPass: true });
    const txs = order.map((columnId, position) =>
      db.boardColumn.updateMany({
        where: { id: columnId, boardId: board.id },
        data: { position },
      }),
    );
    await db.$transaction(txs);
    await audit("board.columns_reordered", { actorId: access.userId, orgId: access.orgId, target: board.id, meta: { order } });
    const columns = await db.boardColumn.findMany({
      where: { boardId: board.id },
      orderBy: { position: "asc" },
      select: { id: true, name: true, color: true, position: true, done: true },
    });
    return NextResponse.json({ columns });
  });
}
