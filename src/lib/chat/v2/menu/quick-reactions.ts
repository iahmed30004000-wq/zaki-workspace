import { CHAT_REACTIONS } from "@/lib/chat-reactions";
import { QUICK_REACTION_COUNT, isOneEmoji } from "@/lib/chat/prefs";
import { readDevicePrefs } from "@/lib/device-prefs";

/**
 * C2.6 — the six quick reactions on top of the message menu. They are TODAY'S six (`CHAT_REACTIONS`) until the person picks their own: C4.1's «التفاعل السريع»
 * (`User.chatPrefs.chat.quickReactions`, mirrored on the device) is what `quickReactionsOf` is given. The server accepts any single emoji (at most 12
 * distinct per message), so the bar and the full picker both go through the same react door.
 */
export const QUICK_COUNT = QUICK_REACTION_COUNT;

/** What the settings screen offers for a slot (every entry is one emoji, none repeated): today's six first, then the ones people reach for. */
export const QUICK_PALETTE: readonly string[] = [...CHAT_REACTIONS, "😮", "😢", "🙏", "👏", "💯", "✅", "🤔", "😍", "😎", "🤝", "💪", "⭐", "🚀", "👌", "😅", "🙌"];

/** The person's six when they are six distinct single emojis; today's six otherwise (a short, long, repeated or non-emoji list is never half-used). */
export function quickReactionsOf(preference?: readonly string[] | null): readonly string[] {
  // no preference ASKED (undefined): this device's copy of the person's choice (C4.1, `zk-device-prefs`); `null` is an explicit «none»
  if (preference === undefined) preference = readDevicePrefs().mirror?.quickReactions;
  if (preference && preference.length === QUICK_COUNT && preference.every(isOneEmoji) && new Set(preference).size === QUICK_COUNT) return [...preference];
  return [...CHAT_REACTIONS];
}

/**
 * The emoji of the phone's double tap (`chat.doubleTap`), or null when the person chose none: a double tap that nobody asked for would send a reaction the
 * others see, so «بدون» is the default. Anything that is not one emoji is none.
 */
export function doubleTapEmojiOf(preference?: string | null): string | null {
  return isOneEmoji(preference) ? preference : null;
}

/** Does a double tap put `emoji` on this message? Not when there is none, and not when the person's own reaction with it is already there (a double tap never takes one away). */
export function shouldQuickReact(emoji: string | null, reactions: ReadonlyArray<{ emoji: string; mine: boolean }>): emoji is string {
  return emoji !== null && !reactions.some((r) => r.emoji === emoji && r.mine);
}

/**
 * What a double tap puts on a message: the person's emoji (`doubleTapEmojiOf`), or null when there is none, when their own reaction with it is already there, or when
 * they may not post here (the bubble asks only where it may act; the server decides again).
 */
export function doubleTapReactionOf(i: { preference?: string | null; reactions: ReadonlyArray<{ emoji: string; mine: boolean }>; canPost: boolean }): string | null {
  if (!i.canPost) return null;
  const emoji = doubleTapEmojiOf(i.preference);
  return shouldQuickReact(emoji, i.reactions) ? emoji : null;
}

/**
 * The phone's DOUBLE TAP, as a pure tracker over the touch presses of ONE bubble: `last` is the previous tap (or null), `up` the pointer that just went up. A tap is
 * a quick press of a FINGER (a long press is the sheet's; a pen and a mouse are not taps — a double CLICK only replies) on something that does not do its own
 * thing (a link, a button, a player, a field). The second tap within `DOUBLE_TAP_MS` and `DOUBLE_TAP_SLOP` pixels of the first is a double tap and resets the
 * tracker (a third tap starts again).
 */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP = 30;
export const TAP_MAX_MS = 250;
const OWN_THING = "a,button,input,textarea,select,video,audio,summary,[role=button],[data-no-reply]";
export interface TapPoint {
  at: number;
  x: number;
  y: number;
}

export function touchTap(
  last: TapPoint | null,
  up: { pointerType: string; target: EventTarget | null; at: number; x: number; y: number; downAt: number },
): { last: TapPoint | null; double: boolean } {
  if (up.pointerType !== "touch") return { last: null, double: false };
  const target = up.target as { closest?: (selector: string) => unknown } | null;
  if (target && typeof target.closest === "function" && target.closest(OWN_THING)) return { last: null, double: false };
  if (up.at - up.downAt > TAP_MAX_MS) return { last: null, double: false };
  if (last && up.at - last.at <= DOUBLE_TAP_MS && Math.hypot(up.x - last.x, up.y - last.y) <= DOUBLE_TAP_SLOP) return { last: null, double: true };
  return { last: { at: up.at, x: up.x, y: up.y }, double: false };
}
