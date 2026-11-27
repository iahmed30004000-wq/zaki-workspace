import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { loadPersonHeader, periodChoicesFor } from "@/server/services/team-people";

/**
 * The header of one person's file (name, supervisor, what the viewer may enter) and the periods to pick, for the phone. The same service as
 * the page: the person, their supervisors and the owner open it; anybody else gets 404, never 403.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const person = await loadPersonHeader(actor, params.id);
    return NextResponse.json({ person, periods: await periodChoicesFor(actor) }, { headers: { "cache-control": "no-store" } });
  });
}
