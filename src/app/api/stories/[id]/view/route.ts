import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { markStoryViewed } from "@/server/services/stories";

/** POST — this person opened the story (once per person; the author's own opening is not a view). */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    await markStoryViewed(await requireActor(), params.id);
    return NextResponse.json({ ok: true });
  });
}

export const dynamic = "force-dynamic";
