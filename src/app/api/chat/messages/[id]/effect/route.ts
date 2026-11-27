import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { playForPeer } from "@/server/chat/emoji-effect";

/**
 * POST: «I played this emoji» in a private chat; the other person's open screen plays it too (src/server/chat/emoji-effect.ts). The answer says nothing about
 * whether they were looking.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  return withApi(async () => {
    const actor = await requireActor();
    await playForPeer(actor, params.id);
    return new NextResponse(null, { status: 204 });
  });
}
