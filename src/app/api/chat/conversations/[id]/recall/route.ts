import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireActor } from "@/server/policy/actor";
import { activeOrgCtx } from "@/server/services/integrations";
import { orderToConversation, recallSchema, recallToConversation } from "@/server/chat/recall";

/** POST `{ cardId }`: sends an approved product sheet into the conversation as a card message (no price in the message). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(recallSchema, req);
    const actor = await requireActor();
    const ctx = await activeOrgCtx();
    const message = input.order !== undefined ? await orderToConversation(ctx, actor, params.id, input.order, input.clientId) : await recallToConversation(ctx, actor, params.id, input.cardId as string, input.clientId);
    return NextResponse.json(message, { status: 201 });
  });
}
