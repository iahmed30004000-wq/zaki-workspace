import { z } from "zod";

/**
 * A person's OWN order of the chat list (the «ترتيب» mode of the chat home). Pure, shared by the server (the
 * home comes back already in the person's order, no flash) and by the screen (a drag becomes the new list).
 *
 * The saved order is only an overlay on the server's default order: the moderator's pin keeps floating the
 * pinned topics first (each group is ordered on its own), a conversation the list does not know falls in at
 * its default place, and an id that disappeared or lost access is ignored.
 */

export const ORDER_MAX = 500;

/**
 * `space:<spaceId>` (the topics of a space), `dm` (the private chats outside a space) or `dm:<spaceId>`; and `pins` (C3a.1): the person's own pins, across every list
 * (saved by `savePinsOrder`, never by `saveOrder`: a pin may be a topic, a private chat or a group).
 */
export const scopeSchema = z
  .string()
  .max(60)
  .regex(/^(space:[A-Za-z0-9_-]{1,40}|dm(:[A-Za-z0-9_-]{1,40})?|pins)$/);

/** The scope of the person's own pins. */
export const PINS_ORDER_SCOPE = "pins";

export const orderSchema = z.array(z.string().min(1).max(64)).max(ORDER_MAX);

export const saveOrderSchema = z.object({ scope: scopeSchema, order: orderSchema });

export const spaceScope = (spaceId: string): string => `space:${spaceId}`;
export const dmScope = (spaceId: string | null | undefined): string => (spaceId ? `dm:${spaceId}` : "dm");

/** What is read back from the database (a JSON column): strings only, each once, at most `ORDER_MAX`. */
export function cleanOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v === "string" && v && !seen.has(v)) seen.add(v);
    if (seen.size >= ORDER_MAX) break;
  }
  return [...seen];
}

/**
 * The default list in the person's order. `groupOf` names the group a row belongs to (a pinned topic, an
 * unpinned one, an archived one): each group is ordered on its own, inside the slots it already held, so the
 * server's grouping (pinned first) can never be undone by a saved list. Rows the saved list does not know keep
 * their default slot; saved ids that match no row are ignored. Does not change the list it is given.
 */
export function applySavedOrder<T extends { id: string }>(
  items: readonly T[],
  saved: readonly string[] | null | undefined,
  groupOf: (item: T) => string = () => "",
): T[] {
  if (!saved || saved.length === 0 || items.length < 2) return [...items];
  const rank = new Map<string, number>();
  saved.forEach((id, i) => { if (!rank.has(id)) rank.set(id, i); });

  const out = [...items];
  const slots = new Map<string, number[]>();
  items.forEach((item, i) => {
    if (!rank.has(item.id)) return;
    const g = groupOf(item);
    const list = slots.get(g);
    if (list) list.push(i); else slots.set(g, [i]);
  });
  for (const places of slots.values()) {
    const sorted = places.map((i) => items[i]!).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    places.forEach((slot, n) => { out[slot] = sorted[n]!; });
  }
  return out;
}

/**
 * A drag turned into the whole list to save. `full` is every id of the list as shown, `group` the ids of the
 * rows that can be dragged among themselves (same group, same «مقطع»), in the order shown. The dragged row takes
 * the place of the one it is dropped on; every other row keeps its slot. Null when the drop means nothing
 * (itself, another group, an unknown row).
 */
export function moveWithinGroup(full: readonly string[], group: readonly string[], activeId: string, overId: string): string[] | null {
  const from = group.indexOf(activeId);
  const to = group.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return null;
  const moved = [...group];
  moved.splice(to, 0, moved.splice(from, 1)[0]!);
  const inGroup = new Set(group);
  const result = [...full];
  let n = 0;
  full.forEach((id, i) => { if (inGroup.has(id)) result[i] = moved[n++]!; });
  return result;
}
