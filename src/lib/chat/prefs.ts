import { z } from "zod";

/**
 * C3a.2 — the person's chat preferences: `User.chatPrefs`, ONE nullable JSON column and ONE zod schema (this file). Pure: no React, no server import,
 * so the screens, the route and the tests share the same rules.
 *
 *  - An empty object is a valid «all defaults»: every field is optional and its default lives in code (`resolveChatPrefs`).
 *  - The folders (C3a.2) are keyed by company id, at most 10 per company. The sections `notifications` and `chat` are room for C4.1 (a plain bounded map
 *    until C4.1 gives them their fields), `voiceSpeed` is C3b.4's, `tabs` holds the built-in tabs the person hid (C4.1 may add the order of the tabs beside it).
 *    What stays on the device (auto-download, cache size) is NOT here: it lives in `localStorage` `zk-device-prefs`.
 *  - Writing is strict (`chatPrefsSchema` / `chatPrefsPatchSchema`: known keys only, bounded sizes), reading is forgiving (`readChatPrefs`: whatever is
 *    wrong is dropped, the rest is kept), and a save is a PATCH (`mergeChatPrefs`): a section not named stays, `null` puts one back to its default.
 *  - A folder stores ids only (never a title): the screen shows only the rows of the C1 list cache, so a chat the person can no longer read shows nothing.
 */

export const CHAT_PREFS_MAX_BYTES = 64 * 1024;
export const MAX_FOLDERS = 10;
export const FOLDER_NAME_MAX = 12;
export const FOLDER_EMOJI_MAX = 8;
export const MAX_FOLDER_CHATS = 100;
export const MAX_FOLDER_SPACES = 50;
/** A person belongs to a handful of companies; this only bounds what a save may carry. */
export const MAX_FOLDER_COMPANIES = 20;

/** The built-in tabs of the list that the person may hide (never stored as folders). */
export const BUILTIN_TABS = ["all", "unread", "dm", "spaces", "mentions"] as const;
export type BuiltinTab = (typeof BUILTIN_TABS)[number];

/** Voice note speeds (C3b.4): 1× / 1.5× / 2×. */
export const VOICE_SPEEDS = [1, 1.5, 2] as const;
export type VoiceSpeed = (typeof VOICE_SPEEDS)[number];
export const DEFAULT_VOICE_SPEED: VoiceSpeed = 1;

/** The speed button of a voice note: 1 → 1.5 → 2 → 1 (a value that is not in the list starts again at 1.5). */
export function nextVoiceSpeed(current: VoiceSpeed): VoiceSpeed {
  const at = VOICE_SPEEDS.indexOf(current);
  return at < 0 ? VOICE_SPEEDS[1] : VOICE_SPEEDS[(at + 1) % VOICE_SPEEDS.length]!;
}

/** An id the code made (cuid, or a folder's id): plain characters, never starting with an underscore (so `__proto__` is no key). */
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const idSchema = z.string().regex(ID, "chatprefs.bad_id");
const FOLDER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

const codePoints = (value: string): number => [...value].length;
const unique = (list: readonly string[]): boolean => new Set(list).size === list.length;
const dedupe = (list: string[]): string[] => [...new Set(list)];

const nameSchema = z
  .string()
  .trim()
  .min(1, "chatprefs.name_empty")
  .refine((s) => codePoints(s) <= FOLDER_NAME_MAX, "chatprefs.name_too_long")
  // no control characters, and nothing that makes a name read backwards (bidi overrides and isolates) or vanish (zero-width space, the byte-order mark); the joiners of Persian and Arabic stay
  .refine((s) => !/[\p{Cc}\u200B\u202A-\u202E\u2066-\u2069\uFEFF]/u.test(s), "chatprefs.name_bad");

