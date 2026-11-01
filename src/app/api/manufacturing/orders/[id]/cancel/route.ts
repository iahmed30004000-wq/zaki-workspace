import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { cancelOrder, closeOrderSchema } from "@/server/services/manufacturing-production";

/** A step of a production order: a draft cancelled, with the reason. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(closeOrderSchema, req);
    return NextResponse.json(await cancelOrder(actor, params.id, input));
  });
}
