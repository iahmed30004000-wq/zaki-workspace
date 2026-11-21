import type { ChatRowDto } from "@/lib/chat/cache/types";
import { listRows, type ListShape } from "@/lib/chat/list-folders";

/**
 * M1a — the conversations «ابعت لـ…» offers: the rows of the C1 list cache in the person's own order, narrowed by what they typed. A private chat, a group and
 * a topic are targets; a SPACE row is not a conversation, it opens that space's topics (the picker's second step). A closed topic and a system conversation
 * are not offered: nothing can be written there. ⚠️ This is discoverability, not permission: the conversation's own composer and the server refuse a
 * message the person may not post, whatever was offered here.
 */
export function canShareTo(row: Pick<ChatRowDto, "kind" | "closed" | "system">): boolean {
  if (row.kind === "SPACE") return true;
  return row.closed !== true && row.system !== true;
}

/** The rows of the list that can receive a share, in the person's order, matching the typed words. */
export function shareTargetsOf(rows: readonly ChatRowDto[], shape: ListShape, query: string): ChatRowDto[] {
  return listRows(rows, { ...shape, folder: "all", query }).filter(canShareTo);
}

/** The topics of one space (its forum view's rows) that can receive a share, matching the typed words. */
export function spaceTargetsOf(rows: readonly ChatRowDto[], query: string): ChatRowDto[] {
  const q = query.trim().replace(/\s+/g, " ");
  return listRows(rows, { scope: "all", spaceId: null, folder: "all", query: q }).filter((row) => row.kind !== "SPACE" && canShareTo(row));
}
