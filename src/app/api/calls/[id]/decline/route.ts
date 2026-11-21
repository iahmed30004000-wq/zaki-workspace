import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { declineCall } from "@/server/calls/calls";

/** POST: «رفض» — the person rung into a private call says no: the call ends for both and the caller hears it. Whoever may join the call. */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await declineCall(ctx, params.id);
    return NextResponse.json({ ok: true });
  });
}
