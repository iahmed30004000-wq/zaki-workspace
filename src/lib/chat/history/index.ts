/**
 * C1.6 — the history of a conversation for the C2 screen: where it opens, paging in both directions, the jump to a message, the way
 * back to the newest. Hooks and pure functions only; the screen that draws them is C2.4.
 */
export { NEWEST, landingRule, separatorBefore } from "@/lib/chat/history/landing";
export type { Landing, LandingRule } from "@/lib/chat/history/landing";
export { resolveOpening } from "@/lib/chat/history/open";
export type { OpenOptions } from "@/lib/chat/history/open";
export { EDGE_SCREENS, nextLoad } from "@/lib/chat/history/edges";
export type { EdgeState, ScrollMetrics } from "@/lib/chat/history/edges";
export { HIGHLIGHT_MS, JumpSignals, backToNewest, jumpToMessage } from "@/lib/chat/history/jump";
export type { JumpOutcome, JumpState, ScrollSignal, ScrollTarget } from "@/lib/chat/history/jump";
export { useConversationHistory } from "@/lib/chat/history/use-conversation-history";
export type { ConversationHistory } from "@/lib/chat/history/use-conversation-history";
