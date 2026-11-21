import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertFeatureOn } from "@/server/services/features";
import { listForwardTargets } from "@/server/chat/forward-targets";

/**
 * GET (S5.2, the forward sheet): every place I may write in — the topics of EVERY space I am in and my private chats — plus my saved chat and the recent ones. A hint for the
 * sheet, never a permission: the forward doors decide every target again. The company's switch `chatMultiSelect` first (off: 404, the sheet then falls back to the old list).
 * It is a separate door on purpose: `/api/chat/home` stays the current space's.
 */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await assertFeatureOn(ctx.orgId, "chatMultiSelect");
    return NextResponse.json(await listForwardTargets(ctx));
  });
}
