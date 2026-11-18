import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parse, parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { sendMessage, sendSchema } from "@/server/chat/messages";
import { conversationMessages, messagesQuerySchema } from "@/server/chat/topics";

/**
 * GET: one window of messages (C1.2), oldest first: the newest `limit`, or `before=<id>`, `after=<id>`, `around=<id>` (one of them), cursor
 * `(createdAt, id)`. Answers `{ messages, hasOlder, hasNewer, firstUnreadId, readers }`.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const q = parse(messagesQuerySchema, Object.fromEntries(new URL(req.url).searchParams));
    return NextResponse.json(await conversationMessages(ctx, params.id, q));
  });
}

/** POST: send a message (optionally as a reply, with attachments, idempotent on `clientId`). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const input = await parseJson(sendSchema, req);
    const ctx = await activeOrgCtx();
    const msg = await sendMessage(ctx, params.id, input);
    return NextResponse.json(msg, { status: 201 });
  });
}
