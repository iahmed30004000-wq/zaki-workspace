import { NextResponse } from "next/server";
import { ForbiddenError, NotFoundError } from "@/server/auth";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { boardScreenFor } from "@/server/services/work-app";
/**
 * GET â€” ONE BOARD AS THE KANBAN DRAWS IT, for the phone (M2 N3): the same `boardScreenFor` the board page reads â€” its columns in order, the
 * cards the person may open (`taskVisibleWhere`) with their labels, people, steps, reward (only to whom the lens shows it) and fields, and
 * whether the person may add and drag. Read-only: a card still moves through `POST /api/tasks/[id]/move`. Another team's board is آ«not foundآ».
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const result = await boardScreenFor(actor, params.id);
    if (result.kind === "notFound") throw new NotFoundError("board.not_found");
    if (result.kind === "off") throw new ForbiddenError("section.view_denied");
    return NextResponse.json(result.data);
  });
}
