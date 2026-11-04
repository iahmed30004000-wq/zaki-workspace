import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { subscribe, unsubscribe } from "@/server/calls/push";

const subSchema = z.object({
  endpoint: z.string().url().max(2048).refine((u) => u.startsWith("https://"), "https only"),
  keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
});
const endpointSchema = z.object({ endpoint: z.string().url().max(2048) });

/** POST: this browser agrees to be rung when the site is closed. */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const body = await parseJson(subSchema, req);
    await subscribe(ctx.userId, { endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, userAgent: req.headers.get("user-agent") });
    return NextResponse.json({ ok: true });
  });
}

/** DELETE: this browser no longer wants to be rung. */
export async function DELETE(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const body = await parseJson(endpointSchema, req);
    await unsubscribe(ctx.userId, body.endpoint);
    return NextResponse.json({ ok: true });
  });
}
