import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { parse } from "@/server/validation";
import { controlPanelAccess, loadPanelReports } from "@/server/services/control-panel";

/**
 * The phone's owner «التقارير» of «لوحة التحكم»: what the panel's reports draw (`loadPanelReports`: the totals, the eight weeks, the
 * priorities, the workload, the ideas, a table per space), the whole company or one space. The owner alone (`controlPanelAccess`).
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const access = await controlPanelAccess(actor);
    const q = parse(z.object({ space: z.string().max(64).optional() }), Object.fromEntries(new URL(req.url).searchParams.entries()));
    return NextResponse.json(await loadPanelReports(access, { space: q.space || null }));
  });
}
