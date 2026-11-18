import { redirect } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { EmptyState } from "@/components/chat/v2/empty-state";
import { actorCan } from "@/server/policy/actor";
import { isFeatureOn } from "@/server/services/features";

/**
 * C2.3 — `/chat/s/<spaceId>`: the forum view of one space. The view itself is drawn by the chat shell INSIDE the list column (it reads the space's topics
 * from the cache, and the server's route says which of them this person may read); this page is the pane beside it, the empty «اختار محادثة».
 *
 * The address exists only with the switch `chatLayoutV2` ON: OFF, there is no forum view, so it goes to `/chat` (the old home). It needs no space check of
 * its own: a space the person is not in simply has no topics for them (404 from the route), and a topic opened from it goes through `keepInSpace` as always.
 */
export default async function ChatForumPage() {
  const { actor } = await pageActor();
  if (!(await isFeatureOn(actor.orgId, "chatLayoutV2"))) redirect("/chat");
  return <EmptyState guest={actor.isExternal} canMeet={!actor.isExternal && actorCan(actor, "calls.edit")} />;
}

export const dynamic = "force-dynamic";
