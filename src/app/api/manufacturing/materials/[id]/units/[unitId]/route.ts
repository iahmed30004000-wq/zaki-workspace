import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { archiveUnit } from "@/server/services/manufacturing";

/** A conversion is archived, never deleted: the lots keep the label they were typed in. */
export async function DELETE(_req: Request, { params }: { params: { id: string; unitId: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json({ units: await archiveUnit(actor, params.id, params.unitId) });
  });
}
