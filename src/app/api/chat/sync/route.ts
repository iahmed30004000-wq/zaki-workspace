import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { parse } from "@/server/validation";
import { activeOrgCtx } from "@/server/services/integrations";
import { syncFeed } from "@/server/chat/sync";

const query = z.object({
  // an event id (a positive whole number of at most 18 digits); absent: «where is now?»
  after: z.string().regex(/^\d{1,18}$/, "validation.failed").optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

/** GET: what changed after `after`, for the person who asks (C1.2). The cursor of the answer is the next `after`. */
export async function GET(req: Request) {
  return withApi(async () => {
    const ctx = await activeOrgCtx();
    const q = parse(query, Object.fromEntries(new URL(req.url).searchParams));
    const dto = await syncFeed(ctx, { ...(q.after !== undefined ? { after: BigInt(q.after) } : {}), ...(q.limit !== undefined ? { limit: q.limit } : {}) });
    return NextResponse.json(dto, { headers: { "cache-control": "no-store" } });
  });
}
