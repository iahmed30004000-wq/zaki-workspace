import type { ChatListSearchDto, ChatHitDto, PersonHitDto } from "@/server/chat/search";
import type { MessageHitDto } from "@/server/chat/dto";
import { cleanQuery } from "@/lib/search/arabic";
import { chatHref } from "@/lib/chat/v2/routes";

/**
 * C3d — the chat list's search, the pure half. ONE request (`GET /api/search?scope=chat&q=`) answers chats, people and messages; the list's own rows still narrow by
 * the typed words at once (`rowMatches`), and these results sit over them.
 */
export const LIST_SEARCH_MIN = 2;

/** The words that are sent: cleaned like the server cleans them; null while there are fewer than two letters (nothing is asked). */
export function listSearchWords(typed: string): string | null {
  const words = cleanQuery(typed);
  return Array.from(words).length >= LIST_SEARCH_MIN ? words : null;
}

export function listSearchUrl(words: string): string {
  return `/api/search?scope=chat&q=${encodeURIComponent(words)}`;
}

export const hasListResults = (data: ChatListSearchDto | null): boolean => !!data && data.chats.length + data.people.length + data.messages.length > 0;

/** Where a chat result opens: a topic or a private chat is its conversation, a space is its forum view. */
export const chatHitHref = (chat: ChatHitDto): string => (chat.kind === "SPACE" ? chatHref.forum(chat.id) : chatHref.conversation(chat.id));

/** A message result opens its conversation around that message (`?m=`, the address a search hit or a notification has always used). */
export const messageHitHref = (hit: Pick<MessageHitDto, "id" | "conversationId">): string => `${chatHref.conversation(hit.conversationId)}?m=${encodeURIComponent(hit.id)}`;

/** A person with a private chat open goes straight there; without one the person's row asks the server to open it (a guest's row has no such door at all). */
export const personHitHref = (person: PersonHitDto): string | null => (person.dmId ? chatHref.conversation(person.dmId) : null);

/** A guest's row carries the name only (no `dmId` key at all): nothing to open. */
export const personOpensChat = (person: PersonHitDto): boolean => "dmId" in person;
