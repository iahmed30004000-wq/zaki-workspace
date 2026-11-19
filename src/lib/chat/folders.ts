import type { ChatRowDto } from "@/lib/chat/cache/types";
import { hasUnread, unreadOfRows } from "@/lib/chat/cache/unread";
import { foldersOf, normalizeQuery, orderedRows, rowMatches, type ListFolderKey, type ListShape, type SavedOrders } from "@/lib/chat/list-folders";
import { BUILTIN_TABS, FOLDER_NAME_MAX, MAX_FOLDERS, MAX_FOLDER_CHATS, MAX_FOLDER_SPACES, type BuiltinTab, type ChatFolderDef } from "@/lib/chat/prefs";

/**
 * C3a.2 — the person's own folders of the chat list, as PURE functions over the rows of the C1 list cache. Nothing here reads or writes the cache, the
 * network or the screen; `tests/chat-folders.test.ts` pins every rule.
 *
 *  - A folder is a filter, kept in `User.chatPrefs` (`src/lib/chat/prefs.ts`) as ids only. It can only KEEP or DROP the rows it is handed: the list cache
 *    holds only rows the person may read, so a folder that lists a chat they can no longer read shows nothing for it and names nothing.
 *  - A row is in a folder when ANY of its include rules matches (private chats · spaces · a mention waiting · a chat picked by hand · a whole space) and none
 *    of its exclusions does (muted · read · archived): the exclusions take out of everything the folder holds, chats picked by hand too. A folder that
 *    includes nothing shows nothing. A chat the person archived is in a folder unless the folder excludes the archive; the built-in tabs never show it.
 *  - The tabs are the five built-in ones (never stored: the person may hide them), then their folders, then «الأرشيف» and «كل الشركة» (as `foldersOf`).
 *    The folders keep the person's order (their list's order); the archive and the company keep the end.
 */

/** A folder's tab key is its id behind this prefix, so it can never collide with a built-in key. */
export const CUSTOM_PREFIX = "f:";
export type CustomTabKey = `f:${string}`;
export type TabKey = ListFolderKey | CustomTabKey;

export const customTabKey = (id: string): CustomTabKey => `${CUSTOM_PREFIX}${id}`;

/** The folder id of a custom tab key, or null for a built-in key. */
export function customIdOf(key: string): string | null {
  return key.startsWith(CUSTOM_PREFIX) && key.length > CUSTOM_PREFIX.length ? key.slice(CUSTOM_PREFIX.length) : null;
}

// ───────────────────────────────────────── what a folder holds ─────────────────────────────────────────

const belongsToSpace = (row: ChatRowDto, spaceId: string): boolean => row.space?.id === spaceId || (row.kind === "SPACE" && row.id === spaceId);

/** Is this row in the folder? */
export function folderIncludes(row: ChatRowDto, folder: ChatFolderDef): boolean {
  const { include, exclude } = folder;
  const wanted =
    (include.dms === true && (row.kind === "DM" || row.kind === "GROUP")) ||
    (include.spaces === true && (row.kind === "SPACE" || row.kind === "TOPIC")) ||
    (include.mentions === true && row.mentionsUnread > 0) ||
    include.conversationIds.includes(row.id) ||
    include.spaceIds.some((spaceId) => belongsToSpace(row, spaceId));
  if (!wanted) return false;
  if (exclude.muted === true && row.muted) return false;
  if (exclude.read === true && !hasUnread(row)) return false;
  if (exclude.archived === true && row.archivedByMe) return false;
  return true;
}

/** The rows one folder shows: the list's own order first (the person's pins and saved order), then the folder, then the typed words. */
export function folderRows(rows: readonly ChatRowDto[], folder: ChatFolderDef, shape: ListShape, opts: { query?: string; orders?: SavedOrders } = {}): ChatRowDto[] {
  const q = normalizeQuery(opts.query ?? "");
  return orderedRows(rows, shape, opts.orders).filter((row) => folderIncludes(row, folder) && (!q || rowMatches(row, q)));
}

