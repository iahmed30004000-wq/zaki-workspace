import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { activeOrgCtx } from "@/server/services/integrations";
import { recallSchema, recallToConversation } from "@/server/chat/recall";

/** POST `{ cardId }`: sends an approved product sheet into the conversation as a card message (no price in the message). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(recallSchema, req);
    const actor = await requireActor();
    const ctx = await activeOrgCtx();
    return NextResponse.json(await recallToConversation(ctx, actor, params.id, input.cardId, input.clientId), { status: 201 });
  });
}
