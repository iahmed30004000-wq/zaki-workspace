import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { updateOrder, updateOrderSchema } from "@/server/services/manufacturing-production";

/** «تعديل المسودة»: the planned quantity, the recipe or the note of an order that is still a DRAFT (refused once it is issued). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(updateOrderSchema, req);
    return NextResponse.json(await updateOrder(actor, params.id, input));
  });
}
