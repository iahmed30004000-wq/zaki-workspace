/**
 * «ترجمة رسالة» — the pure part: which language a message is translated INTO, and how long a message may be. No database, no network.
 * The server decides the target (src/server/services/message-translate.ts); the screen never names it.
 */

/** The longest message that is translated (characters): a longer one is refused, not cut. */
export const TRANSLATE_MAX_CHARS = 2_000;

export type TranslateTarget = "ar" | "en";

const ARABIC_LETTER = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;

/**
 * Arabic unless the text is mostly Arabic (more Arabic letters than letters of any other script), then English. Text with no letters at all
 * (digits, emoji) has no language: null, and the caller says «nothing to translate».
 */
export function translateTargetOf(text: string): TranslateTarget | null {
  const arabic = (text.match(ARABIC_LETTER) ?? []).length;
  const other = (text.match(/\p{L}/gu) ?? []).length - arabic;
  if (arabic === 0 && other <= 0) return null;
  return arabic > other ? "en" : "ar";
}
