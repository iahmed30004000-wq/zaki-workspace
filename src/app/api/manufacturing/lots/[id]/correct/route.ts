import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { correctLotPrice, correctLotPriceSchema } from "@/server/services/manufacturing-ledger";

/** «تصحيح سعر دفعة»: a new price (with its written reason) for a lot that was priced late, by a holder of `manufacturing.cost`. A new row; nothing is edited and finished orders are not re-priced. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(correctLotPriceSchema, req);
    return NextResponse.json(await correctLotPrice(actor, params.id, input), { status: 201 });
  });
}
