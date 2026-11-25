import { NextResponse } from "next/server";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { projectScreenFor } from "@/server/services/work-app";
/**
 * GET â€” ONE PROJECT AS ITS PAGE SHOWS IT, for the phone (M2 N3): the same `projectScreenFor` the project page reads â€” its head, its boards
 * with the tasks the person may open, the progress, what the person may do there (`projectCardAccess`) and the pinned strip.
 * Read-only: boards, milestones and the team still change through their own routes. Another team's project is آ«not foundآ».
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const result = await projectScreenFor(actor, params.id);
    if (result.kind === "notFound") throw new NotFoundError("project.not_found");
    if (result.kind === "off") throw new ForbiddenError("section.view_denied");
    return NextResponse.json(result.data);
  });
}
