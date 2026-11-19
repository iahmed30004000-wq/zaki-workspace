import { CHAT_FOLDERS, type ChatFolder, type ChatRowDto, type UnreadCount } from "@/lib/chat/cache/types";

/**
 * C1.4 — unread numbers DERIVED from the rows of the cache: per row, per folder, per space. Pure functions, no React.
 *
 * The server's numbers win: a list refresh replaces every row, and a sync answer replaces the rows it names, so whatever the
 * cache worked out by itself (a message of mine appended, a conversation I just read) lives only until the server's row arrives.
 *
 * ⚠️ These are the LIST's numbers. The sidebar badge «الدردشة» (`/api/chat/unread`) is defined a little differently on the
 * server (a topic the person never opened counts its whole history in the list, not in the badge: `pr/C1.2.md`), so the two
 * can disagree until the server unifies them. 🔧 The badge keeps asking the server; nothing here is added to it.
 */

/** What one row has waiting: its messages, or a single mark when the person marked it unread by hand. */
export function unreadOfRow(row: Pick<ChatRowDto, "unread" | "markedUnread">): number {
  if (row.unread > 0) return row.unread;
  return row.markedUnread ? 1 : 0;
}

export function hasUnread(row: Pick<ChatRowDto, "unread" | "markedUnread">): boolean {
  return unreadOfRow(row) > 0;
}

/** Is this row in the folder? A row the person archived for themselves (C3a.1) is in no built-in folder: only the «الأرشيف» tab shows it. */
export function inFolder(row: ChatRowDto, folder: ChatFolder): boolean {
  if (row.archivedByMe) return false;
  switch (folder) {
    case "all":
      return true;
    case "unread":
      return hasUnread(row);
    case "dm":
      return row.kind === "DM" || row.kind === "GROUP";
    case "spaces":
      return row.kind === "SPACE" || row.kind === "TOPIC";
    case "mentions":
      return row.mentionsUnread > 0;
  }
}

export function filterRows(rows: readonly ChatRowDto[], folder: ChatFolder): ChatRowDto[] {
  return rows.filter((r) => inFolder(r, folder));
}

const none = (): UnreadCount => ({ messages: 0, chats: 0, mentions: 0 });

/** The numbers of a set of rows. `includeMuted: false` leaves out the conversations the person muted. */
export function unreadOfRows(rows: readonly ChatRowDto[], opts: { includeMuted?: boolean } = {}): UnreadCount {
  const includeMuted = opts.includeMuted ?? true;
  const out = none();
  for (const row of rows) {
    if (row.archivedByMe || (!includeMuted && row.muted)) continue;
    const n = unreadOfRow(row);
    if (n > 0) {
      out.messages += n;
      out.chats += 1;
    }
    out.mentions += row.mentionsUnread;
  }
  return out;
}

/** One number set per built-in folder (the badges of the folder tabs). */
export function unreadByFolder(rows: readonly ChatRowDto[], opts: { includeMuted?: boolean } = {}): Record<ChatFolder, UnreadCount> {
  const out = {} as Record<ChatFolder, UnreadCount>;
  for (const folder of CHAT_FOLDERS) out[folder] = unreadOfRows(filterRows(rows, folder), opts);
  return out;
}

/**
 * One number set per space (the badges on the space switcher): a space's own row and the private chats that carry its chip.
 * A topic row of the one list never appears (its space's row already folds it), so nothing is counted twice.
 */
export function unreadBySpace(rows: readonly ChatRowDto[], opts: { includeMuted?: boolean } = {}): Record<string, UnreadCount> {
  const bySpace = new Map<string, ChatRowDto[]>();
  for (const row of rows) {
    const id = row.space?.id;
    if (!id) continue;
    bySpace.set(id, [...(bySpace.get(id) ?? []), row]);
  }
  const out: Record<string, UnreadCount> = {};
  for (const [id, list] of bySpace) out[id] = unreadOfRows(list, opts);
  return out;
}

export interface UnreadSummary {
  total: UnreadCount;
  byFolder: Record<ChatFolder, UnreadCount>;
  bySpace: Record<string, UnreadCount>;
}

export function summarizeUnread(rows: readonly ChatRowDto[], opts: { includeMuted?: boolean } = {}): UnreadSummary {
  return { total: unreadOfRows(rows, opts), byFolder: unreadByFolder(rows, opts), bySpace: unreadBySpace(rows, opts) };
}
