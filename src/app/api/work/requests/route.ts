import { NextResponse } from "next/server";
import { ForbiddenError } from "@/server/auth";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { assertFeatureOn } from "@/server/services/features";
import { requestsScopeHere, workRequestsOf } from "@/server/services/work-requests";
import { requestTabOf } from "@/components/work/requests/types";

/**
 * GET /api/work/requests?tab=waiting|mine — «الطلبات» (W1.4): the caller's OWN inbox, every row already filtered by what they may see.
 * It only reads. A row acts through the door that already exists for it (approvals `/decide`, tasks `/request/accept|return`, tickets
 * PATCH, card and sheet `/status`). Switch `workRequests` off: 404 for everybody. A guest (external partner): 403 `guest.no_access`.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    if (actor.isExternal) throw new ForbiddenError("guest.no_access");
    await assertFeatureOn(actor.orgId, "workRequests");
    const tab = requestTabOf(new URL(req.url).searchParams.get("tab"));
    // B4: the space the caller is in (inside «الشركة»: all of them, grouped by space)
    return NextResponse.json(await workRequestsOf(actor, tab, await requestsScopeHere(actor)));
  });
}

export const dynamic = "force-dynamic";
