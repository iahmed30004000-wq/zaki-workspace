import type { MessageDto } from "@/server/chat/dto";
import { isPendingMessage } from "@/lib/chat/cache/pending";
import { mentionsMeOf } from "@/lib/chat/v2/pane/bubble-model";
import { soundOfArrival, type ChatSound } from "@/lib/chat/sounds";
import { notifyTypeOf, type NotifyType } from "@/lib/chat/prefs";

/**
 * «صوت لكل نوع إشعار»: the KIND of notification the newest message is for me, by the very rule the server judges a push with (`notifyTypeOf`): a private chat; else a mention
 * («@الكل» too); else a reply to a message of mine (the server marks it, or the message answered is on screen and is mine); else topics and groups.
 */
export function arrivalTypeOf(s: { conversationKind: "DM" | "GROUP" | "TOPIC"; messages: readonly MessageDto[]; meId: string | undefined }): NotifyType | undefined {
  const newest = s.messages.at(-1);
  if (!newest) return undefined;
  const quoted = newest.replyTo;
  const replied = !!quoted && (quoted.mine === true || s.messages.some((m) => m.id === quoted.id && m.mine));
  return notifyTypeOf({ kind: s.conversationKind, mentioned: mentionsMeOf(newest, s.meId), replied });
}

/**
 * C2.4 — which sound a new newest message makes (the old screen's rule, kept: `soundOfArrival`). It is an ARRIVAL only when the message that was
 * newest is still in the list (otherwise the windows were replaced as a whole: the opening, a jump, «آخر الرسائل»), the newest changed, it is not a
 * pending bubble of mine (the send makes its own sound, from the composer), it was not there at the opening (`previousNewestId` null) and the windows
 * reached the newest message before AND after (a page of newer messages arriving while the person reads an old place is paging, not an arrival).
 */
export function arrivalSoundOf(s: { previousNewestId: string | null; messages: readonly MessageDto[]; meId: string | undefined; hadNewer?: boolean; hasNewer?: boolean }): ChatSound | null {
  const newest = s.messages.at(-1);
  if (!newest || s.previousNewestId === null || newest.id === s.previousNewestId) return null;
  if (s.hadNewer || s.hasNewer) return null;
  if (isPendingMessage(newest)) return null;
  // C3c.2: «ابعت بدون صوت» — the sender chose silence, so this device makes none either (a mention included)
  if (newest.silent === true) return null;
  if (!s.messages.some((m) => m.id === s.previousNewestId)) return null;
  return soundOfArrival({ mine: newest.mine, opening: false, mentionsMe: mentionsMeOf(newest, s.meId), kind: newest.kind });
}
