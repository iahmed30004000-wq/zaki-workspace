/**
 * C1.4 — the keys of the chat cache (TanStack Query). The whole family starts with "chat": a guard test
 * (`tests/chat-cache-writer.test.ts`) fails on a `setQueryData` on any of them from outside `src/lib/chat/cache/`.
 *
 *   ["chat","list"]                      the one list: every space (as a forum row) and every private chat
 *   ["chat","space",spaceId]             the forum view of one space: its topics
 *   ["chat","conv",id,"header"]          one conversation's header (title, me-flags, pinned bar, switches)
 *   ["chat","conv",id,"messages"]        one conversation's messages: an infinite query, windows of 50
 */
export const CHAT_ROOT = "chat" as const;

export const chatKeys = {
  all: () => [CHAT_ROOT] as const,
  list: () => [CHAT_ROOT, "list"] as const,
  spaces: () => [CHAT_ROOT, "space"] as const,
  space: (spaceId: string) => [CHAT_ROOT, "space", spaceId] as const,
  convs: () => [CHAT_ROOT, "conv"] as const,
  conv: (id: string) => [CHAT_ROOT, "conv", id] as const,
  header: (id: string) => [CHAT_ROOT, "conv", id, "header"] as const,
  messages: (id: string) => [CHAT_ROOT, "conv", id, "messages"] as const,
};

export function isChatKey(key: readonly unknown[]): boolean {
  return key[0] === CHAT_ROOT;
}

/** The conversation a `["chat","conv",id,...]` key belongs to, or null. */
export function convIdOfKey(key: readonly unknown[]): string | null {
  return key[0] === CHAT_ROOT && key[1] === "conv" && typeof key[2] === "string" ? key[2] : null;
}

/** Is this the messages query of some conversation? */
export function isMessagesKey(key: readonly unknown[]): boolean {
  return convIdOfKey(key) !== null && key[3] === "messages";
}

export function isHeaderKey(key: readonly unknown[]): boolean {
  return convIdOfKey(key) !== null && key[3] === "header";
}
