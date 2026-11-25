import { NextResponse } from "next/server";
import { ForbiddenError } from "@/server/auth";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { projectsScreenFor } from "@/server/services/work-app";
/**
 * GET — THE PROJECTS OF THE SPACE THE PERSON IS IN, as the projects page shows them, for the phone (M2 N3): the same `projectsScreenFor` the
 * page reads — not archived, inside the person's work scope and teams, the space's quick-task inbox pinned apart (switch `workInbox`).
 * Read-only: a project is still created through `POST /api/projects`. Without the projects row of the grid it is refused.
 */
export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    const result = await projectsScreenFor(actor);
    if (result.kind !== "ok") throw new ForbiddenError("section.view_denied");
    return NextResponse.json(result.data);
  });
}
