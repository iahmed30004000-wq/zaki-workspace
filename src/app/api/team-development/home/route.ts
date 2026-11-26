import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { loadDevelopmentHome, periodChoicesFor } from "@/server/services/team-people";

/**
 * The front door of آ«ط§ظ„ط£ط¯ط§ط، ظˆط§ظ„طھط·ظˆظٹط±آ» for the phone: who the viewer reads (`mode`: owner, supervisor, or self: only their own file) and the
 * periods to pick, named. The same service as the page; 404 for a guest and while the feature is switched off.
 */
export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    const home = await loadDevelopmentHome(actor);
    return NextResponse.json({ home, periods: await periodChoicesFor(actor) }, { headers: { "cache-control": "no-store" } });
  });
}