/** The number on a folder's tab: the chats with something waiting in it (muted ones count, grey; an archived chat never does). */
export function folderBadge(rows: readonly ChatRowDto[], folder: ChatFolderDef): number {
  return unreadOfRows(rows.filter((row) => folderIncludes(row, folder))).chats;
}

/** The spaces the rows belong to, once each in the order they appear (the editor's «مساحات كاملة»). */
export function spacesOfRows(rows: readonly ChatRowDto[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const row of rows) if (row.space && !seen.has(row.space.id)) seen.set(row.space.id, row.space.name);
  return [...seen].map(([id, name]) => ({ id, name }));
}

// ───────────────────────────────────────── the tabs ─────────────────────────────────────────

export interface Tab {
  key: TabKey;
  /** a built-in tab's words, a key of the dictionary */
  labelKey?: string;
  /** a folder's own name, typed by the person: drawn as text, never as markup */
  label?: string;
  emoji?: string | null;
}

const isBuiltin = (key: string): key is BuiltinTab => (BUILTIN_TABS as readonly string[]).includes(key);

/**
 * The tabs this person is offered, in order. `hidden` takes built-in tabs away (nothing is deleted); with everything hidden and no folder of their own
 * «الكل» stays, so the strip is never empty. «الأرشيف» and «كل الشركة» always come last.
 */
export function tabsOf(opts: { canOversee: boolean; guest?: boolean; archived?: boolean; folders?: readonly ChatFolderDef[]; hidden?: readonly BuiltinTab[] }): Tab[] {
  const offered = foldersOf({ canOversee: opts.canOversee, ...(opts.guest !== undefined ? { guest: opts.guest } : {}), ...(opts.archived !== undefined ? { archived: opts.archived } : {}) });
  const hidden = new Set<string>(opts.hidden ?? []);
  const tail: Tab[] = offered.filter((f) => !isBuiltin(f.key)).map((f) => ({ key: f.key, labelKey: f.labelKey }));
  let movable: Tab[] = offered.filter((f) => isBuiltin(f.key) && !hidden.has(f.key)).map((f) => ({ key: f.key, labelKey: f.labelKey }));
  for (const folder of opts.folders ?? []) movable.push({ key: customTabKey(folder.id), label: folder.name, ...(folder.emoji ? { emoji: folder.emoji } : {}) });
  if (movable.length === 0) movable = offered.filter((f) => f.key === "all").map((f) => ({ key: f.key, labelKey: f.labelKey }));

  return [...movable, ...tail];
}

/** A remembered or typed tab, or the first one when it is not on offer (a deleted folder, a hidden tab, a stale value). */
export function tabKeyOf(value: unknown, tabs: readonly Tab[]): TabKey {
  return tabs.find((t) => t.key === value)?.key ?? tabs[0]?.key ?? "all";
}

// ───────────────────────────────────────── editing (the editor's moves) ─────────────────────────────────────────

/** The emoji the editor offers (a free choice stays possible: any short emoji passes the schema). */
export const FOLDER_EMOJIS: readonly string[] = ["📁", "💼", "🏠", "⭐", "📦", "💬", "👥", "📌", "🛒", "🔥", "✅", "📣"];

/** A name as the schema takes it: trimmed, at most 12 characters; null when nothing is left. */
export function cleanFolderName(name: string): string | null {
  const cut = [...name.trim()].slice(0, FOLDER_NAME_MAX).join("").trim();
  return cut === "" ? null : cut;
}

/** A new folder id: valid for the schema and not taken. */
export function newFolderId(taken: ReadonlySet<string>, random: () => number = Math.random): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const id = `f-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, "0")}`;
    if (!taken.has(id)) return id;
  }
  let n = taken.size;
  while (taken.has(`f-${n}`)) n++;
  return `f-${n}`;
}

/**
 * Adds a folder at the end: nothing in it yet, the archive left out (a person archives to get a chat out of sight). Returns the list unchanged when
 * there are already ten, the id is taken or the name is empty.
 */
