import { NextResponse } from "next/server";
import { activeOrgCtx } from "@/server/services/integrations";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { campaignItemToTask } from "@/server/services/campaigns";
import { sourceTaskSchema } from "@/server/services/production";

/**
 * POST: «اعمل منه مهمة» — a campaign item becomes a task (createTask), linked both ways. Who manages the campaign; guests 403. 201 when the task was
 * made now, 200 when the item already had one (the same task, nothing new). The task is returned as the caller may read it (named, or only «hidden»).
 * Lives under /api/production because W1.6 is limited to those paths; the integrator may move it next to the campaign routes.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const input = await parseJson(sourceTaskSchema, req);
    const result = await campaignItemToTask(ctx, params.id, input);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  });
}
