import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { crossReplySourceOf } from "@/server/chat/cross-reply";

/**
 * GET: where the message THIS reply quotes from another conversation is — `{ conversationId, messageId }` — for the tap on the quote. Only for somebody who reads both;
 * otherwise 404 (the same for a guest, a conversation they may not read, a deleted source, a message that quotes nothing and the switch off).
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await crossReplySourceOf(ctx, params.id));
  });
}
