import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { enableFinishedStock } from "@/server/services/manufacturing-production";

/** «سجّل المنتج النهائي بالمخزون»: the recipe starts keeping its finished item in stock (a material of the space, made once). Asking again changes nothing. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json(await enableFinishedStock(actor, params.id), { status: 201 });
  });
}
