import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { readMaterial, updateMaterial, updateMaterialSchema } from "@/server/services/manufacturing";

type Ctx = { params: { id: string } };

/** One material with its conversions, lots (and their proof), movements, stocktakes and, for a holder of the cost, the average with its formula. */
export async function GET(_req: Request, { params }: Ctx) {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json({ material: await readMaterial(actor, params.id) });
  });
}

/** The name, the code, the low-stock threshold, or archiving (never a delete). */
export async function PATCH(req: Request, { params }: Ctx) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(updateMaterialSchema, req);
    return NextResponse.json(await updateMaterial(actor, params.id, input));
  });
}
