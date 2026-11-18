import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { conversationHeader } from "@/server/chat/topics";

/** GET: the header of a conversation (C1.2): title, kind, space, audience, what I may do here, the pinned bar, the switches. No messages. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await conversationHeader(ctx, params.id));
  });
}
