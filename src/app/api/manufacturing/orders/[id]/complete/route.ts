import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { completeOrder, completeOrderSchema } from "@/server/services/manufacturing-production";

/** A step of a production order: the real output (and an optional waste line). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(completeOrderSchema, req);
    return NextResponse.json(await completeOrder(actor, params.id, input));
  });
}
