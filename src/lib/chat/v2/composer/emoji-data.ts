import type { EmojiData, EmojiDataResolver } from "frimousse";

type EmojiDataEmoji = EmojiData["emojis"][number];

/**
 * C2.5 — the emoji picker's data, from the `emojibase-data` package that is already a dependency, so the picker asks no third-party address (frimousse's
 * default is a CDN, which would tell it every person's address). The set is read with a dynamic import: its chunk is fetched from OUR server the first time
 * the picker opens. Emojis newer than `MAX_EMOJI_VERSION` are left out (a phone older than that would draw an empty box); the skin-tone components and the
 * lone regional letters are left out too (they are no emoji to pick).
 */
export const MAX_EMOJI_VERSION = 14;

interface RawEmoji {
  emoji: string;
  label: string;
  group?: number;
  tags?: string[];
  version: number;
  order?: number;
  skins?: Array<{ emoji: string; tone?: number | number[] }>;
}

/** Emojibase's group number → the category (the English names are what `emoji-groups.ts` recognises; the screen shows the Arabic ones). */
const CATEGORIES: Array<{ index: number; label: string }> = [
  { index: 0, label: "Smileys & Emotion" },
  { index: 1, label: "People & Body" },
  { index: 3, label: "Animals & Nature" },
  { index: 4, label: "Food & Drink" },
  { index: 5, label: "Travel & Places" },
  { index: 6, label: "Activities" },
  { index: 7, label: "Objects" },
  { index: 8, label: "Symbols" },
  { index: 9, label: "Flags" },
];
const TONE_KEYS = ["light", "medium-light", "medium", "medium-dark", "dark"] as const;
const SKIN_TONES = { light: "🏻", "medium-light": "🏼", medium: "🏽", "medium-dark": "🏾", dark: "🏿" } as const;

export function toEmojiData(raw: readonly RawEmoji[]): EmojiData {
  const known = new Set(CATEGORIES.map((c) => c.index));
  const emojis: EmojiDataEmoji[] = [];
  for (const e of [...raw].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    if (e.group === undefined || !known.has(e.group) || e.version > MAX_EMOJI_VERSION) continue;
    const skins: Record<string, string> = {};
    for (const s of e.skins ?? []) if (typeof s.tone === "number" && s.tone >= 1 && s.tone <= 5) skins[TONE_KEYS[s.tone - 1]!] = s.emoji;
    const hasAllTones = TONE_KEYS.every((key) => skins[key]);
    emojis.push({ emoji: e.emoji, category: e.group, label: e.label, version: e.version, tags: e.tags ?? [], ...(hasAllTones ? { skins: skins as NonNullable<EmojiDataEmoji["skins"]> } : {}) });
  }
  return { locale: "en", emojis, categories: CATEGORIES, skinTones: { ...SKIN_TONES } };
}

export const resolveBundledEmojiData: EmojiDataResolver = async () => {
  const set = await import("emojibase-data/en/data.json");
  return toEmojiData(set.default as unknown as RawEmoji[]);
};
