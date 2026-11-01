import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { addRecipeVersion, newVersionSchema } from "@/server/services/manufacturing-production";

/** A change to a recipe is a NEW version; an old version is never edited. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(newVersionSchema, req);
    return NextResponse.json(await addRecipeVersion(actor, params.id, input), { status: 201 });
  });
}
