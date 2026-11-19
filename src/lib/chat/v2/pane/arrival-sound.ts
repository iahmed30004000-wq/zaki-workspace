import type { MessageDto } from "@/server/chat/dto";
import { isPendingMessage } from "@/lib/chat/cache/pending";
import { mentionsMeOf } from "@/lib/chat/v2/pane/bubble-model";
import { soundOfArrival, type ChatSound } from "@/lib/chat/sounds";

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
  if (!s.messages.some((m) => m.id === s.previousNewestId)) return null;
  return soundOfArrival({ mine: newest.mine, opening: false, mentionsMe: mentionsMeOf(newest, s.meId), kind: newest.kind });
}