/** An emoji: a few symbols, never letters, digits, spaces or control characters. */
const emojiSchema = z
  .string()
  .min(1, "chatprefs.emoji_bad")
  .refine((s) => codePoints(s) <= FOLDER_EMOJI_MAX, "chatprefs.emoji_bad")
  .refine((s) => !/[\p{L}\p{N}\p{Cc}\s]/u.test(s), "chatprefs.emoji_bad");

const flag = z.boolean().optional();

export const chatFolderSchema = z
  .object({
    id: z.string().regex(FOLDER_ID, "chatprefs.bad_id"),
    name: nameSchema,
    emoji: emojiSchema.optional(),
    include: z
      .object({
        dms: flag,
        spaces: flag,
        mentions: flag,
        conversationIds: z.array(idSchema).max(MAX_FOLDER_CHATS, "chatprefs.too_many_chats").transform(dedupe).default([]),
        spaceIds: z.array(idSchema).max(MAX_FOLDER_SPACES, "chatprefs.too_many_spaces").transform(dedupe).default([]),
      })
      .strict()
      .default({}),
    exclude: z.object({ muted: flag, read: flag, archived: flag }).strict().default({}),
  })
  .strict();

export type ChatFolderDef = z.infer<typeof chatFolderSchema>;

const folderListSchema = z
  .array(chatFolderSchema)
  .max(MAX_FOLDERS, "chatprefs.too_many_folders")
  .refine((list) => unique(list.map((f) => f.id)), "chatprefs.duplicate_folder");

const tabsSchema = z
  .object({
    hidden: z
      .array(z.enum(BUILTIN_TABS))
      .max(BUILTIN_TABS.length)
      .refine(unique, "chatprefs.duplicate_tab")
      .optional(),
  })
  .strict();

const KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

// ───────────────────────────────────────── C4.1: the sections of «إعداداتي» ─────────────────────────────────────────

/**
 * The five kinds of chat notification a person can switch (C4 §3): a private chat, a topic, a mention («@» and «@الكل»), a reply to me, a call.
 * Each has a rule with two flags, both optional (default ON): `on` (off = nothing is sent for it: no bell row, no push) and `preview` (off = the push says
 * «رسالة جديدة» only, never the words). The company's own switches are not here: nothing that belongs to the company moves into a person's settings.
 */
export const NOTIFY_TYPES = ["private", "topics", "mentions", "replies", "calls"] as const;
export type NotifyType = (typeof NOTIFY_TYPES)[number];

const notifyRuleSchema = z.object({ on: flag, preview: flag }).strict();
export type NotifyRule = z.infer<typeof notifyRuleSchema>;

/** The text a push carries instead of the words when the person switched the preview off. */
export const PREVIEW_OFF_TEXT = "رسالة جديدة";

/** Text size: five steps (the middle one is today's). `--chat-font-scale` is set from `FONT_SCALES[step]`. */
export const FONT_SCALES = [0.875, 0.9375, 1, 1.125, 1.25] as const;
export const DEFAULT_FONT_STEP = 2;
/** The wallpapers of the chat: «plain» (nothing drawn) and the six in-house patterns (D1.4). */
export const WALLPAPERS = ["plain", "boxes", "phones", "bubbles", "stars", "leaves", "coins"] as const;
export type Wallpaper = (typeof WALLPAPERS)[number];
/** What a person who never chose gets: the first pattern, so the chat looks like a messenger out of the box (they can pick «plain»). */
export const DEFAULT_WALLPAPER: Wallpaper = "boxes";
/** What sends a message from the keyboard: «enter» (Shift+Enter is a new line) or «ctrl» (Ctrl+Enter sends, Enter is a new line). */
export const SEND_KEYS = ["enter", "ctrl"] as const;
export type SendKey = (typeof SEND_KEYS)[number];
export const QUICK_REACTION_COUNT = 6;

