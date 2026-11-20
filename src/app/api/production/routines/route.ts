import { NextResponse } from "next/server";
import { assertCan, requireActor } from "@/server/policy/actor";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { createRoutine, listRoutines, routineSchema } from "@/server/services/production";
import { assertNotGuest } from "@/server/services/guest-guard";
import { placeOf } from "@/server/services/space-place";

/** GET: all routines (admin manage view). Staff only: a routine carries its assignee (review C6). */
export async function GET() {
	return withApi(async () => {
		const actor = await requireActor();
		assertNotGuest({ orgRole: actor.role });
		assertCan(actor, "production.view", "section.view_denied");
		const routines = await listRoutines(actor.orgId, await placeOf(actor), { userId: actor.userId });
		return NextResponse.json({ routines });
	});
}

/** POST: create a recurring daily-production routine (OWNER/ADMIN; guests get 403 `guest.readonly`). */
export async function POST(req: Request) {
	return withApi(async () => {
		const actor = await requireActor();
		const input = await parseJson(routineSchema, req);
		const routine = await createRoutine({ orgId: actor.orgId, userId: actor.userId }, input, (await placeOf(actor)).spaceId);
		return NextResponse.json({ routine }, { status: 201 });
	});
}
