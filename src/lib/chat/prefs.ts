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
/** C4.1's sections: a bounded map for now (its fields arrive with C4.1; the 64 KB cap bounds the rest). */
const sectionSchema = z
  .record(z.string().regex(KEY, "chatprefs.bad_key"), z.unknown())
  .refine((value) => Object.keys(value).length <= 64, "chatprefs.too_many_keys");

const voiceSpeedSchema = z.union([z.literal(1), z.literal(1.5), z.literal(2)]);

const foldersByCompany = z
  .record(idSchema, folderListSchema)
  .refine((value) => Object.keys(value).length <= MAX_FOLDER_COMPANIES, "chatprefs.too_many_companies");

export const chatPrefsSchema = z
  .object({
    folders: foldersByCompany.optional(),
    tabs: tabsSchema.optional(),
    notifications: sectionSchema.optional(),
    chat: sectionSchema.optional(),
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
    notifications: sectionSchema.nullable().optional(),
    chat: sectionSchema.nullable().optional(),
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
  for (const section of ["notifications", "chat"] as const) {
    const parsed = sectionSchema.safeParse(raw[section]);
    if (parsed.success) out[section] = parsed.data;
  }
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
  notifications: Record<string, unknown>;
  chat: Record<string, unknown>;
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
