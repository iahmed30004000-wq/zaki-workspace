import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { createMaterial, createMaterialSchema } from "@/server/services/manufacturing";

/** A new material in a manufacturing space the person records in (`manufacturing.edit`). */
export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(createMaterialSchema, req);
    return NextResponse.json(await createMaterial(actor, input), { status: 201 });
  });
}
