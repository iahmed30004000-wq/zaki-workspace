import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { gifSaveSchema, listMyGifs, saveGifFromAttachment } from "@/server/chat/gifs";

/** GET: MY kept GIFs and the ones I sent lately, only what I may have now. POST `{ attachmentId }`: keep the GIF of a message I can read («احفظ بالصور المتحركة»). */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await listMyGifs(ctx), { headers: { "cache-control": "private, no-store" } });
  });
}

export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const input = gifSaveSchema.parse(await req.json().catch(() => ({})));
    return NextResponse.json(await saveGifFromAttachment(ctx, input.attachmentId), { status: 201 });
  });
}

export const dynamic = "force-dynamic";
