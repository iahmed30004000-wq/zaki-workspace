import type { InfiniteData } from "@tanstack/react-query";
import type {
  ChatListDto,
  ChatRowDto,
  ChatRowKind,
  ConversationHeaderDto,
  MessageDto,
  MessagesPageDto,
  ReaderDto,
  SpaceTopicsDto,
  SyncDto,
} from "@/server/chat/dto";

export type { ChatListDto, ChatRowDto, ChatRowKind, ConversationHeaderDto, MessageDto, MessagesPageDto, ReaderDto, SpaceTopicsDto, SyncDto };

/**
 * The built-in folders of the list («الكل · غير مقروء · خاص · المساحات · ذكروني»). They are not stored: each is a filter over the
 * list cache (C3 adds the person's own folders on top).
 */
export type ChatFolder = "all" | "unread" | "dm" | "spaces" | "mentions";
export const CHAT_FOLDERS: readonly ChatFolder[] = ["all", "unread", "dm", "spaces", "mentions"];

/**
 * A message of a sync answer. The server's `MessageDto` does not say which conversation it belongs to (C1.2); the day it does, the
 * field is read here and the message goes straight to its window. Until then the cache finds the message by id (an edit, a deletion,
 * a reaction) or by the list row it is the newest message of (a new one) — see `writer.ts`.
 */
export type SyncMessageDto = MessageDto & { conversationId?: string };
export type SyncAnswer = Omit<SyncDto, "messages"> & { messages: SyncMessageDto[] };

/** Which window of a conversation a page is: the newest, the one before / after a message, or the one around it. */
export type MessagesParam = { kind: "latest" } | { kind: "before" | "after" | "around"; id: string };
export const LATEST: MessagesParam = { kind: "latest" };

export type MessagesData = InfiniteData<MessagesPageDto, MessagesParam>;

/** What the chat list screen draws for one folder. */
export interface ChatListView {
  scope: ChatListDto["scope"];
  spaceId: string | null;
  canOversee: boolean;
  rows: ChatRowDto[];
}

export interface UnreadCount {
  /** the unread messages of the rows */
  messages: number;
  /** how many rows have something unread */
  chats: number;
  /** the rows where somebody mentioned me and I did not read it */
  mentions: number;
}
