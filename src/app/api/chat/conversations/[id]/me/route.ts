import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertFeatureOn } from "@/server/services/features";
import { myChatStateSchema, setMyChatState } from "@/server/chat/read-state";

/**
 * PUT `{ pinned?, archived?, markedUnread?, mutedUntil? }`: the person's OWN pin, archive, «علّم كغير مقروء» and mute of this conversation (C3a.1, «لإلي بس»).
 * Answers `{ pinned, archived, markedUnread, mutedUntil, pins }`. A person with no audience here — and a reader in silent oversight — gets a 404 and nothing is
 * written (no row, no event). An 11th pin is a 422 `chatps.pins_full`. Switch `chatPersonalState` off: 404 for everybody; what was stored stays.
 */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await assertFeatureOn(ctx.orgId, "chatPersonalState");
    const input = await parseJson(myChatStateSchema, req);
    return NextResponse.json(await setMyChatState(ctx, params.id, input));
  });
}

export const dynamic = "force-dynamic";
