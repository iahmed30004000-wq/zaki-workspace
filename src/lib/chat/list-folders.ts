import { applySavedOrder, dmScope, spaceScope } from "@/lib/chat/order";
import { foldedIncludes } from "@/lib/search/arabic";
import { inFolder } from "@/lib/chat/cache/unread";
import type { UnreadSummary } from "@/lib/chat/cache/unread";
import type { ChatFolder, ChatRowDto } from "@/lib/chat/cache/types";

/**
 * C2.2 — the folders of the chat list («الكل · غير مقروء · خاص · المساحات · ذكروني», and «كل الشركة» for the people who hold the silent
 * oversight), as PURE functions over the rows of the C1.4 cache. Nothing here reads or writes the cache, the network or the screen: the
 * list column hands the rows in and draws what comes out, and `tests/chat-v2-list-folders.test.ts` pins every rule.
 *
 *  - The folders are filters (`inFolder` of the cache's own `unread.ts`: the same rule that counts the badges), never stored.
 *  - «كل الشركة» is not a filter of the person's rows: it is the oversight screen (every conversation of the company, read silently,
 *    P0.1). It exists ONLY when the server said `canOversee`, and the rows of that screen show nothing about reading.
 *  - The person's own order (`UserChatOrder`, src/lib/chat/order.ts) wins when set: it permutes the rows of its list among the
 *    places those rows already hold, so the pinned-first grouping and the newest-first order of everything else survive.
 *  - C3a.1: «الأرشيف» is a folder too, offered ONLY while the person has a chat they archived for themselves; no other folder shows those chats, and it
 *    has no number. The person's own pins float first in the order of their `pins` list (`UserChatOrder`, the newest pin on top).
 *  - A search matches only text the row already DRAWS (its title, its space, its topic chips, its preview): it can never reveal a
 *    conversation the server did not put in the list, so a topic the person is outside of cannot be found by its name.
 */

export type ListFolderKey = ChatFolder | "company" | "archived";

export interface ListFolder {
  key: ListFolderKey;
  /** the key of the tab's label in `ar.chat-ui.json` */
  labelKey: string;
}

const BASE: readonly ListFolder[] = [
  { key: "all", labelKey: "chatui.folder.all" },
  { key: "unread", labelKey: "chatui.folder.unread" },
  { key: "dm", labelKey: "chatui.folder.dm" },
  { key: "spaces", labelKey: "chatui.folder.spaces" },
  { key: "mentions", labelKey: "chatui.folder.mentions" },
];
const COMPANY: ListFolder = { key: "company", labelKey: "chatui.folder.company" };
const ARCHIVED: ListFolder = { key: "archived", labelKey: "chatui.folder.archived" };

/**
 * The folders this person is offered, in order. A guest has no private chats (the server never lists one), so «خاص» is not offered;
 * «كل الشركة» only when the server's list said `canOversee` (today's rule, `hasOversight`: the capability, never the rank). «الأرشيف» (C3a.1) only when
 * the person has an archived chat (`archived`), after the built-in tabs and before «كل الشركة».
 */
export function foldersOf(opts: { canOversee: boolean; guest?: boolean; archived?: boolean }): ListFolder[] {
  const base = opts.guest ? BASE.filter((f) => f.key !== "dm") : [...BASE];
  if (opts.archived) base.push(ARCHIVED);
  return opts.canOversee && !opts.guest ? [...base, COMPANY] : base;
}


/** A remembered or typed folder, or the first one when it is not on offer (a person who lost the oversight, a stale value). */
export function folderKeyOf(value: unknown, offered: readonly ListFolder[]): ListFolderKey {
  return offered.find((f) => f.key === value)?.key ?? offered[0]?.key ?? "all";
}

export function isCompanyFolder(key: ListFolderKey): key is "company" {
  return key === "company";
}

/** The number on a folder's tab: the chats with something unread there (for «ذكروني» the mentions). Muted conversations count, grey. The company and the archive have none. */
export function folderBadge(summary: Pick<UnreadSummary, "byFolder"> | undefined, key: ListFolderKey): number {
  if (!summary || key === "company" || key === "archived") return 0;
  const folder = summary.byFolder[key];
  return key === "mentions" ? folder.mentions : folder.chats;
}

// ───────────────────────────────────────── search ─────────────────────────────────────────

export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 100);
}

/** Does the row's own text contain the typed words (spelling-tolerant: «احمد» finds «أحمد»)? Only fields the row draws are read. */
export function rowMatches(row: ChatRowDto, query: string): boolean {
  const q = normalizeQuery(query);
  if (!q) return true;
  if (foldedIncludes(row.title, q)) return true;
  if (row.space && foldedIncludes(row.space.name, q)) return true;
  if (row.topicChips?.some((chip) => foldedIncludes(chip.title, q))) return true;
  const last = row.lastMessage;
  return !!last && ((last.preview !== null && foldedIncludes(last.preview, q)) || (last.authorName !== "" && foldedIncludes(last.authorName, q)));
}

// ───────────────────────────────────────── order ─────────────────────────────────────────

/** The person's saved orders by scope (`GET /api/chat/order`): `space:<id>` the topics of a space, `dm` / `dm:<id>` the private chats. */
export type SavedOrders = Readonly<Record<string, readonly string[] | undefined>>;

