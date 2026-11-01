import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { updateSupplier, updateSupplierSchema } from "@/server/services/manufacturing";

/** The name, the note, or archiving (a supplier is never deleted). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(updateSupplierSchema, req);
    return NextResponse.json({ supplier: await updateSupplier(actor, params.id, input) });
  });
}
