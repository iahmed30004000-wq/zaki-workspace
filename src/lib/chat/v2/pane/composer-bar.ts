import type { ConversationDto } from "@/server/chat/dto";

/**
 * What sits under the messages: the composer whenever the server says I may post (`me.canPost` already covers closed, muted, guests and «للمشرفين فقط» —
 * a space admin posts in the announcements), else the owner's «شارك بالمحادثة», else the one line that says why not.
 *
 * C2.4: the function moved here from `conversation-screen.tsx` (which re-exports it, so the old screen and the pinned test `chat-composer-bar` import it
 * from the same place as before), so the new composer host does not have to import the whole old screen to ask it.
 */
export type ComposerBar = "composer" | "join" | "oversight" | "closed" | "muted" | "channel" | "announcements" | "denied";

export function composerBarOf(me: ConversationDto["me"], conv: Pick<ConversationDto, "closed" | "topicType"> & Partial<Pick<ConversationDto, "postingPolicy">>): ComposerBar {
  if (me.canPost) return "composer";
  if (me.canJoin) return "join";
  if (me.oversight) return "oversight";
  if (conv.closed) return "closed";
  if (me.muted) return "muted";
  // C3c.4: a channel (announcements that only admins post in) says «بس المشرفين بينشروا هون»; the rest of the announcements keep the old line (a guest never posts there)
  if (conv.topicType === "ANNOUNCEMENTS") return conv.postingPolicy === "ADMINS" ? "channel" : "announcements";
  return "denied";
}
