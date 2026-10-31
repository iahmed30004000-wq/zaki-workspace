import { NextResponse } from "next/server";
import { actorCan, assertCan, requireActor } from "@/server/policy/actor";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { assertNotGuest } from "@/server/services/guest-guard";
import { createGoal, goalSchema, listGoals } from "@/server/services/goals";
import { placeOf } from "@/server/services/space-place";
import { isFeatureOn } from "@/server/services/features";

/**
 * Goals are the company's own plans (titles, descriptions, departments, who set them): staff only. An
 * external partner (guest) gets 403 `guest.no_access` from every handler here, before anything is
 * read or the body is looked at.
 */

/** GET: all goals of the caller's org (the company they are still ACTIVE in). */
export async function GET() {
	return withApi(async () => {
		const actor = await requireActor();
		assertNotGuest({ orgRole: actor.role });
		assertCan(actor, "goals.view", "section.view_denied");
		const place = await placeOf(actor);
		const goals = await listGoals({ orgId: actor.orgId, orgRole: actor.role, userId: actor.userId, mayEdit: actorCan(actor, "goals.edit") }, place);
		// `spaceId`: where the editor looks for people and projects; `okr`: the «الأهداف والنتائج» switch
		return NextResponse.json({ goals, spaceId: place.spaceId, okr: await isFeatureOn(actor.orgId, "okr") });
	});
}

/** POST: create a goal (OWNER/ADMIN). */
export async function POST(req: Request) {
	return withApi(async () => {
		const actor = await requireActor();
		assertNotGuest({ orgRole: actor.role });
		const input = await parseJson(goalSchema, req);
		const goal = await createGoal({ orgId: actor.orgId, userId: actor.userId }, input, (await placeOf(actor)).spaceId);
		return NextResponse.json({ goal }, { status: 201 });
	});
}
