import type { EmojiData } from "frimousse";

/**
 * C2.6 — the full picker's emoji, from the `emojibase-data` package that is already installed (bundled and loaded only when the picker opens), instead of
 * the package's default of fetching them from a public CDN: no request to another site, and it works offline. Pure: it takes the dataset's own rows.
 *
 *  - only rows that belong to a category (the dataset also lists flag letters on their own), without the skin-tone components (group 2): a tone is a
 *    setting this picker does not have;
 *  - nothing newer than `MAX_EMOJI_VERSION`: a newer emoji draws as an empty box on a browser that does not know it yet;
 *  - the dataset's own order; the category labels are the caller's words (this file has no Arabic).
 */
export const MAX_EMOJI_VERSION = 14;
const COMPONENT_GROUP = 2;

export interface EmojibaseRow {
  emoji: string;
  label: string;
  group?: number;
  order?: number;
  version: number;
  tags?: string[];
}

export function emojiDataOf(rows: readonly EmojibaseRow[], opts: { categoryLabel: (group: number) => string }): EmojiData {
  const kept = rows
    .filter((row): row is EmojibaseRow & { group: number } => typeof row.group === "number" && row.group !== COMPONENT_GROUP && row.version <= MAX_EMOJI_VERSION)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const groups = [...new Set(kept.map((row) => row.group))].sort((a, b) => a - b);
  return {
    locale: "en",
    emojis: kept.map((row) => ({ emoji: row.emoji, category: row.group, label: row.label, version: row.version, tags: row.tags ?? [] })),
    categories: groups.map((index) => ({ index, label: opts.categoryLabel(index) })),
    skinTones: { dark: "", light: "", medium: "", "medium-dark": "", "medium-light": "" },
  };
}
