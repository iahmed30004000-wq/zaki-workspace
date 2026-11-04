import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertFeatureOn } from "@/server/services/features";
import { listDevices, pairDevice } from "@/server/devices/devices";

const pairSchema = z.object({ name: z.string().max(60).optional() });

/** GET: the phones paired to the signed-in person. */
export async function GET() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await assertFeatureOn(ctx.orgId, "appConnection");
    return NextResponse.json({ devices: await listDevices(ctx.userId) });
  });
}

/** POST: pairs a phone. The key comes back ONCE; the site passes it to the app (zaki://pair), nothing else keeps it. */
export async function POST(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    await assertFeatureOn(ctx.orgId, "appConnection");
    const body = await parseJson(pairSchema, req);
    const { id, token } = await pairDevice(ctx.userId, body.name ?? "Android");
    return NextResponse.json({ id, token }, { headers: { "cache-control": "no-store" } });
  });
}
