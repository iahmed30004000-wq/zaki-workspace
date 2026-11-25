import { NextResponse } from "next/server";
import { assertMemberCan } from "@/server/policy/actor";
import { db } from "@/server/db";
import { requireTeamWork, NotFoundError } from "@/server/auth";
import { withApi } from "@/server/api";
import { getProjectTimeline } from "@/server/services/timeline";

/** GET /api/projects/:id/timeline — workspace-scoped Gantt data. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    // authorize BEFORE fetching data: resolve the project's workspace first
    const project = await db.project.findUnique({
      where: { id: params.id },
      select: { workspaceId: true, teamId: true },
    });
    if (!project) throw new NotFoundError("project.not_found");
    const access = await requireTeamWork(project.workspaceId, project.teamId, undefined, "project.not_found", undefined, params.id);
    await assertMemberCan(access, "projects.view", "section.view_denied", { spaceGuestsPass: true });
    const data = await getProjectTimeline(params.id, access.userId);
    return NextResponse.json(data);
  });
}
