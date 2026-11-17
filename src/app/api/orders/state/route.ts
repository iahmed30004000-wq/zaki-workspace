import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { activeOrgCtx } from "@/server/services/integrations";
import { lookupOrderState } from "@/server/services/order-state";
import { parse } from "@/server/validation";

/** GET `?number=&conversationId=`: an order's state for the chip and the «/طلب» card (Q1.4). Staff who can read that conversation only. */
export const dynamic = "force-dynamic";

const querySchema = z.object({ number: z.string().min(1).max(40), conversationId: z.string().min(1).max(64) });

export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    const ctx = await activeOrgCtx();
    const url = new URL(req.url);
    const input = parse(querySchema, { number: url.searchParams.get("number") ?? "", conversationId: url.searchParams.get("conversationId") ?? "" });
    return NextResponse.json(await lookupOrderState(ctx, actor, input), { headers: { "cache-control": "no-store" } });
  });
}
