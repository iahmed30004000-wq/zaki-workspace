import { redirect } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { actorCan } from "@/server/policy/actor";
import { ChatHomeClient } from "@/components/chat/home/chat-home-client";
import { EmptyState } from "@/components/chat/v2/empty-state";
import { currentSpace } from "@/server/services/current-space";
import { isFeatureOn } from "@/server/services/features";
import { opensOnCards } from "@/lib/cards/shared";

/** The chat list is scoped again by the server API for this authenticated actor. */
export default async function ChatPage() {
  const { actor } = await pageActor();
  // a space of «لوحات» has no chat home: it opens on its cards (a topic link still opens, and «أرسل» writes into one)
  if (opensOnCards((await currentSpace(actor))?.layout)) redirect("/cards");
  // a meeting is started with the calls row's «يضيف ويعدّل» box
  const canMeet = !actor.isExternal && actorCan(actor, "calls.edit");
  // C2.1: with «شاشة الدردشة الجديدة» (`chatLayoutV2`) ON the list is the layout's column and this page is the pane beside it («اختار محادثة»); OFF, today's home, unchanged
  if (await isFeatureOn(actor.orgId, "chatLayoutV2")) return <EmptyState guest={actor.isExternal} canMeet={canMeet} />;
  return <ChatHomeClient guest={actor.isExternal} canMeet={canMeet} />;
}

export const dynamic = "force-dynamic";
