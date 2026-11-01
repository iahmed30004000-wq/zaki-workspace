import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ValidationError } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { parseJson } from "@/server/validation";
import { createRecipe, createRecipeSchema, readRecipes } from "@/server/services/manufacturing-production";

/** The recipes of ONE manufacturing space (`?spaceId=`) with every version. No price appears in them. */
export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const spaceId = new URL(req.url).searchParams.get("spaceId");
    if (!spaceId) throw new ValidationError([{ path: "spaceId", message: "mfg.e.space" }]);
    return NextResponse.json(await readRecipes(actor, spaceId));
  });
}

/** A new recipe and its first version (`manufacturing.edit`). */
export async function POST(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(createRecipeSchema, req);
    return NextResponse.json(await createRecipe(actor, input), { status: 201 });
  });
}
