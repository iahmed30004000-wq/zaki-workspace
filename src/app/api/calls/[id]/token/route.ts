import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { callPass } from "@/server/calls/calls";

const passSchema = z.object({ prefetch: z.boolean().optional() });

/**
 * POST: a two-minute pass into the call's room on the calls server. Only for somebody who may join it. `{ prefetch: true }` is a phone that is
 * only ringing and warms its connection: it is not answering (the body is optional; no body is a real join, as the phone app sends it).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const body = passSchema.safeParse(await req.json().catch(() => ({})));
    return NextResponse.json(await callPass(ctx, params.id, { prefetch: body.success && body.data.prefetch === true }), { headers: { "cache-control": "no-store" } });
  });
}
