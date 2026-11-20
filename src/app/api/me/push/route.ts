import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { listSubscriptions } from "@/server/calls/push";

/**
 * GET → `{ subscriptions: [{ id, userAgent, createdAt, lastUsedAt }] }`: the browsers THIS person allowed to receive notifications (C4.1 «الأجهزة»).
 * Always the caller's own (the person comes from the session, there is no id in the address); the push address and the keys never leave the server.
 */
export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    return NextResponse.json({ subscriptions: await listSubscriptions(actor.userId) }, { headers: { "Cache-Control": "no-store" } });
  });
}

export const dynamic = "force-dynamic";
