import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { deleteStory } from "@/server/services/stories";

/** DELETE — the author takes their own story back (nothing is hard-deleted: it leaves every view). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    await deleteStory(await requireActor(), params.id);
    return NextResponse.json({ ok: true });
  });
}

export const dynamic = "force-dynamic";
