/**
 * The owner's Zaki emoji pack (dolphin stickers, public/brand/zaki-emojis/<id>.webp, 160 px): 32 moods and gestures for the chat, and 16 task-status
 * stickers (`task_<status>`). A message keeps an emoji as a SHORT TEXT CODE, `:zaki_smile:` — never a picture — so messages stay light; the bubble turns a known
 * code into the picture and leaves any other `:zaki_…:` as the plain words it is.
 */
export const ZAKI_EMOJIS = [
  { id: "smile", name: "ابتسامة", category: "مشاعر" },
  { id: "laugh", name: "ضحك", category: "مشاعر" },
  { id: "joy", name: "ضحك لحد الدموع", category: "مشاعر" },
  { id: "love", name: "عيون قلوب", category: "مشاعر" },
  { id: "wink", name: "غمزة", category: "مشاعر" },
  { id: "cool", name: "كوول", category: "مشاعر" },
  { id: "thinking", name: "بفكّر", category: "مشاعر" },
  { id: "idea", name: "فكرة!", category: "مشاعر" },
  { id: "surprised", name: "مصدوم", category: "مشاعر" },
  { id: "sad", name: "زعلان", category: "مشاعر" },
  { id: "cry", name: "بكي", category: "مشاعر" },
  { id: "angry", name: "معصّب", category: "مشاعر" },
  { id: "sleepy", name: "نعسان", category: "مشاعر" },
  { id: "confused", name: "مش فاهم", category: "مشاعر" },
  { id: "shy", name: "خجلان", category: "مشاعر" },
  { id: "wow", name: "منبهر", category: "مشاعر" },
  { id: "hello", name: "أهلاً", category: "حركات" },
  { id: "like", name: "لايك", category: "حركات" },
  { id: "clap", name: "تصفيق", category: "حركات" },
  { id: "heart", name: "بحبك", category: "حركات" },
  { id: "party", name: "احتفال", category: "حركات" },
  { id: "cheer", name: "يلا!", category: "حركات" },
  { id: "rocket", name: "انطلاق", category: "حركات" },
  { id: "king", name: "الملك", category: "حركات" },
  { id: "coffee", name: "صباح الخير", category: "حركات" },
  { id: "money", name: "مصاري", category: "حركات" },
  { id: "fire", name: "نار", category: "حركات" },
  { id: "working", name: "عم بشتغل", category: "حركات" },
  { id: "search", name: "بدوّر", category: "حركات" },
  { id: "salute", name: "حاضر", category: "حركات" },
  { id: "thanks", name: "شكراً", category: "حركات" },
  { id: "kiss", name: "بوسة", category: "حركات" },
] as const;

export type ZakiEmojiId = (typeof ZAKI_EMOJIS)[number]["id"];
export const ZAKI_EMOJI_CATEGORIES = ["مشاعر", "حركات"] as const;

/** The task-status stickers: the status key the owner's pack uses, its Arabic name, the colour of its button and the sticker (`task_<status>`). */
export const ZAKI_TASK_STICKERS = [
  { status: "new", name: "مهمة جديدة", emoji: "task_new" },
  { status: "in_progress", name: "قيد التنفيذ", emoji: "task_in_progress" },
  { status: "done", name: "تم", emoji: "task_done" },
  { status: "urgent", name: "مستعجل", emoji: "task_urgent" },
  { status: "late", name: "متأخرة", emoji: "task_late" },
  { status: "review", name: "مراجعة", emoji: "task_review" },
  { status: "paused", name: "متوقفة", emoji: "task_paused" },
  { status: "cancelled", name: "ملغاة", emoji: "task_cancelled" },
  { status: "help", name: "بحاجة مساعدة", emoji: "task_help" },
  { status: "meeting", name: "اجتماع", emoji: "task_meeting" },
  { status: "waiting", name: "بانتظار رد", emoji: "task_waiting" },
  { status: "priority", name: "أولوية عالية", emoji: "task_priority" },
  { status: "mine", name: "إلي", emoji: "task_mine" },
  { status: "scheduled", name: "مجدولة", emoji: "task_scheduled" },
  { status: "achieved", name: "تحقق الهدف", emoji: "task_achieved" },
  { status: "report", name: "تقرير", emoji: "task_report" },
] as const;

const IDS: ReadonlySet<string> = new Set([...ZAKI_EMOJIS.map((e) => e.id), ...ZAKI_TASK_STICKERS.map((t) => t.emoji)]);

