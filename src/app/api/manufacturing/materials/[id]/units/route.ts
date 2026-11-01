import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { addUnit, addUnitSchema } from "@/server/services/manufacturing";

/** «1 كرتونة = 24 علبة»: a conversion of this material, an exact fraction of its base unit. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(addUnitSchema, req);
    return NextResponse.json({ units: await addUnit(actor, params.id, input) }, { status: 201 });
  });
}
