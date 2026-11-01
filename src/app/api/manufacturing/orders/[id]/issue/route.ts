import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { issueOrder } from "@/server/services/manufacturing-production";

/** «صرف المواد»: takes everything the order needs out of stock, first-in-first-out, in one transaction (all of it or none). ⚠️ It moves stock. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json(await issueOrder(actor, params.id));
  });
}
