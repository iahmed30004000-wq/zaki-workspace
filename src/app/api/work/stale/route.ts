import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/server/api";
import { requireActor } from "@/server/policy/actor";
import { assertFeatureOn } from "@/server/services/features";
import { parseJson } from "@/server/validation";
import { staleListFor, sweepStale } from "@/server/services/stale-tasks";
import { STALE_ACTIONS, parseStaleParams } from "@/lib/work/stale";

/**
 * GET /api/work/stale?days=&auto=all|hide|only&space= — «مهام قديمة» (W1.9): the open tasks nobody touched for N days (default 14) in the spaces the
 * caller MANAGES, grouped by person and project, only what the caller may open (P0.2: a hidden task is neither listed nor counted). The owner and the
 * people who run a space only: 403 `guest.no_access` for a partner, 403 `stale.managers_only` for everybody else. Switch `workStaleSweep` off: 404.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const actor = await requireActor();
    await assertFeatureOn(actor.orgId, "workStaleSweep");
    return NextResponse.json(await staleListFor(actor, parseStaleParams(new URL(req.url).searchParams)), { headers: { "Cache-Control": "no-store" } });
  });
}

const sweepSchema = z.object({
  action: z.enum(STALE_ACTIONS),
  taskIds: z.array(z.string().min(1).max(64)).max(2000),
  /** `assign`: who gets the tasks. */
  assigneeId: z.string().min(1).nullable().optional(),
  /** `postpone`: the new due day (`YYYY-MM-DD`), the company's calendar. */
  day: z.string().max(10).nullable().optional(),
});

/**
 * POST — one bulk action on many tasks: `{ action: close | assign | postpone | archive, taskIds, assigneeId?, day? }`. Every task goes through the service
 * that owns the change (`moveTask`, `updateTask`) on its own and the answer lists each one: `done`, `requested` (the person asked for is of a higher rank:
 * a request was made, the task kept its holder) or `refused` with the machine key of the reason. Nothing is all-or-nothing and nothing is deleted.
 * A mistake in the call itself (no tasks, more than 200, a past day, no person) is a 422 before anything happens.
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const input = await parseJson(sweepSchema, req);
    const actor = await requireActor();
    await assertFeatureOn(actor.orgId, "workStaleSweep");
    const result = await sweepStale(actor, input);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  });
}

export const dynamic = "force-dynamic";