export const zakiCode = (id: string): string => `:zaki_${id}:`;
export const zakiSrc = (id: string): string => `/brand/zaki-emojis/${id}.webp`;
export const isZakiEmoji = (id: string): boolean => IDS.has(id);
export const zakiNameOf = (id: string): string => ZAKI_EMOJIS.find((e) => e.id === id)?.name ?? ZAKI_TASK_STICKERS.find((t) => t.emoji === id)?.name ?? id;

export type ZakiPiece = { text: string; emoji?: undefined } | { emoji: string; text?: undefined };

const CODE = /:zaki_([a-z_]{2,24}):/g;

/** A text cut into plain runs and the Zaki emojis in it (an unknown code stays plain text). Never changes a letter of the plain runs. */
export function splitZakiEmoji(text: string): ZakiPiece[] {
  const out: ZakiPiece[] = [];
  let last = 0;
  for (const m of text.matchAll(CODE)) {
    const id = m[1] as string;
    if (!IDS.has(id)) continue;
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ emoji: id });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

const WHOLE_CODE = /^:zaki_([a-z_]{2,24}):$/;

/** The id of a Zaki code that is the WHOLE string (`:zaki_clap:`, nothing around it) and a known one; null for anything else. The allow-list of a Zaki reaction (S5.6). */
export function zakiIdOfCode(code: string): string | null {
  const id = WHOLE_CODE.exec(code)?.[1];
  return id !== undefined && IDS.has(id) ? id : null;
}

export const isZakiCode = (code: string): boolean => zakiIdOfCode(code) !== null;

/** A text with every known Zaki code turned into its Arabic name in brackets («(احتفال)»): what a push, a list row and a quote say instead of the raw code. Every other letter stays. */
export function zakiToWords(text: string): string {
  if (!text.includes(":zaki_")) return text;
  return splitZakiEmoji(text)
    .map((p) => (p.emoji !== undefined ? `(${zakiNameOf(p.emoji)})` : (p.text ?? "")))
    .join("");
}

/**
 * One emoji of the unicode set: a flag, a keycap, a tag flag, or a pictograph with its variation selector / skin tone and the pieces joined by ZWJ (a family is one).
 * The order matters: the flag and the keycap and the tag flag come before the plain pictograph that would match their first character alone.
 */
const PICTO = String.raw`(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:\u{FE0F}|\p{Emoji_Modifier})*`;
const UNICODE_EMOJI = new RegExp(String.raw`[\u{1F1E6}-\u{1F1FF}]{2}|[0-9#*]\u{FE0F}?\u{20E3}|\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F}|${PICTO}(?:\u{200D}${PICTO})*`, "gu");
/** Symbols that are pictographs in the standard but are words in a message (the copyright and trademark signs): only an emoji when they carry the emoji variation selector. */
const PLAIN_SYMBOL = /^[\u{A9}\u{AE}\u{203C}\u{2049}\u{2122}\u{2139}]$/u;

export type EmojiToken = { zaki: string; glyph?: undefined } | { glyph: string; zaki?: undefined };

/** The emojis of a message that is ONLY emojis (unicode and Zaki codes, spaces between), one token each; null when there is any word, symbol or unknown code in it, or no emoji at all. */
export function emojiTokens(text: string): EmojiToken[] | null {
  const out: EmojiToken[] = [];
  for (const piece of splitZakiEmoji(text.trim())) {
    if (piece.emoji !== undefined) {
      out.push({ zaki: piece.emoji });
      continue;
    }
    const rest = (piece.text ?? "").replace(/\s+/g, "");
    if (!rest) continue;
    const units = rest.match(UNICODE_EMOJI);
    if (!units || units.join("") !== rest) return null;
    if (units.some((u) => PLAIN_SYMBOL.test(u))) return null;
    for (const glyph of units) out.push({ glyph });
  }
  return out.length ? out : null;
}

/**
 * How many emojis a message is made of when it is ONLY emojis — unicode, Zaki codes, or both, with spaces between — and there are one to three; 0 otherwise (words,
 * four or more, an unknown code, a symbol, formatting markers). It decides the jumbo size (S5.6): never a character of the message changes.
 */
export function emojiOnlyCount(text: string): number {
  const tokens = emojiTokens(text);
  return tokens && tokens.length <= 3 ? tokens.length : 0;
}

/** A message that is only Zaki emojis (one to three, spaces between): drawn big like a sticker. */
export function isStickerOnly(text: string): boolean {
  const pieces = splitZakiEmoji(text.trim());
  const stickers = pieces.filter((p) => p.emoji !== undefined).length;
  return stickers >= 1 && stickers <= 3 && pieces.every((p) => p.emoji !== undefined || (p.text ?? "").trim() === "");
}
