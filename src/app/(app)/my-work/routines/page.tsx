import { notFound } from "next/navigation";
import { SectionOffNotice, pageActor } from "@/app/(app)/_access";
import { GuestNotice } from "@/app/(app)/_guest";
import { RoutinesView } from "@/components/work/routines/routines-view";
import { actorCanWork } from "@/server/policy/actor";
import { routinesScreen } from "@/server/services/daily-routines";
import { isFeatureOn } from "@/server/services/features";

/**
 * «الروتين اليومي» — /my-work/routines: the routines that make a fresh card on their days, each with pause, resume and
 * edit for whoever manages it. A guest gets the notice every internal page gives. While the company's «مهمة متكررة»
 * switch is off there is no such page. The service decides again what the person sees.
 */
export default async function RoutinesPage() {
  const { actor } = await pageActor();
  if (!(await isFeatureOn(actor.orgId, "recurringTasks"))) notFound();
  if (actor.isExternal) return <GuestNotice />;
  if (!actorCanWork(actor, "tasks.view")) return <SectionOffNotice />;
  // the screen carries the company's usual due hour too: the phone reads the same answer (GET /api/daily-routines)
  const initial = await routinesScreen();
  return <RoutinesView initial={initial} defaultDueTime={initial.defaultDueTime} />;
}

export const dynamic = "force-dynamic";
