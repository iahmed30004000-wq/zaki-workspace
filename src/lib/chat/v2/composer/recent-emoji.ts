import { browserStorage, type DraftStorage } from "@/lib/cards/draft";

/**
 * C2.5 — the emojis a person used last, kept in localStorage on THIS device (no server, no name, no conversation: only the emoji characters). Every access is
 * inside try/catch: storage may be missing, full or blocked, and the picker works the same without it.
 */
export const RECENT_EMOJI_KEY = "zaki.chat-emoji-recent.v1";
export const MAX_RECENT_EMOJI = 24;
const MAX_LENGTH = 32; // a family or a flag is a few code points, never a sentence

const sane = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= MAX_LENGTH && !/\s/.test(value);

export function loadRecentEmoji(storage: DraftStorage | null = browserStorage()): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RECENT_EMOJI_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(sane).slice(0, MAX_RECENT_EMOJI) : [];
  } catch {
    return [];
  }
}

/** The new list (newest first, no duplicate, at most 24); it is stored when the device lets it. */
export function rememberEmoji(emoji: string, storage: DraftStorage | null = browserStorage()): string[] {
  if (!sane(emoji)) return loadRecentEmoji(storage);
  const next = [emoji, ...loadRecentEmoji(storage).filter((e) => e !== emoji)].slice(0, MAX_RECENT_EMOJI);
  try {
    storage?.setItem(RECENT_EMOJI_KEY, JSON.stringify(next));
  } catch {
    /* the list lives until the page closes */
  }
  return next;
}
