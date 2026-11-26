import { NextResponse } from "next/server";
import { assertMemberCan } from "@/server/policy/actor";
import { z } from "zod";
import { audit, ForbiddenError, NotFoundError, requireTeamWork } from "@/server/auth";
import { apiError } from "@/server/api";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { parseJson } from "@/server/validation";
import { workStageSchema } from "@/lib/work/stage";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  done: z.boolean().optional(),
  /** W1.3: the normalized stage - a space manager's choice (a plain member who sends it gets 403 and nothing is saved). */
  stage: workStageSchema.optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string; columnId: string } },
) {
  return withApi(async () => {
    const input = await parseJson(patchSchema, req);
    const { board } = await resolveBoard(params.id);
    const access = await requireTeamWork(board.project.workspaceId, board.project.teamId, ["ADMIN", "MEMBER"], "board.not_found", undefined, board.project.id);
    await assertMemberCan(access, "projects.edit", "section.edit_denied", { spaceGuestsPass: true });
    // W1.3: choosing the stage is the space manager's (the owner, a space admin, an admin of the company who is in the space)
    if (input.stage !== undefined && access.spaceManager !== true) throw new ForbiddenError("column.stage_manager_only");
    const column = await db.boardColumn.findFirst({
      where: { id: params.columnId, boardId: board.id },
      select: { id: true },
    });
    if (!column) throw new NotFoundError("column.not_found");
    const updated = await db.boardColumn.update({
      where: { id: column.id },
      data: input,
      select: { id: true, name: true, color: true, position: true, done: true, stage: true },
    });
    await audit("board.column_updated", { target: column.id, meta: input });
    return NextResponse.json({ column: updated });
  });
}

/** Deletes an empty column; a board always keeps at least one. */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; columnId: string } },
) {
  return withApi(async () => {
    const { board } = await resolveBoard(params.id);
    const access = await requireTeamWork(board.project.workspaceId, board.project.teamId, ["ADMIN", "MEMBER"], "board.not_found", undefined, board.project.id);
    await assertMemberCan(access, "projects.edit", "section.edit_denied", { spaceGuestsPass: true });
    const column = await db.boardColumn.findFirst({
      where: { id: params.columnId, boardId: board.id },
      select: { id: true, _count: { select: { tasks: true } } },
    });
    if (!column) throw new NotFoundError("column.not_found");
    const total = await db.boardColumn.count({ where: { boardId: board.id } });
    if (total <= 1) throw new ForbiddenError("column.last_one");
    if (column._count.tasks > 0) {
      return apiError("conflict", "column.not_empty");
    }
    await db.boardColumn.delete({ where: { id: column.id } });
    await audit("board.column_deleted", { target: column.id });
    return NextResponse.json({ ok: true });
  });
}

async function resolveBoard(boardId: string) {
  const board = await db.board.findFirst({
    where: { id: boardId },
    select: { id: true, project: { select: { id: true, workspaceId: true, teamId: true } } },
  });
  if (!board) throw new NotFoundError("board.not_found");
  return { board: board as typeof board & { id: string } };
}
