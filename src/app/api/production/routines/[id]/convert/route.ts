import { NextResponse } from "next/server";
import { requireActor } from "@/server/policy/actor";
import { withApi } from "@/server/api";
import { convertRoutineToTask } from "@/server/services/production";

/**
 * POST: «حوّل الروتين لمهام متكررة» — the routine becomes ONE recurring task and is archived (never deleted). Who manages routines
 * only (guests 403 `guest.readonly`). 201 when the task was made now, 200 when the routine had already become one (nothing new is made).
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
	return withApi(async () => {
		const actor = await requireActor();
		const result = await convertRoutineToTask({ orgId: actor.orgId, userId: actor.userId }, params.id);
		return NextResponse.json(result, { status: result.created ? 201 : 200 });
	});
}
