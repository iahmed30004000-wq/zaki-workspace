import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parse } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { listConversationMedia, mediaQuerySchema } from "@/server/chat/media";

/**
 * GET ?kind=IMAGE|VIDEO|FILE|AUDIO|LINK|MEDIA&before=&limit=60: the attachments of the NON-deleted messages of this conversation, newest first, in pages
 * (`MEDIA` = pictures and videos together; `LINK` = the messages with a link card). `?counts=1`: one number per kind. Same reading rule as opening the
 * conversation (C3d, src/server/chat/media.ts): never the file of a deleted message; a reader in silent oversight lists without a trace — it writes nothing.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const q = parse(mediaQuerySchema, Object.fromEntries(new URL(req.url).searchParams));
    return NextResponse.json(await listConversationMedia(ctx, params.id, q));
  });
}
