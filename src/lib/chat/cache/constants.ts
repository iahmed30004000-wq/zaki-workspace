/** How long a chat query is believed: the safety period of the live line. The sync feed keeps it fresh in between. */
export const CHAT_STALE_MS = 300_000;
/**
 * A conversation nobody looks at is forgotten after six hours. The device copy is written from what memory holds, so a short time
 * here would shrink it in a tab left open; a conversation is about 100 KB, and the window of one is capped (C1.6).
 */
export const CHAT_GC_MS = 6 * 3_600_000;
