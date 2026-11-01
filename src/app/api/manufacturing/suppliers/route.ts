import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { createSupplier, createSupplierSchema } from "@/server/services/manufacturing";

/** A new supplier of a manufacturing space (name and a free note). */
export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(createSupplierSchema, req);
    return NextResponse.json({ supplier: await createSupplier(actor, input) }, { status: 201 });
  });
}
