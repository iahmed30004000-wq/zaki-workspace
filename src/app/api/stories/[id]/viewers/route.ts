import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { storyViewers } from "@/server/services/stories";

/** GET — who saw the story: its author's alone. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const viewers = await storyViewers(await requireActor(), params.id);
    return NextResponse.json({ viewers }, { headers: { "cache-control": "private, no-store" } });
  });
}

export const dynamic = "force-dynamic";
