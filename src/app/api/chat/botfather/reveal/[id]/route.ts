import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { activeOrgCtx } from "@/server/services/integrations";
import { takeReveal } from "@/server/services/botfather";

/**
 * GET: the secret a line of «بوت فاذر» is holding (a new token, a webhook's secret) — ONCE, for the person the chat belongs to, within 15 minutes; the server forgets it as it
 * answers (404 `botfather.reveal_gone` afterwards, after a restart or for anybody else). Never cached.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    return NextResponse.json(await takeReveal(ctx, params.id), { headers: { "cache-control": "no-store" } });
  });
}
