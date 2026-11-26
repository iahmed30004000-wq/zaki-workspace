import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { ForbiddenError } from "@/server/auth";
import { actorCan, requireActor } from "@/server/policy/actor";
import { analyticsScreenFor } from "@/server/services/analytics-scope";

/**
 * The phone's «التقارير»: the numbers the report draws (`analyticsFor`, shared with the page's report). The page's refusals: an external
 * partner never (the company's numbers and its staff's workload), and the reports box of the person's grid.
 */
export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    if (actor.isExternal) throw new ForbiddenError("guest.no_access");
    if (!actorCan(actor, "reports.view")) throw new ForbiddenError("section.view_denied");
    return NextResponse.json(await analyticsScreenFor(actor));
  });
}
