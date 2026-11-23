import type { ChatRowDto } from "@/lib/chat/cache/types";
import type { ChatRowLastMessageDto } from "@/server/chat/dto";
import { rowItems, type ListItem } from "@/lib/chat/list-folders";

/**
 * «مجموعات المواضيع» on the chat list — the pure half. A group is ONE row (its name, the newest message of its topics, the unread of its topics added up); the topics with no
 * group are «عام». A topic row carries its `groupId` (the server's list); the groups' own data (name, emoji, order) come from `GET /api/groups`.
 * With no group in the space nothing here draws anything: the list stays as flat as it was.
 */

export interface GroupMeta {
  id: string;
  name: string;
  emoji: string | null;
  position: number;
  restricted: boolean;
}

export const GENERAL_KEY = "group:general";

export interface GroupRowModel {
  /** `group:<id>` or `group:general` */
  key: string;
  /** null: «عام» */
  id: string | null;
  name: string;
  emoji: string | null;
  restricted: boolean;
  topicCount: number;
  unread: number;
  mentions: number;
  last: ChatRowLastMessageDto | null;
  /** every topic of it is muted */
  muted: boolean;
}

const live = (row: ChatRowDto): boolean => row.kind === "TOPIC" && !row.archived && !row.archivedByMe;

/** The group a topic is drawn in: its own, or «عام» (null) when it has none or the viewer does not know the group. */
function placeOf(row: ChatRowDto, known: ReadonlySet<string>): string | null {
  return row.groupId && known.has(row.groupId) ? row.groupId : null;
}

/**
 * The group rows of a list of topics: the groups in the order of their `position`, then «عام» (only when something is in it). An empty group is drawn only for a manager
 * (`showEmpty`: somebody who can drop topics into it). No group at all: no rows.
 */
export function groupRows(rows: readonly ChatRowDto[], groups: readonly GroupMeta[], generalName: string, opts: { showEmpty: boolean }): GroupRowModel[] {
  if (groups.length === 0) return [];
  const known = new Set(groups.map((g) => g.id));
  const topics = rows.filter(live);
  const model = (id: string | null, name: string, emoji: string | null, restricted: boolean, inside: readonly ChatRowDto[]): GroupRowModel => ({
    key: id === null ? GENERAL_KEY : `group:${id}`,
    id,
    name,
    emoji,
    restricted,
    topicCount: inside.length,
    unread: inside.reduce((n, t) => n + t.unread, 0),
    mentions: inside.reduce((n, t) => n + t.mentionsUnread, 0),
    last: inside.reduce<ChatRowLastMessageDto | null>((best, t) => (t.lastMessage && (!best || t.lastMessage.at > best.at) ? t.lastMessage : best), null),
    muted: inside.length > 0 && inside.every((t) => t.muted),
  });
  const ordered = [...groups].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "ar"));
  const out: GroupRowModel[] = [];
  for (const g of ordered) {
    const inside = topics.filter((t) => placeOf(t, known) === g.id);
    if (inside.length || opts.showEmpty) out.push(model(g.id, g.name, g.emoji, g.restricted, inside));
  }
  const general = topics.filter((t) => placeOf(t, known) === null);
  if (general.length) out.push(model(null, generalName, null, false, general));
  return out;
}

/** The topics of ONE group (null: «عام», which also holds the topics of a group the viewer does not know), in the order the rows came. */
export function topicsOfGroup(rows: readonly ChatRowDto[], groupId: string | null, groups: readonly GroupMeta[]): ChatRowDto[] {
  const known = new Set(groups.map((g) => g.id));
  return rows.filter((r) => r.kind === "TOPIC" && placeOf(r, known) === groupId);
}

/** What the list draws for a mixed list of rows (private chats and topics): a group row for each group at the place of the first topic, every other row where it was. */
export function groupItems(rows: readonly ChatRowDto[], groups: readonly GroupMeta[], generalName: string, opts: { showEmpty: boolean }): ListItem[] {
  const models = groupRows(rows, groups, generalName, opts);
  if (models.length === 0) return rowItems(rows);
  const items: ListItem[] = [];
  let placed = false;
  for (const row of rows) {
    if (row.kind !== "TOPIC") {
      items.push(...rowItems([row]));
      continue;
    }
    if (!placed) {
      placed = true;
      for (const group of models) items.push({ type: "group", key: group.key, group });
    }
  }
  // a space whose topics are all archived has none to anchor the groups: a manager's empty groups still show at the end
  if (!placed) for (const group of models) items.push({ type: "group", key: group.key, group });
  return items;
}

/** The group a topic row is drawn in (null: «عام»). */
export function groupOfRow(row: ChatRowDto, groups: readonly GroupMeta[]): string | null {
  return placeOf(row, new Set(groups.map((g) => g.id)));
}

/**
 * Dragging inside one group: the ids of that group take the places they already hold in the whole list of the space, in the new order. Every other id stays exactly where it was,
 * so the person's saved order of the space (`space:<id>`) changes only for this group.
 */
export function reorderWithin(full: readonly string[], subset: readonly string[], next: readonly string[]): string[] {
  const inSubset = new Set(subset);
  const queue = next.filter((id) => inSubset.has(id));
  let i = 0;
  return full.map((id) => (inSubset.has(id) ? (queue[i++] ?? id) : id));
}

/** The forum view of a space that has groups: the group rows, then (for the managers, who receive them) the archived topics folded under their line as before. */
export function groupedForumItems(rows: readonly ChatRowDto[], groups: readonly GroupMeta[], generalName: string, opts: { showEmpty: boolean }): ListItem[] {
  const liveRows = rows.filter((r) => !r.archived && !r.archivedByMe);
  const archived = rows.filter((r) => r.archived || r.archivedByMe);
  const items = groupItems(liveRows, groups, generalName, opts);
  if (archived.length) items.push({ type: "section", key: "section:archived", count: archived.length }, ...rowItems(archived));
  return items;
}
