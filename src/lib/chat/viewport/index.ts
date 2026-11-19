/**
 * C1.7 — the virtualized message viewport for the C2 screen: the rows, the sizes a row reserves before it is drawn, the scroll anchor
 * arithmetic, and the hook that ties them to `@tanstack/react-virtual`. Hooks and pure functions only; the screen is C2.4.
 */
export { OVERSCAN } from "@/lib/chat/viewport/config";
export { buildRows, messagesOfRow, rowIndexOfMessage, scrollRowIndex } from "@/lib/chat/viewport/rows";
export { CALL_KEYS, FOLD_MIN_LINES, callCount, callRuns, isCallLine } from "@/lib/chat/viewport/calls";
export type { Row } from "@/lib/chat/viewport/rows";
export { CALLS_ROW_PX, DAY_ROW_PX, FALLBACK_ASPECT, IMAGE_MAX_H, IMAGE_MAX_W, UNREAD_ROW_PX, VOICE_ROW_PX, estimateRowHeight, imageBox } from "@/lib/chat/viewport/sizes";
export { captureAnchor, restoredScrollTop, shouldRestore } from "@/lib/chat/viewport/anchor";
export type { Anchor, AnchorItem } from "@/lib/chat/viewport/anchor";
export { newestArrival } from "@/lib/chat/viewport/arrival";
export { useMessageViewport } from "@/lib/chat/viewport/use-message-viewport";
export type { MessageViewport, MessageViewportOptions } from "@/lib/chat/viewport/use-message-viewport";