/** One emoji and nothing else: no spaces, no letters or digits, one grapheme at the start that is an emoji (the server checks again). */
export function isOneEmoji(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 16 || /\s/.test(value) || /[\p{L}\p{N}]/u.test(value)) return false;
  if (!/^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})/u.test(value)) return false;
  // exactly ONE grapheme (a flag, a family or a skin tone is one; two emojis side by side are two) where the engine can count them
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: "grapheme" }) => { segment(text: string): Iterable<unknown> } }).Segmenter;
  if (Segmenter) return [...new Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length === 1;
  return true;
}

const emojiOne = z.string().refine(isOneEmoji, "chatprefs.emoji_bad");
const quickSix = z.array(emojiOne).length(QUICK_REACTION_COUNT, "chatprefs.quick_six").refine(unique, "chatprefs.quick_six");

/** A section keeps its known keys under their own rule and any other key as it is (a short plain name; at most 64 keys in all; the 64 KB cap bounds the rest). */
function sectionRules(value: Record<string, unknown>, ctx: z.RefinementCtx): void {
  const keys = Object.keys(value);
  if (keys.length > 64) ctx.addIssue({ code: "custom", message: "chatprefs.too_many_keys" });
  if (keys.some((key) => !KEY.test(key))) ctx.addIssue({ code: "custom", message: "chatprefs.bad_key" });
}

const notificationsShape = {
  private: notifyRuleSchema.optional(),
  topics: notifyRuleSchema.optional(),
  mentions: notifyRuleSchema.optional(),
  replies: notifyRuleSchema.optional(),
  calls: notifyRuleSchema.optional(),
};
const chatShape = {
  fontStep: z.number().int().min(0).max(FONT_SCALES.length - 1).optional(),
  wallpaper: z.enum(WALLPAPERS).optional(),
  sendKey: z.enum(SEND_KEYS).optional(),
  quickReactions: quickSix.optional(),
  doubleTap: emojiOne.optional(),
  themeAuto: z.boolean().optional(),
};
const notificationsSchema = z.object(notificationsShape).catchall(z.unknown()).superRefine(sectionRules);
const chatSectionSchema = z.object(chatShape).catchall(z.unknown()).superRefine(sectionRules);

/** Reads a section the forgiving way: a known key that is damaged is dropped and the rest stays; a section that is not an object is dropped whole. */
function readSection<S extends z.ZodTypeAny>(raw: unknown, known: Record<string, S>): Record<string, unknown> | undefined {
  if (!isPlain(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw).slice(0, 64)) {
    if (!KEY.test(key)) continue;
    const rule = Object.prototype.hasOwnProperty.call(known, key) ? known[key] : undefined;
    if (!rule) {
      out[key] = value;
      continue;
    }
    const parsed = rule.safeParse(value);
    if (parsed.success) out[key] = parsed.data;
  }
  return out;
}

const voiceSpeedSchema = z.union([z.literal(1), z.literal(1.5), z.literal(2)]);

const foldersByCompany = z
  .record(idSchema, folderListSchema)
  .refine((value) => Object.keys(value).length <= MAX_FOLDER_COMPANIES, "chatprefs.too_many_companies");

export const chatPrefsSchema = z
  .object({
    folders: foldersByCompany.optional(),
    tabs: tabsSchema.optional(),
    notifications: notificationsSchema.optional(),
    chat: chatSectionSchema.optional(),
    voiceSpeed: voiceSpeedSchema.optional(),
  })
  .strict();

export type ChatPrefs = z.infer<typeof chatPrefsSchema>;

/**
 * What a save carries: each section is optional; `null` puts it back to its default. The folders merge per company (a company's list is replaced whole,
 * `null` drops it); every other section is replaced whole.
 */
export const chatPrefsPatchSchema = z
  .object({
    folders: z
      .record(idSchema, folderListSchema.nullable())
      .refine((value) => Object.keys(value).length <= MAX_FOLDER_COMPANIES, "chatprefs.too_many_companies")
      .nullable()
      .optional(),
    tabs: tabsSchema.nullable().optional(),
    notifications: notificationsSchema.nullable().optional(),
    chat: chatSectionSchema.nullable().optional(),
    voiceSpeed: voiceSpeedSchema.nullable().optional(),
  })
  .strict();

