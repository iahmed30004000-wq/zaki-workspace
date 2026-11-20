import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertFeatureOn } from "@/server/services/features";
import { forwardManySchema, forwardMessages } from "@/server/chat/messages";

/**
 * POST (C3b.5, «حدّد» then «حوّل»): forward a selection — `{ messageIds ≤ 100, targetIds ≤ 10, withoutAuthor? }` — into several conversations. The company's switch
 * `chatMultiSelect` first (off: 404). Each message is checked as forwarding one is (readable, not a poll, not deleted), the WHOLE request refused if one fails;
 * each target as well (I may write there), one transaction per target, and the answer reports every target: `results: [{ targetId, ok, ids | error }]`.
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await assertFeatureOn(ctx.orgId, "chatMultiSelect");
    const input = await parseJson(forwardManySchema, req);
    return NextResponse.json(await forwardMessages(ctx, input));
  });
}
