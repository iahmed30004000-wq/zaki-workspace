import { emojiTokens } from "@/lib/chat/zaki-emoji";

/**
 * «تيليجرام على التلفون» — while the box holds ONE emoji, our own stickers that mean the same are offered above it. Only then: a sticker replaces what is in
 * the box, so words are never lost. A small map on the device; nothing is asked of anybody.
 */
export const STICKERS_FOR: Readonly<Record<string, readonly string[]>> = {
  "😂": ["joy", "laugh"],
  "🤣": ["joy", "laugh"],
  "😆": ["laugh", "joy"],
  "😄": ["laugh", "smile"],
  "😁": ["laugh", "smile"],
  "😀": ["smile", "laugh"],
  "😃": ["smile", "laugh"],
  "😊": ["smile", "shy"],
  "🙂": ["smile"],
  "😍": ["love", "heart"],
  "🥰": ["love", "heart"],
  "❤️": ["heart", "love"],
  "💙": ["heart", "love"],
  "😘": ["kiss", "love"],
  "💋": ["kiss"],
  "😉": ["wink"],
  "😎": ["cool"],
  "🤔": ["thinking", "search"],
  "💡": ["idea"],
  "😮": ["surprised", "wow"],
  "😲": ["surprised", "wow"],
  "😱": ["surprised"],
  "🤩": ["wow", "party"],
  "😢": ["sad", "cry"],
  "😞": ["sad"],
  "😭": ["cry", "sad"],
  "😠": ["angry"],
  "😡": ["angry"],
  "😴": ["sleepy"],
  "🥱": ["sleepy"],
  "😕": ["confused"],
  "🤷": ["confused"],
  "😳": ["shy", "surprised"],
  "☺️": ["shy", "smile"],
  "👋": ["hello"],
  "👍": ["like", "salute"],
  "👏": ["clap", "cheer"],
  "🎉": ["party", "cheer"],
  "🥳": ["party", "cheer"],
  "💪": ["cheer", "working"],
  "🚀": ["rocket"],
  "👑": ["king"],
  "☕": ["coffee"],
  "💰": ["money"],
  "💵": ["money"],
  "🤑": ["money"],
  "🔥": ["fire"],
  "💻": ["working"],
  "🔍": ["search"],
  "🫡": ["salute"],
  "🙏": ["thanks"],
  "✅": ["task_done"],
  "⏰": ["task_late", "task_scheduled"],
};

/** The same emoji with and without its picture selector or a skin tone is one emoji. */
const bare = (glyph: string) => glyph.replace(/[\u{FE0F}\u{1F3FB}-\u{1F3FF}]/gu, "");
const BY_BARE: ReadonlyMap<string, readonly string[]> = new Map(Object.entries(STICKERS_FOR).map(([glyph, ids]) => [bare(glyph), ids] as const));
const NONE: readonly string[] = [];

export function suggestedStickers(body: string): readonly string[] {
  const text = body.trim();
  if (!text || text.length > 16) return NONE;
  const tokens = emojiTokens(text);
  const glyph = tokens?.length === 1 ? tokens[0]!.glyph : undefined;
  return glyph === undefined ? NONE : (BY_BARE.get(bare(glyph)) ?? NONE);
}