export function addFolder(list: ChatFolderDef[], init: { id: string; name: string; emoji?: string }): ChatFolderDef[] {
  const name = cleanFolderName(init.name);
  if (!name || list.length >= MAX_FOLDERS || list.some((f) => f.id === init.id)) return list;
  const made: ChatFolderDef = { id: init.id, name, ...(init.emoji ? { emoji: init.emoji } : {}), include: { conversationIds: [], spaceIds: [] }, exclude: { archived: true } };
  return [...list, made];
}

/** Changes one folder; `emoji: undefined` takes the emoji away. Unchanged (the same list) when the id is unknown. */
export function updateFolder(list: ChatFolderDef[], id: string, changes: Partial<Omit<ChatFolderDef, "id">>): ChatFolderDef[] {
  if (!list.some((f) => f.id === id)) return list;
  return list.map((f) => {
    if (f.id !== id) return f;
    const next: ChatFolderDef = { ...f, ...changes };
    if ("emoji" in changes && changes.emoji === undefined) delete next.emoji;
    return next;
  });
}

export function renameFolder(list: ChatFolderDef[], id: string, name: string): ChatFolderDef[] {
  const clean = cleanFolderName(name);
  return clean && list.some((f) => f.id === id) ? updateFolder(list, id, { name: clean }) : list;
}

/**
 * The folders in the order of `ids` (a drag hands the whole new order): an id the list does not hold is ignored, a folder the ids do not name keeps its
 * place after the named ones. The same list (not a copy) when nothing moved.
 */
export function reorderFolders(list: ChatFolderDef[], ids: readonly string[]): ChatFolderDef[] {
  const named = ids.map((id) => list.find((f) => f.id === id)).filter((f, i, all): f is ChatFolderDef => !!f && all.indexOf(f) === i);
  const next = [...named, ...list.filter((f) => !named.includes(f))];
  return next.every((f, i) => f === list[i]) ? list : next;
}

export function removeFolder(list: ChatFolderDef[], id: string): ChatFolderDef[] {
  return list.some((f) => f.id === id) ? list.filter((f) => f.id !== id) : list;
}

function toggleIn(list: ChatFolderDef[], id: string, key: "conversationIds" | "spaceIds", value: string, max: number): ChatFolderDef[] {
  const folder = list.find((f) => f.id === id);
  if (!folder) return list;
  const has = folder.include[key].includes(value);
  if (!has && folder.include[key].length >= max) return list;
  const nextIds = has ? folder.include[key].filter((v) => v !== value) : [...folder.include[key], value];
  return updateFolder(list, id, { include: { ...folder.include, [key]: nextIds } });
}

/** Ticks or unticks a chat picked by hand (at most 100). Unchanged when the folder is full and the chat is new. */
export const toggleChat = (list: ChatFolderDef[], id: string, chatId: string): ChatFolderDef[] => toggleIn(list, id, "conversationIds", chatId, MAX_FOLDER_CHATS);
/** Ticks or unticks a whole space (at most 50). */
export const toggleSpace = (list: ChatFolderDef[], id: string, spaceId: string): ChatFolderDef[] => toggleIn(list, id, "spaceIds", spaceId, MAX_FOLDER_SPACES);

/** Takes out of one folder every chat and space the person can no longer see (their ids are not among `known`). */
export function pruneUnknown(list: ChatFolderDef[], id: string, known: { chats: ReadonlySet<string>; spaces: ReadonlySet<string> }): ChatFolderDef[] {
  const folder = list.find((f) => f.id === id);
  if (!folder) return list;
  const conversationIds = folder.include.conversationIds.filter((c) => known.chats.has(c));
  const spaceIds = folder.include.spaceIds.filter((s) => known.spaces.has(s));
  if (conversationIds.length === folder.include.conversationIds.length && spaceIds.length === folder.include.spaceIds.length) return list;
  return updateFolder(list, id, { include: { ...folder.include, conversationIds, spaceIds } });
}

/** How many of a folder's picks are not among the rows the person can see (they stay in the folder, inert, until the person takes them out). */
export function unknownCount(folder: ChatFolderDef, known: { chats: ReadonlySet<string>; spaces: ReadonlySet<string> }): number {
  return folder.include.conversationIds.filter((c) => !known.chats.has(c)).length + folder.include.spaceIds.filter((s) => !known.spaces.has(s)).length;
}
