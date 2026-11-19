import { CHAT_REACTIONS } from "@/lib/chat-reactions";

/**
 * C2.6 — the six quick reactions on top of the message menu. They are TODAY'S six (`CHAT_REACTIONS`) until the person's own choice exists: C4 adds
 * «التفاعل السريع» (pick the six) to the settings, and its value is what `quickReactionsOf` is given. The server accepts any single emoji (at most 12
 * distinct per message), so the bar and the full picker both go through the same react door.
 */
export const QUICK_COUNT = 6;

/** One emoji and nothing else: no spaces, no letters or digits, one grapheme at the start that is an emoji (the server checks again). */
function isOneEmoji(value: string): boolean {
  if (!value || value.length > 16 || /\s/.test(value) || /[\p{L}\p{N}]/u.test(value)) return false;
  return /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})/u.test(value);
}

/** The person's six when they are six distinct single emojis; today's six otherwise (a short, long, repeated or non-emoji list is never half-used). */
export function quickReactionsOf(preference?: readonly string[] | null): readonly string[] {
  if (preference && preference.length === QUICK_COUNT && preference.every(isOneEmoji) && new Set(preference).size === QUICK_COUNT) return [...preference];
  return [...CHAT_REACTIONS];
}
