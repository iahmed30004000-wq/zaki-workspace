import { NextResponse } from "next/server";
import { assertMemberCan } from "@/server/policy/actor";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { NotFoundError, requireTeamWork } from "@/server/auth";

/** Boards of a project, scoped by workspace membership (for pickers/convert). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const project = await db.project.findFirst({
      where: { id: params.id },
      select: { id: true, workspaceId: true, teamId: true },
    });
    if (!project) throw new NotFoundError("project.not_found");
    const access = await requireTeamWork(project.workspaceId, project.teamId, undefined, "project.not_found", undefined, params.id);
    await assertMemberCan(access, "projects.view", "section.view_denied", { spaceGuestsPass: true });
    const boards = await db.board.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        columns: {
          orderBy: { position: "asc" },
          select: { id: true, name: true, position: true, done: true },
        },
      },
    });
    return NextResponse.json({ boards });
  });
}
