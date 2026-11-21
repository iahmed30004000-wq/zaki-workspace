import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { markJoined } from "@/server/calls/calls";

/** POST: the browser really connected to the call's room — the call counts as answered and its other screens hear it. Whoever may join the call. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await markJoined(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