/** The default group of a topic inside its space: the managers' pin floats first, an archived topic last (as the old home grouped them). */
export const topicGroupOf = (row: Pick<ChatRowDto, "archived" | "archivedByMe" | "pinned" | "pinnedByMe">): string =>
  row.archived || row.archivedByMe ? "a" : row.pinnedByMe ? "m" : row.pinned ? "p" : "u";

/** Permutes the rows `pick` selects among the places those rows already hold. Does not change its input. */
function permuteSubset(rows: ChatRowDto[], pick: (row: ChatRowDto) => boolean, saved: readonly string[] | undefined, groupOf: (row: ChatRowDto) => string): ChatRowDto[] {
  if (!saved || saved.length === 0) return rows;
  const places: number[] = [];
  const subset: ChatRowDto[] = [];
  rows.forEach((row, i) => {
    if (pick(row)) {
      places.push(i);
      subset.push(row);
    }
  });
  if (subset.length < 2) return rows;
  const ordered = applySavedOrder(subset, saved, groupOf);
  const out = [...rows];
  places.forEach((place, n) => {
    out[place] = ordered[n]!;
  });
  return out;
}

/**
 * The person's own pins (C3a.1, `pinnedByMe`) float first, in the order of their `pins` list (the newest pin on top); a pin that list does not know yet goes
 * after the known ones, in the order the rows already have; everything else keeps its order.
 */
function pinnedFirst(rows: ChatRowDto[], pins?: readonly string[]): ChatRowDto[] {
  if (!rows.some((r) => r.pinnedByMe)) return rows;
  const rank = new Map<string, number>();
  pins?.forEach((id, i) => {
    if (!rank.has(id)) rank.set(id, i);
  });
  const mine = rows.filter((r) => r.pinnedByMe);
  const known = mine.filter((r) => rank.has(r.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...known, ...mine.filter((r) => !rank.has(r.id)), ...rows.filter((r) => !r.pinnedByMe)];
}

export interface ListShape {
  /** `all`: the one list (D-N2 «قائمة وحدة»); `space`: the space the person is in (D-N2 «كل مساحة حساب»). NEITHER is assumed: the server's answer says which. */
  scope: "all" | "space";
  spaceId: string | null;
}

/** The rows of the list in the person's order: own pin first, then their saved order of the private chats and (in the one-space shape) of the topics. */
export function orderedRows(rows: readonly ChatRowDto[], shape: ListShape, orders: SavedOrders = {}): ChatRowDto[] {
  let out = pinnedFirst([...rows], orders["pins"]);
  const isChat = (r: ChatRowDto) => r.kind === "DM" || r.kind === "GROUP";
  out = permuteSubset(out, isChat, orders[dmScope(shape.scope === "space" ? shape.spaceId : null)], (r) => (r.pinnedByMe ? "p" : "u"));
  if (shape.scope === "space" && shape.spaceId) {
    out = permuteSubset(out, (r) => r.kind === "TOPIC", orders[spaceScope(shape.spaceId)], topicGroupOf);
  }
  return out;
}

/** The rows one folder shows, with the search applied: order first (so the slots are those of the whole list), then the folder, then the words. «الأرشيف» shows the archived ones only. */
export function listRows(rows: readonly ChatRowDto[], opts: ListShape & { folder: ChatFolder | "archived"; query?: string; orders?: SavedOrders }): ChatRowDto[] {
  const q = normalizeQuery(opts.query ?? "");
  const folder = opts.folder;
  return orderedRows(rows, opts, opts.orders).filter((row) => (folder === "archived" ? row.archivedByMe : inFolder(row, folder)) && (!q || rowMatches(row, q)));
}

/**
 * The topics of one space's forum view, in the person's order (their `space:<id>` list wins inside the managers' pin group and the unpinned one). The topics the
 * person pinned (C3a.1) come first; a topic they archived for themselves goes down with the moderators' archived ones, under the «المؤرشفة» line.
 */
export function forumRows(rows: readonly ChatRowDto[], spaceId: string, orders: SavedOrders = {}, query = ""): ChatRowDto[] {
  const q = normalizeQuery(query);
  const ordered = permuteSubset([...rows], () => true, orders[spaceScope(spaceId)], topicGroupOf);
  const live = pinnedFirst(ordered.filter((r) => !r.archived && !r.archivedByMe), orders["pins"]);
  const archived = ordered.filter((r) => r.archived || r.archivedByMe);
  return [...live, ...archived].filter((r) => !q || rowMatches(r, q));
}

// ───────────────────────────────────────── what the list is made of ─────────────────────────────────────────

/** One thing the virtual list draws: a conversation row, or the folded «المؤرشفة» line of the forum view. */
export type ListItem = { type: "row"; key: string; id: string } | { type: "section"; key: string; count: number };

export function rowItems(rows: readonly ChatRowDto[]): ListItem[] {
  return rows.map((row) => ({ type: "row", key: `${row.kind}:${row.id}`, id: row.id }));
}

/** The forum view's items: the live topics, then (when there are archived ones, which only managers receive) a section line and those. */
export function forumItems(rows: readonly ChatRowDto[]): ListItem[] {
  const live = rows.filter((r) => !r.archived && !r.archivedByMe);
  const archived = rows.filter((r) => r.archived || r.archivedByMe);
  const items = rowItems(live);
  if (archived.length) items.push({ type: "section", key: "section:archived", count: archived.length }, ...rowItems(archived));
  return items;
}
