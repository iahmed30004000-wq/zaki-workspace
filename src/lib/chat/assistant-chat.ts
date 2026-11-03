/**
 * «المساعد» كجهة اتصال — the pure part (no database): how a person's conversation with the assistant is named and recognised.
 * The conversation is a restricted topic whose `dmKey` is `assistant|<userId>@<spaceId>`. See src/server/services/assistant-chat.ts.
 */
export const ASSISTANT_CHAT_PREFIX = "assistant|";
export const ASSISTANT_CHAT_TITLE = "المساعد";
export const ASSISTANT_CHAT_EMOJI = "✨";

export const assistantChatKey = (userId: string, spaceId: string): string => `${ASSISTANT_CHAT_PREFIX}${userId}@${spaceId}`;

/** Is this `dmKey` the assistant conversation of this very person? */
export const isAssistantChatOf = (dmKey: string | null | undefined, userId: string): boolean => typeof dmKey === "string" && dmKey.startsWith(`${ASSISTANT_CHAT_PREFIX}${userId}@`);

/** Is it an assistant conversation at all (of anybody)? */
export const isAssistantChatKey = (dmKey: string | null | undefined): boolean => typeof dmKey === "string" && dmKey.startsWith(ASSISTANT_CHAT_PREFIX);
