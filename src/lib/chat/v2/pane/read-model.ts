import type { MessageDto } from "@/server/chat/dto";
import { newestConfirmedId } from "@/lib/chat/cache/pending";

/**
 * C2.4 — what the read mark is fed (C1.8's `createReadMarker`). The newest message the SERVER has (never a pending bubble: its id is not the server's),
 * and only while the newest message is really on screen: the windows reach the newest AND the person is at the bottom. Landing on the first unread
 * message far above the newest, or reading around a search hit, marks nothing until the person gets there — a message nobody saw is not «read».
 */
export function newestToConsider(s: { messages: readonly Pick<MessageDto, "id">[]; atNewest: boolean; atBottom: boolean }): string | null {
  if (!s.atNewest || !s.atBottom) return null;
  return newestConfirmedId(s.messages);
}
