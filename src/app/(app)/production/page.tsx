import { SectionOffNotice, pageActor } from "@/app/(app)/_access";
import { actorCan } from "@/server/policy/actor";
import { GuestNotice, refusedToGuest } from "@/app/(app)/_guest";
import { ProductionView } from "@/components/production-view";
import { deskFactsFor } from "@/server/services/desks";

/** الروتين اليومي — recurring daily checklist. */
export default async function ProductionPage() {
	const { actor } = await pageActor();
	// staff only on the map, and its API refuses a guest: the page says so instead of an empty checklist
	if (refusedToGuest(actor, "production")) return <GuestNotice />;
	// the production row of the person's grid: «يشوف», «يضيف ويعدّل» (by default the admins'), «يحذف»
	if (!actorCan(actor, "production.view")) return <SectionOffNotice />;
	// the company's zone: the checklist's default day and its weekdays are cut there
	// (the same fact the phone's door reads: GET /api/desks/facts)
	const zone = (await deskFactsFor(actor)).timeZone;
	return <ProductionView canManage={actorCan(actor, "production.edit")} canDelete={actorCan(actor, "production.delete")} readOnly={actor.isExternal} timeZone={zone} />;
}

export const dynamic = "force-dynamic";
