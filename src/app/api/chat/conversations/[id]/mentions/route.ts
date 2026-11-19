import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parse } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { mentionsQuerySchema, unreadMentionIds } from "@/server/chat/mentions";

/**
 * GET ?after=&limit=: the ids of the UNREAD messages of this conversation that mention me (or «@الكل»), oldest first, in pages — what the «@» button walks
 * (C3b.6). `{ ids, next }`: `next` is the last id when there are more (pass it as `after`). Same reading rule as opening the conversation; a reader in silent
 * oversight gets an empty list and leaves no trace; ids only, never a text. It writes nothing.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const q = parse(mentionsQuerySchema, Object.fromEntries(new URL(req.url).searchParams));
    return NextResponse.json(await unreadMentionIds(ctx, params.id, q));
  });
}
