/**
 * «حركات الإيموجي» — the animated drawings of the most used emojis: Google's Noto Animated Emoji (CC BY 4.0, see public/emoji/anim/LICENSE.txt), served by
 * this app itself (public/emoji/anim/<code>.webp), so nothing is asked of anybody else while the app is used. An emoji without a drawing stays the plain
 * character it was. The files are the ones downloaded on 2026-11-27 on the owner's word; the list is exactly the folder (a test keeps the two equal).
 */
export const ANIMATED_EMOJI_CODES: readonly string[] = [
  "1f44d", "2764_fe0f", "1f602", "1f389", "1f525", "1f440", "1f44f", "1f4a1", "1f62e", "1f923", "1f62d", "1f64f", "1f618", "1f970", "1f60d", "1f60a", "1f601", "1f605", "1f606", "1f609",
  "1f642", "1f603", "1f604", "1f60e", "1f60b", "1f60f", "1f614", "1f622", "1f621", "1f631", "1f633", "1f634", "1f62f", "1f644", "1f914", "1f917", "1f929", "1f92f", "1f973", "1f97a",
  "1fae1", "1f91d", "1f44c", "1f4aa", "1f44e", "1f4af", "2728", "1f680", "2b50", "2705",
];

/** The code points of a glyph without the «draw me as a picture» mark (U+FE0F), which one keyboard adds and another leaves out. */
const bare = (code: string): string => code.split("_").filter((part) => part !== "fe0f").join("_");
const keyOfGlyph = (glyph: string): string => bare([...glyph].map((c) => (c.codePointAt(0) ?? 0).toString(16)).join("_"));
const BY_KEY: ReadonlyMap<string, string> = new Map(ANIMATED_EMOJI_CODES.map((code) => [bare(code), code]));

/** The address of the emoji's drawing, or null when it has none. A skin tone or a joined emoji has none: it is never swapped for a different one. */
export function emojiAnimationOf(glyph: string): string | null {
  const code = BY_KEY.get(keyOfGlyph(glyph));
  return code ? `/emoji/anim/${code}.webp` : null;
}

/** The page's event for «the other person played this emoji»: the message's id travels in `detail`. */
export const EMOJI_EFFECT_EVENT = "zk:emoji-effect";
