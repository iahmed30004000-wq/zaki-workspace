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
  { status: "new", name: "مهمة جديدة", color: "#22C3E6", emoji: "task_new" },
  { status: "in_progress", name: "قيد التنفيذ", color: "#2F80ED", emoji: "task_in_progress" },
  { status: "done", name: "تم", color: "#18B566", emoji: "task_done" },
  { status: "urgent", name: "مستعجل", color: "#E5383B", emoji: "task_urgent" },
  { status: "late", name: "متأخرة", color: "#E8590C", emoji: "task_late" },
  { status: "review", name: "مراجعة", color: "#7B5CFA", emoji: "task_review" },
  { status: "paused", name: "متوقفة", color: "#E0A100", emoji: "task_paused" },
  { status: "cancelled", name: "ملغاة", color: "#64748B", emoji: "task_cancelled" },
  { status: "help", name: "بحاجة مساعدة", color: "#EC4899", emoji: "task_help" },
  { status: "meeting", name: "اجتماع", color: "#0E86AE", emoji: "task_meeting" },
  { status: "waiting", name: "بانتظار رد", color: "#8A9BB0", emoji: "task_waiting" },
  { status: "priority", name: "أولوية عالية", color: "#C9184A", emoji: "task_priority" },
  { status: "mine", name: "إلي", color: "#3B5BDB", emoji: "task_mine" },
  { status: "scheduled", name: "مجدولة", color: "#4361EE", emoji: "task_scheduled" },
  { status: "achieved", name: "تحقق الهدف", color: "#D4A017", emoji: "task_achieved" },
  { status: "report", name: "تقرير", color: "#0FA3A3", emoji: "task_report" },
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

/** A message that is only Zaki emojis (one to three, spaces between): drawn big like a sticker. */
export function isStickerOnly(text: string): boolean {
  const pieces = splitZakiEmoji(text.trim());
  const stickers = pieces.filter((p) => p.emoji !== undefined).length;
  return stickers >= 1 && stickers <= 3 && pieces.every((p) => p.emoji !== undefined || (p.text ?? "").trim() === "");
}