export type ChatPrefsPatch = z.infer<typeof chatPrefsPatchSchema>;

/** The stored size, in bytes of the JSON text the database holds. */
export function chatPrefsBytes(prefs: unknown): number {
  return new TextEncoder().encode(JSON.stringify(prefs)).length;
}

const isPlain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads what the database holds: a value that is damaged reads as what is still good, never as an error (a folder that no longer fits the rules is
 * dropped, the others stay; an eleventh folder is cut). Unknown keys are ignored.
 */
export function readChatPrefs(raw: unknown): ChatPrefs {
  if (!isPlain(raw)) return {};
  const out: ChatPrefs = {};

  if (isPlain(raw["folders"])) {
    const folders: Record<string, ChatFolderDef[]> = {};
    for (const [org, list] of Object.entries(raw["folders"]).slice(0, MAX_FOLDER_COMPANIES)) {
      if (!ID.test(org) || !Array.isArray(list)) continue;
      const kept: ChatFolderDef[] = [];
      for (const item of list) {
        const parsed = chatFolderSchema.safeParse(item);
        if (parsed.success && !kept.some((f) => f.id === parsed.data.id)) kept.push(parsed.data);
        if (kept.length === MAX_FOLDERS) break;
      }
      if (kept.length > 0) folders[org] = kept;
    }
    if (Object.keys(folders).length > 0) out.folders = folders;
  }

  const tabs = tabsSchema.safeParse(raw["tabs"]);
  if (tabs.success && tabs.data.hidden) out.tabs = tabs.data;
  const notifications = readSection(raw["notifications"], notificationsShape);
  if (notifications) out.notifications = notifications as NonNullable<ChatPrefs["notifications"]>;
  const chat = readSection(raw["chat"], chatShape);
  if (chat) out.chat = chat as NonNullable<ChatPrefs["chat"]>;
  const speed = voiceSpeedSchema.safeParse(raw["voiceSpeed"]);
  if (speed.success) out.voiceSpeed = speed.data;
  return out;
}

