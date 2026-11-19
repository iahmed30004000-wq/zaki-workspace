import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { markRead } from "@/server/chat/messages";
import { clearMarkedUnread } from "@/server/chat/read-state";

/** POST: mark the conversation read up to now (or `?upTo=<messageId>`); never backwards. Opening a conversation also clears «علّم كغير مقروء» (C3a.1). */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const upTo = new URL(req.url).searchParams.get("upTo") ?? undefined;
    const result = await markRead(ctx, params.id, upTo);
    // after markRead: a person with no audience has had their 404 already; a reader in silent oversight has no row, so nothing matches
    await clearMarkedUnread(ctx, params.id);
    return NextResponse.json(result);
  });
}
