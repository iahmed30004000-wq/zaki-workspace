import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { NotFoundError } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { removeSubscription } from "@/server/calls/push";

/**
 * DELETE: «افصل» — this person stops receiving notifications on ONE of their browsers (C4.1 «الأجهزة»). Only the caller's own subscription is removed:
 * somebody else's id, or one that does not exist, is 404 `push.not_found` and nothing is touched (the same answer, so an id cannot be probed).
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const actor = await requireActor();
    if (!(await removeSubscription(actor.userId, params.id))) throw new NotFoundError("push.not_found");
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}

export const dynamic = "force-dynamic";
