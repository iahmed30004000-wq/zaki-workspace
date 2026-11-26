import { NextResponse } from "next/server";
import { assertMemberCan } from "@/server/policy/actor";
import { z } from "zod";
import { db } from "@/server/db";
import { requireTeamWork, audit, ForbiddenError, NotFoundError } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { DEFAULT_BOARD_COLUMNS } from "@/server/services/tasks";

const createSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
});

/** Creates a board with the default workflow columns (Arabic names, customizable later). */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(createSchema, req);
    const project = await db.project.findFirst({
      where: { id: input.projectId },
      select: { id: true, workspaceId: true, teamId: true, workspace: { select: { organizationId: true } } },
    });
    if (!project) throw new NotFoundError("project.not_found");
    const access = await requireTeamWork(project.workspaceId, project.teamId, ["ADMIN", "MEMBER"], "project.not_found", undefined, project.id);
    await assertMemberCan(access, "projects.edit", "section.edit_denied", { spaceGuestsPass: true });

    const board = await db.board.create({
      data: {
        projectId: input.projectId,
        name: input.name,
        description: input.description ?? null,
        columns: {
          create: DEFAULT_BOARD_COLUMNS.map((c, i) => ({ ...c, position: i })),
        },
      },
      select: { id: true, name: true, projectId: true },
    });
    await audit("board.created", { target: board.id, meta: { name: board.name } });
    return NextResponse.json({ board }, { status: 201 });
  });
}
