import { z } from "zod";
import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { RateLimitedError, FixedWindowLimiter } from "@/server/rate-limit";
import { setStreamViewing } from "@/server/realtime/hub";

/**
 * POST /api/rt/visibility { visible, tab? } — a tab says whether it is being looked at (F0.5). It decides ONE thing: whether a push
 * is held back for this person. Session-authenticated, rate-limited, memory only (nothing is written to the database).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BODY = z.object({ visible: z.boolean(), tab: z.string().min(1).max(64).optional() });
const limiter = new FixedWindowLimiter({ limit: 60, windowMs: 60_000 });

export async function POST(req: Request): Promise<NextResponse> {
  return withApi(async () => {
    const actor = await requireActor();
    const key = `rt.visibility.${actor.userId}`;
    if (!limiter.check(key).ok) throw new RateLimitedError(60, "chat.e.rate_limited");
    limiter.hit(key);
    const body = BODY.parse(await req.json().catch(() => ({})));
    setStreamViewing(actor.userId, body.visible, body.tab);
    return new NextResponse(null, { status: 204 });
  });
}
