import type { ReactNode } from "react";
import { pageActor } from "@/app/(app)/_access";
import { ChatShell } from "@/components/chat/v2/shell/chat-shell";
import { actorCan } from "@/server/policy/actor";
import { isFeatureOn } from "@/server/services/features";

/**
 * C2.1 — the layout of every page under `/chat`. With the owner's switch `chatLayoutV2` OFF (the default, as merged) it draws NOTHING of its own: the
 * pages inside render exactly as they did before this file existed (`/chat` is the old home, `/chat/[id]` the old conversation page). With it ON it
 * draws the chat shell around them: the list column that stays mounted while the person moves between conversations, and the pane beside it.
 *
 * The page still refuses for itself (`pageActor` in each page: in the App Router a page runs beside its layout). What reaches the browser is only
 * what the shell draws: whether the person is an external partner, whether they may start a meeting, whether the company's «قائمة المحادثة» switch
 * is on, and whether they are the owner rank (the one rank-based fact: «حذف نهائي» is the owner's, D-A4, and is not a reading decision). The server
 * decides every action again when it is taken.
 */
export default async function ChatLayout({ children }: { children: ReactNode }) {
  const { actor } = await pageActor();
  if (!(await isFeatureOn(actor.orgId, "chatLayoutV2"))) return <>{children}</>;
  const rowMenu = await isFeatureOn(actor.orgId, "chatRowMenu");
  const tgLook = await isFeatureOn(actor.orgId, "tgLook");
  return (
    <ChatShell
      userId={actor.userId}
      guest={actor.isExternal}
      canMeet={!actor.isExternal && actorCan(actor, "calls.edit")}
      rowMenu={rowMenu}
      canPurge={rowMenu && actor.isOwner}
      tgLook={tgLook}
    >
      {children}
    </ChatShell>
  );
}

export const dynamic = "force-dynamic";
