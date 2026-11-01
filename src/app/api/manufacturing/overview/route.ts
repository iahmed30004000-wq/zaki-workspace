import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ValidationError } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { readOverview } from "@/server/services/manufacturing";

/**
 * «مخزون التصنيع»: the ledger's front page for ONE manufacturing space (`?spaceId=`): the materials with their balance, the stocktakes
 * waiting for a second person and the suppliers. A partner, a person without `manufacturing.view`, and a space that is not a manufacturing
 * space of theirs all get 404; the cost fields are present only for a holder of `manufacturing.cost`.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const spaceId = new URL(req.url).searchParams.get("spaceId");
    if (!spaceId) throw new ValidationError([{ path: "spaceId", message: "mfg.e.space" }]);
    return NextResponse.json(await readOverview(actor, spaceId));
  });
}
