import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { assertNotGuest } from "@/server/services/guest-guard";
import { assertNotSpaceOnly } from "@/server/policy/space-only";
import { syncUpdates } from "@/server/services/telegram";

/** POST: pull new Telegram updates for the active org (org members, never guests). */
export async function POST() {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    assertNotGuest(ctx);
    await assertNotSpaceOnly(ctx.userId, ctx.orgId); // the customers' conversations are the company's
    const result = await syncUpdates(ctx.orgId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json(result);
  });
}
