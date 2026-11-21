import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { forwardMessage, forwardSchema, forwardSourceOf } from "@/server/chat/messages";

/** POST: forward a message to another conversation the viewer may read AND post in. The receiver is told (the send's own notification path). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(forwardSchema, req);
    const ctx = await activeOrgCtx();
    const result = await forwardMessage(ctx, params.id, input);
    return NextResponse.json(result, { status: 201 });
  });
}

/**
 * GET (S5.2): where THIS forwarded message came from — `{ conversationId, messageId }` — for the tap on its «محوّلة من» header. Only when the viewer may read both the copy
 * and the original; otherwise 404 (the same for a guest, a conversation they may not read, a deleted original and a message that is no forward).
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await forwardSourceOf(ctx, params.id));
  });
}
