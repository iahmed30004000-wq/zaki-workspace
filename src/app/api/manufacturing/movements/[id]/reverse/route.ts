import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { reverseMovement, reverseSchema } from "@/server/services/manufacturing-ledger";

/** «عكس حركة»: the correction of a mistake, a new movement that undoes the old one (which stays as it was). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(reverseSchema, req);
    return NextResponse.json(await reverseMovement(actor, params.id, input), { status: 201 });
  });
}
