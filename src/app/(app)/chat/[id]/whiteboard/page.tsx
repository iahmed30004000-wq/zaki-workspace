import { notFound } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { WhiteboardScreen } from "@/components/whiteboard/whiteboard-screen";
import { db } from "@/server/db";
import { keepInSpace } from "@/server/services/current-space";
import { actorFeatureOn } from "@/server/services/features";

/** The whiteboard of one conversation. Who may see it and draw on it is decided again by its API. */
export default async function WhiteboardPage({ params }: { params: { id: string } }) {
  const { actor } = await pageActor();
  // «السبورة» off (or «وضع التوفير»): the page is not there, so the drawing library is never even loaded
  if (!(await actorFeatureOn(actor, "whiteboard"))) notFound();
  const conv = await db.conversation.findFirst({ where: { id: params.id, orgId: actor.orgId }, select: { spaceId: true, kind: true, title: true } });
  if (!conv) notFound();
  if (conv.spaceId) await keepInSpace(actor, conv.spaceId, `/chat/${params.id}/whiteboard`);
  // a topic is named by its title; a DM's board is simply «الخاص»
  return <WhiteboardScreen conversationId={params.id} title={conv.kind === "TOPIC" && conv.title ? conv.title : ""} />;
}

export const dynamic = "force-dynamic";
