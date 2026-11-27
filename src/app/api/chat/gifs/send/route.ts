import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { gifSendSchema, sendGifMessage } from "@/server/chat/gifs";

/** POST `{ conversationId, savedId | attachmentId, replyToId?, clientId?, silent? }`: one tap sends a GIF of mine. The page never names a file. */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const input = gifSendSchema.parse(await req.json().catch(() => ({})));
    return NextResponse.json(await sendGifMessage(ctx, input), { status: 201 });
  });
}
