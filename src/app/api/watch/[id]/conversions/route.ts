import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertNotGuest } from "@/server/services/guest-guard";
import { assertFeatureOn } from "@/server/services/features";
import { watchDetail } from "@/server/services/watch";
import { conversionsOf } from "@/server/watch/convert";

/**
 * GET: which comments of the session became a task, an idea or a project («حوّل»), as the caller may see them. For the
 * people of the session (and the owner); anybody else: 404. Switched off: an empty answer, the room is the same.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    await assertFeatureOn(ctx.orgId, "watch");
    const session = await watchDetail(ctx, params.id);
    return NextResponse.json({ conversions: await conversionsOf(ctx, session.conversationId) });
  });
}