/** A save applied to what is stored: the sections the patch names change, the others stay, `null` removes one. Never changes its inputs. */
export function mergeChatPrefs(current: ChatPrefs, patch: ChatPrefsPatch): ChatPrefs {
  const next: ChatPrefs = { ...current };

  if (patch.folders === null) delete next.folders;
  else if (patch.folders !== undefined) {
    const folders: Record<string, ChatFolderDef[]> = { ...(current.folders ?? {}) };
    for (const [org, list] of Object.entries(patch.folders)) {
      // an empty list is a delete too: what is answered is what a read gives back (`readChatPrefs` drops empty lists)
      if (list === null || list.length === 0) delete folders[org];
      else folders[org] = list;
    }
    if (Object.keys(folders).length > 0) next.folders = folders;
    else delete next.folders;
  }

  for (const key of ["tabs", "notifications", "chat", "voiceSpeed"] as const) {
    const value = patch[key];
    if (value === null) delete next[key];
    else if (value !== undefined) (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

/** The company's folders, in the person's order (none when they never made any). */
export function foldersOfOrg(prefs: ChatPrefs, orgId: string): ChatFolderDef[] {
  return prefs.folders?.[orgId] ?? [];
}

export interface ResolvedChatPrefs {
  folders: Record<string, ChatFolderDef[]>;
  tabs: { hidden: BuiltinTab[] };
  notifications: NonNullable<ChatPrefs["notifications"]>;
  chat: NonNullable<ChatPrefs["chat"]>;
  voiceSpeed: VoiceSpeed;
}

/** Every field with its default filled in. An empty object resolves to «all defaults». */
export function resolveChatPrefs(prefs: ChatPrefs): ResolvedChatPrefs {
  return {
    folders: prefs.folders ?? {},
    tabs: { hidden: prefs.tabs?.hidden ?? [] },
    notifications: prefs.notifications ?? {},
    chat: prefs.chat ?? {},
    voiceSpeed: prefs.voiceSpeed ?? DEFAULT_VOICE_SPEED,
  };
}

// ───────────────────────────────────────── C4.1: reading the person's choices ─────────────────────────────────────────

/** The rule of one kind of notification (an empty rule is «all on»). */
export function notifyRuleOf(prefs: ChatPrefs | null | undefined, type: NotifyType): NotifyRule {
  return prefs?.notifications?.[type] ?? {};
}

/** Is this kind of notification on for the person? (default yes) */
export function notifyOn(prefs: ChatPrefs | null | undefined, type: NotifyType): boolean {
  return notifyRuleOf(prefs, type).on !== false;
}

/**
 * THE PAYLOAD BUILDER of a chat push: what the push's body says for this person. With the preview switched off for the kind it is «رسالة جديدة» and nothing
 * of the message; otherwise the words as they are. Pure: `src/server/chat/notify.ts` hands its answer to the push as the body (the bell keeps the full text).
 */
export function pushBodyFor(prefs: ChatPrefs | null | undefined, type: NotifyType, body: string): string {
  return notifyRuleOf(prefs, type).preview === false ? PREVIEW_OFF_TEXT : body;
}

/**
 * Which kind a chat message is FOR a person: a private chat → private (it is addressed to them by being theirs: a switch for mentions never silences it); addressed
 * («@» or «@الكل») in a topic or a group → mentions; a reply to their message there → replies; anything else there → topics («المواضيع» covers the old groups too).
 */
export function notifyTypeOf(opts: { kind: "DM" | "GROUP" | "TOPIC"; mentioned: boolean; replied: boolean }): NotifyType {
  if (opts.kind === "DM") return "private";
  if (opts.mentioned) return "mentions";
  return opts.replied ? "replies" : "topics";
}

/** The person's text size step (0-4), the middle one when they never chose. */
export function fontStepOf(prefs: ChatPrefs | null | undefined): number {
  const step = prefs?.chat?.fontStep;
  return typeof step === "number" && Number.isInteger(step) && step >= 0 && step < FONT_SCALES.length ? step : DEFAULT_FONT_STEP;
}

/** The scale a text size step means (an unknown step is today's size). */
export function fontScaleOf(step: unknown): number {
  return typeof step === "number" && Number.isInteger(step) && step >= 0 && step < FONT_SCALES.length ? FONT_SCALES[step]! : FONT_SCALES[DEFAULT_FONT_STEP]!;
}

/** The person's quick reactions as stored (six distinct emojis) or undefined; `quickReactionsOf` falls back to today's six on anything else. */
export function quickReactionsPref(prefs: ChatPrefs | null | undefined): readonly string[] | undefined {
  const list = prefs?.chat?.quickReactions;
  return Array.isArray(list) && list.length === QUICK_REACTION_COUNT ? list : undefined;
}

/**
 * C4.1 «مفتاح الإرسال»: does the person's choice let this Enter send? «enter» (default): yes, as always (Shift+Enter stays a new line, decided by the caller).
 * «ctrl»: only with Ctrl (or the command key): a plain Enter is a new line.
 */
export function sendKeyAllows(sendKey: SendKey | undefined, e: { ctrlKey: boolean; metaKey?: boolean }): boolean {
  return sendKey !== "ctrl" || e.ctrlKey || e.metaKey === true;
}

/** The whole rule in one place (the composer asks `enterSends` and `sendKeyAllows` separately): Enter, no Shift, not while an input method composes a word, and the choice. */
export function sendsOnKey(sendKey: SendKey | undefined, e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey?: boolean; isComposing?: boolean }): boolean {
  return e.key === "Enter" && !e.isComposing && !e.shiftKey && sendKeyAllows(sendKey, e);
}
