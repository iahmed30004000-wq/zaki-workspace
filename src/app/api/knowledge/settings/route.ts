import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { getKnowledgeSettings, knowledgeSettingsSchema, saveKnowledgeSettings } from "@/server/services/knowledge";

/** The owner's knowledge settings: the space, the editors, the approvers, the delivery sentence, the templates by category. */
export const dynamic = "force-dynamic";

export async function GET() {
  return withApi(async () => NextResponse.json(await getKnowledgeSettings(await requireActor()), { headers: { "cache-control": "no-store" } }));
}

export async function PUT(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const input = await parseJson(knowledgeSettingsSchema, req);
    return NextResponse.json(await saveKnowledgeSettings(actor, input));
  });
}
