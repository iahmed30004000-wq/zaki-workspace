/**
 * C2.5 — the picker's data is Emojibase's English set (frimousse has no Arabic locale), so a category arrives with an English label. The screen shows the
 * Arabic name of the nine groups; this file only recognises which group a label is (the words are the dictionary's, in the component).
 */
export type EmojiGroup = "smileys" | "people" | "animals" | "food" | "travel" | "activities" | "objects" | "symbols" | "flags";

const PREFIXES: Array<[string, EmojiGroup]> = [
  ["smileys", "smileys"],
  ["people", "people"],
  ["animals", "animals"],
  ["food", "food"],
  ["travel", "travel"],
  ["activities", "activities"],
  ["objects", "objects"],
  ["symbols", "symbols"],
  ["flags", "flags"],
];

export function emojiGroupOf(label: string): EmojiGroup | null {
  const folded = String(label ?? "").trim().toLowerCase();
  for (const [prefix, group] of PREFIXES) if (folded.startsWith(prefix)) return group;
  return null;
}
