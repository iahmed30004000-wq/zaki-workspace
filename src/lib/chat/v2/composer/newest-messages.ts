import type { QueryClient } from "@tanstack/react-query";
import { chatKeys } from "@/lib/chat/cache/keys";
import { messagesOfData } from "@/lib/chat/cache/reducers";
import type { MessageDto, MessagesData } from "@/lib/chat/cache/types";

/**
 * C2.5 — the messages the cache holds for a conversation, read ONCE (a key press asks; nothing subscribes, so the composer does not draw again for every
 * message that arrives). `null` when the cache has no window yet, or when the window it holds is an OLD place (a search hit, a jump): «my last message» is only
 * the last one of the conversation, so «↑» then does nothing instead of editing something far above.
 */
export function newestMessagesOf(qc: QueryClient, conversationId: string): MessageDto[] | null {
  const data = qc.getQueryData<MessagesData>(chatKeys.messages(conversationId));
  if (!data || data.pages.length === 0) return null;
  const last = data.pages[data.pages.length - 1];
  if (!last || last.hasNewer) return null;
  return messagesOfData(data);
}
