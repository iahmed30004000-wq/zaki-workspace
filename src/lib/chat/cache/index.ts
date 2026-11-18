/**
 * C1.4 + C1.5 — THE PUBLIC SURFACE of the chat cache. Everything the chat screens need comes from this one barrel; later packages
 * (C1.6 `pages.ts`, C1.8 `pending.ts`, C2) only ADD a file beside it and one export line here, never edit the writer.
 *
 * Read:   useChatList(folder) · useChatRow(id) · useChatHeader(id) · useChatMessages(id) · useChatSpace(spaceId) · useChatUnreadSummary()
 *         and the unread functions (per row, per folder, per space) the hooks are built on.
 * Write:  applySync · appendMessage · replaceMessage · tombstone · applyReads · upsertRows · removeConversation (· markConversationRead)
 *         — the only code in the app that writes a chat key.
 * Sync:   scheduleSync (frames, reconnect, focus after 60 s hidden, online) · syncNow
 * Device: wipeChatCache (sign-out, a different person, the settings button of C4)
 */
export { CHAT_ROOT, chatKeys, convIdOfKey, isChatKey, isHeaderKey, isMessagesKey } from "@/lib/chat/cache/keys";
export { CHAT_FOLDERS, LATEST } from "@/lib/chat/cache/types";
export type {
  ChatFolder,
  ChatListDto,
  ChatListView,
  ChatRowDto,
  ConversationHeaderDto,
  MessageDto,
  MessagesData,
  MessagesPageDto,
  MessagesParam,
  SpaceTopicsDto,
  SyncAnswer,
  SyncDto,
  SyncMessageDto,
  UnreadCount,
} from "@/lib/chat/cache/types";

export {
  applyCatchUp,
  applyReads,
  applySync,
  appendMessage,
  collapseToNewest,
  conversationOfMessage,
  findRow,
  markConversationRead,
  meIdOf,
  newestKnownId,
  refreshMessages,
  removeConversation,
  replaceMessage,
  resetChatCache,
  tombstone,
  upsertRows,
} from "@/lib/chat/cache/writer";
export type { ApplyOutcome } from "@/lib/chat/cache/writer";

export { filterRows, hasUnread, inFolder, summarizeUnread, unreadByFolder, unreadBySpace, unreadOfRow, unreadOfRows } from "@/lib/chat/cache/unread";
export type { UnreadSummary } from "@/lib/chat/cache/unread";

export { CHAT_GC_MS, CHAT_STALE_MS } from "@/lib/chat/cache/constants";
export { headerQueryOptions, listQueryOptions, messagesQueryOptions, messagesRequestUrl, spaceQueryOptions } from "@/lib/chat/cache/queries";
export { useChatHeader, useChatList, useChatMessages, useChatRow, useChatSpace, useChatUnreadSummary } from "@/lib/chat/cache/selectors";

export { chatRuntimeOf, ensureChatCache, frameWantsSync, scheduleSync, syncNow } from "@/lib/chat/cache/runtime";
export { SYNC_COALESCE_MS, SYNC_LIMIT } from "@/lib/chat/cache/sync";

export { HOVER_PREFETCH_MS, STARTUP_PREFETCH_COUNT, createHoverPrefetch, prefetchConversation, prefetchStartup, startupCandidates } from "@/lib/chat/cache/prefetch";

export { markConversationOpened } from "@/lib/chat/cache/opened";
export { wipeChatCache } from "@/lib/chat/cache/wipe";
export { ChatCacheDriver } from "@/lib/chat/cache/driver";

// C1.6: the windows as a model, replacing them as a whole (the unread landing, the jump), and the ten-window cap
export { fetchWindow, hasMessage, isNotFound, pageIndexOf, reachesNewest, reachesOldest, showAround, showNewest, showWindow, singleWindow } from "@/lib/chat/cache/pages";
export { MAX_PAGES, trimMessages, trimPages, viewportPageOf } from "@/lib/chat/cache/trim";
export type { Trimmed } from "@/lib/chat/cache/trim";
