import { NextResponse } from "next/server";
import { assertMemberCan } from "@/server/policy/actor";
import { z } from "zod";
import { audit, ForbiddenError, NotFoundError, requireTeamWork } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { parseJson } from "@/server/validation";
import { actorFeatureOn } from "@/server/services/features";
import { workStageSchema } from "@/lib/work/stage";

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#6b7280"),
  /** W1.3: the new column's stage (a space manager's choice); left out, the column is DOING like every column without a choice. */
  stage: workStageSchema.optional(),
});

/**
 * W1.3: the board's columns with their stage, and what the board screen needs to decide whether to offer the choice: `stagesOn` (the
 * company's switch `workStages`) and `canSetStage` (the viewer is a space manager). Read by whoever may open the board.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const board = await db.board.findFirst({
      where: { id: params.id },
      select: { id: true, project: { select: { workspaceId: true, teamId: true } } },
    });
    if (!board) throw new NotFoundError("board.not_found");
    const access = await requireTeamWork(board.project.workspaceId, board.project.teamId, undefined, "board.not_found");
    await assertMemberCan(access, "projects.view", "section.view_denied", { spaceGuestsPass: true });
    const [columns, stagesOn] = await Promise.all([
      db.boardColumn.findMany({
        where: { boardId: board.id },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { id: true, name: true, color: true, position: true, done: true, stage: true },
      }),
      actorFeatureOn(access, "workStages"),
    ]);
    return NextResponse.json({ columns, stagesOn, canSetStage: access.spaceManager === true });
  });
}

/** Adds a column at the end of the board workflow. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(createSchema, req);
    const board = await db.board.findFirst({
      where: { id: params.id },
      select: { id: true, project: { select: { workspaceId: true, teamId: true } } },
    });
    if (!board) throw new NotFoundError("board.not_found");
    const access = await requireTeamWork(board.project.workspaceId, board.project.teamId, ["ADMIN", "MEMBER"], "board.not_found");
    await assertMemberCan(access, "projects.edit", "section.edit_denied", { spaceGuestsPass: true });
    // W1.3: a stage in the body is the space manager's choice
    if (input.stage !== undefined && access.spaceManager !== true) throw new ForbiddenError("column.stage_manager_only");

    const last = await db.boardColumn.findFirst({
      where: { boardId: board.id },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const column = await db.boardColumn.create({
      data: {
        boardId: board.id,
        name: input.name,
        color: input.color,
        position: (last?.position ?? -1000) + 1000,
        done: false,
        ...(input.stage ? { stage: input.stage } : {}),
      },
      select: { id: true, name: true, color: true, position: true, done: true, stage: true },
    });
    await audit("board.column_added", { target: column.id, meta: { boardId: board.id } });
    return NextResponse.json({ column }, { status: 201 });
  });
}
