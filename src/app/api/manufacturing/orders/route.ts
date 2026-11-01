import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ValidationError } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { createOrder, createOrderSchema, readOrders } from "@/server/services/manufacturing-production";

/** The production orders of ONE manufacturing space (`?spaceId=`); what an order cost is in the answer only for a holder of `manufacturing.cost`. */
export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const spaceId = new URL(req.url).searchParams.get("spaceId");
    if (!spaceId) throw new ValidationError([{ path: "spaceId", message: "mfg.e.space" }]);
    return NextResponse.json(await readOrders(actor, spaceId));
  });
}

/** A new production order (a draft: nothing moves until it is issued). */
export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(createOrderSchema, req);
    return NextResponse.json(await createOrder(actor, input), { status: 201 });
  });
}
