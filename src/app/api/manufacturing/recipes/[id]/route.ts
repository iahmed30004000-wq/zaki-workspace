import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { archiveRecipe, archiveRecipeSchema } from "@/server/services/manufacturing-production";

/** Archive or restore a recipe (never a delete). */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(archiveRecipeSchema, req);
    return NextResponse.json(await archiveRecipe(actor, params.id, input));
  });
}
