import { NextResponse } from "next/server";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { withApi } from "@/server/api";
import { actorCanWork, requireActor } from "@/server/policy/actor";
import { assertFeatureOn } from "@/server/services/features";
import { currentSpace } from "@/server/services/current-space";
import { workTaskPanelFor } from "@/server/services/my-work";

/**
 * GET /api/work/tasks/[id] — what the side panel of «مهامي» (`?task=<id>`) shows of one task. The rule of every task door: a task the caller may not see
 * (another team's, a private one they are no part of) is 404, as if it did not exist. The full page `/tasks/[id]` stays the place for everything else.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    await assertFeatureOn(actor.orgId, "workMyTasks");
    if (!actorCanWork(actor, "tasks.view")) throw new ForbiddenError("access.section_off");
    const space = await currentSpace(actor);
    const detail = await workTaskPanelFor(actor.userId, params.id, space ? { id: space.id, kind: space.kind } : null);
    if (!detail) throw new NotFoundError("task.not_found");
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  });
}

export const dynamic = "force-dynamic";
