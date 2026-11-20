import { NextResponse } from "next/server";
import { NotFoundError } from "@/server/auth";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { actorCanWork, requireActor } from "@/server/policy/actor";
import { actorFeatureOn } from "@/server/services/features";
import { loadWorkScope, projectVisibleWhere } from "@/server/services/team-scope";

/**
 * GET /boards/<id>/trail - the names of the trail «المساحة › المشروع › اللوحة» of a board, for the task page (N1.5): the task page knows its board and nothing
 * above it, so its trail asks once. `show` is true only while the switch `navV2` is on AND the person's grid has the «المشاريع» row (the crumbs lead there),
 * so the old map's task page stays as it was. The rule is the board page's own (the project's space and team, an ACTIVE member of the company): anything else is 404 (as if it
 * did not exist); the answer holds names only - no card, no task, no person.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const scope = await loadWorkScope(actor.userId);
    const board = await db.board.findFirst({
      where: { id: params.id, project: projectVisibleWhere(scope) },
      select: { id: true, name: true, project: { select: { id: true, name: true, workspace: { select: { name: true, organizationId: true } } } } },
    });
    if (!board) throw new NotFoundError("board.not_found");
    // the board page's other gate: an ACTIVE member of the board's company (anybody else gets the same «not found»)
    const member = await db.organizationMember.findFirst({ where: { organizationId: board.project.workspace.organizationId, userId: actor.userId, status: "ACTIVE" }, select: { role: true } });
    if (!member) throw new NotFoundError("board.not_found");
    const show = (await actorFeatureOn(actor, "navV2")) && actorCanWork(actor, "projects.view");
    return NextResponse.json(
      { show, spaceName: board.project.workspace.name, projectId: board.project.id, projectName: board.project.name, boardId: board.id, boardName: board.name },
      { headers: { "Cache-Control": "no-store" } },
    );
  });
}

export const dynamic = "force-dynamic";
