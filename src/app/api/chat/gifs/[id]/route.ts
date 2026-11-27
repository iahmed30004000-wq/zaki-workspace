import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { removeSavedGif } from "@/server/chat/gifs";

/** DELETE: take one out of MY library (somebody else's row is «not found»). The messages that carry the file are not touched. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await removeSavedGif(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
