import { notFound } from "next/navigation";
import { SectionOffNotice, pageActor } from "@/app/(app)/_access";
import { actorCanWork } from "@/server/policy/actor";
import { CallRoom } from "@/components/calls/call-room";
import { db } from "@/server/db";
import { keepInSpace } from "@/server/services/current-space";
import { actorFeatureOn } from "@/server/services/features";

/** One call (a conversation's, or a meeting opened by its link). Who may join is decided again by the calls API. */
export default async function CallPage({ params }: { params: { id: string } }) {
  const { actor } = await pageActor();
  // «المكالمات» off (or «وضع التوفير»): there is no call page; leaving or ending a call still works through its API
  if (!(await actorFeatureOn(actor, "calls"))) notFound();
  // the calls row of the person's grid (an external partner by the space's rules)
  if (!actorCanWork(actor, "calls.view")) return <SectionOffNotice />;
  // a call of another space of theirs: enter that space first, so the name at the top says where the call is
  const call = await db.call.findFirst({ where: { id: params.id, orgId: actor.orgId }, select: { spaceId: true } });
  if (!call) notFound();
  if (call.spaceId) await keepInSpace(actor, call.spaceId, `/calls/${params.id}`);
  return <CallRoom callId={params.id} />;
}

export const dynamic = "force-dynamic";
