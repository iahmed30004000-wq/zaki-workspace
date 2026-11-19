import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { NotFoundError } from "@/server/auth";
import { activeOrgCtx } from "@/server/services/integrations";
import { openPreviewImage } from "@/server/chat/messages";

/**
 * GET /api/chat/messages/[id]/preview/image — the picture of a message's link card (C3b.2). It is the ONLY way a card's picture is served: the app's own storage
 * (the server's disk, or proxied from Drive after the check below), never the site's address and never a Drive link. Whoever may read the conversation gets it; a
 * deleted message, a card without a picture, a switched-off feature and a stranger all get the same 404.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    let file: Awaited<ReturnType<typeof openPreviewImage>>;
    try {
      file = await openPreviewImage(ctx, params.id);
    } catch (err) {
      if (err instanceof NotFoundError) return new NextResponse(null, { status: 404 });
      throw err;
    }
    return new NextResponse(await file.stream(null), {
      status: 200,
      headers: {
        "content-type": file.mimeType,
        "content-length": String(file.size),
        "content-disposition": "inline",
        "x-content-type-options": "nosniff",
        // the page may carry anything: the picture is shown as a picture and can never run
        "content-security-policy": "default-src 'none'; sandbox",
        "cache-control": "private, max-age=3600",
      },
    });
  });
}
