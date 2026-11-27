import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ForbiddenError } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { assertFeatureOn } from "@/server/services/features";
import { watchHome } from "@/server/services/watch";

/**
 * The phone's «نتفرّج سوا»: what the place's page draws (`watchHome`, shared with src/app/(app)/watch/page.tsx) — the sessions of
 * the space the person is in, who may be picked for a new one, and whether they may start one. The page's own refusals: an external
 * partner never (the place is not theirs), a switched-off feature is «not found», a person without `watch.view` is refused.
 */
export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    if (actor.isExternal) throw new ForbiddenError("guest.no_access");
    await assertFeatureOn(actor.orgId, "watch");
    return NextResponse.json(await watchHome(actor));
  });
}
