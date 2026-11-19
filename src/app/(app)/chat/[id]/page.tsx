import { pageActor } from "@/app/(app)/_access";
import { ConversationPageClient } from "@/components/chat/conversation/conversation-page-client";
import { ConversationPane } from "@/components/chat/v2/pane/conversation-pane";
import { paneSwitch } from "@/lib/chat/v2/pane/switch";
import { db } from "@/server/db";
import { keepInSpace } from "@/server/services/current-space";

/**
 * One conversation. Who may read it is decided again by the chat API (404 for anyone outside its audience).
 *
 * C2.4: with the owner's switch «شاشة الدردشة الجديدة» ON (`paneSwitch`, src/lib/chat/v2/pane/switch.ts) this is the new conversation pane beside the list column;
 * OFF — as merged — it is today's `ConversationPageClient`, with the same props, unchanged. `keepInSpace` runs first either way.
 */
export default async function ChatConversationPage({ params, searchParams = {} }: { params: { id: string }; searchParams?: { m?: string } }) {
  const { actor } = await pageActor();
  // a topic of another space of theirs: enter that space first (a DM belongs to no space and stays where it is)
  const topic = await db.conversation.findFirst({ where: { id: params.id, orgId: actor.orgId }, select: { spaceId: true } });
  if (topic?.spaceId) {
    const back = searchParams.m ? `/chat/${params.id}?m=${encodeURIComponent(searchParams.m)}` : `/chat/${params.id}`;
    await keepInSpace(actor, topic.spaceId, back);
  }
  const pane = await paneSwitch(actor);
  if (pane) return <ConversationPane conversationId={params.id} focusMessageId={searchParams.m} watch={pane.watch} />;
  return <ConversationPageClient conversationId={params.id} focusMessageId={searchParams.m} />;
}

export const dynamic = "force-dynamic";
