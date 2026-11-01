import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { costLot, costLotSchema } from "@/server/services/manufacturing-ledger";

/** «تسعير دفعة»: the price of a lot received without one, filled ONCE by a holder of `manufacturing.cost` (a new row; the lot is never updated). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(costLotSchema, req);
    return NextResponse.json(await costLot(actor, params.id, input), { status: 201 });
  });
}
