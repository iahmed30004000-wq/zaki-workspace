import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { ChecklistDto, ChecklistItemDto } from "@/server/chat/dto";
import { isSilentOwner } from "@/server/chat/poll-shared";

/**
 * «قائمة مهام» (C3c.1): the parts of a chat checklist that the send path (messages.ts), the presenter (redact.ts), the item routes (checklists.ts) and the
 * screens all need. Pure: no database, no session, and no import of messages.ts (so messages.ts can use it without a cycle).
 *
 * A checklist is a ChatMessage of kind CHECKLIST whose body is the TITLE. The items live in their own table: the title is the ONLY text of a checklist that any
 * other reader of a message (the chat list, the bell, the push, the search, the assistant, the digest) ever sees. An item's words reach a screen only through
 * `presentChecklist`, for a person who may read the conversation.
 */

/** The value of `ChatMessage.kind` (a text column: no enum change) and of the wire `kind` of a checklist message. */
export const CHECKLIST_KIND = "CHECKLIST";
export const MIN_CHECKLIST_ITEMS = 1;
export const MAX_CHECKLIST_ITEMS = 30;
export const MAX_CHECKLIST_ITEM_LENGTH = 200;
export const MAX_CHECKLIST_TITLE = 200;

/** The `checklist` field of a send: the title travels as the message body. */
export const checklistInputSchema = z.object({
  items: z.array(z.string().max(MAX_CHECKLIST_ITEM_LENGTH * 3)).min(MIN_CHECKLIST_ITEMS).max(MAX_CHECKLIST_ITEMS),
  // «الكل يضيف»: anyone who may post here may add an item (default: only the author)
  othersCanAdd: z.boolean().optional(),
  // «الكل يعلّم»: anyone who may post here may tick an item (default: yes)
  othersCanTick: z.boolean().optional(),
});

export type ChecklistInput = z.infer<typeof checklistInputSchema>;

/** Characters that draw nothing: white space, zero width spaces and joiners, the direction marks, the word joiner, the byte order mark. A text of only these is a blank one. */
const INVISIBLE = /[\s​-‏‪-‮⁠﻿]/g;
export const isBlankText = (raw: string): boolean => raw.replace(INVISIBLE, "").length === 0;

/** One item's words as they will be stored: whitespace folded, trimmed; null when empty (invisible characters only) or longer than 200 characters. */
export function cleanChecklistText(raw: string): string | null {
  if (isBlankText(raw)) return null;
  const text = raw.trim().replace(/\s+/g, " ");
  if (text.length === 0) return null;
  if ([...text].length > MAX_CHECKLIST_ITEM_LENGTH) return null;
  return text;
}

/** The items as they will be stored: trimmed, blanks dropped; null when one is too long or they are not 1-30. */
export function cleanChecklistItems(items: string[]): string[] | null {
  const kept: string[] = [];
  for (const raw of items) {
    if (isBlankText(raw)) continue;
    const text = cleanChecklistText(raw);
    if (text === null) return null;
    kept.push(text);
  }
  if (kept.length < MIN_CHECKLIST_ITEMS || kept.length > MAX_CHECKLIST_ITEMS) return null;
  return kept;
}

/** What the message row creates alongside itself (the nested write of `chatMessage.create`). */
export function checklistCreateData(input: ChecklistInput, items: string[], authorId: string): Prisma.ChatChecklistCreateWithoutMessageInput {
  return {
    othersCanAdd: input.othersCanAdd === true,
    othersCanTick: input.othersCanTick !== false,
    items: { create: items.map((text, position) => ({ text, position, addedById: authorId })) },
  };
}

/** The include every message query carries so `presentChecklist` has what it needs. */
export const checklistInclude = {
  items: {
    orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
    select: { id: true, text: true, position: true, addedById: true, doneById: true, doneAt: true, doneBy: { select: { name: true } } },
  },
} satisfies Prisma.ChatChecklistInclude;

export type ChecklistRow = {
  id: string;
  othersCanAdd: boolean;
  othersCanTick: boolean;
  items: { id: string; text: string; addedById: string; doneById: string | null; doneAt: Date | null; doneBy: { name: string } | null }[];
};

export type ChecklistViewer = {
  userId: string;
  role: string;
  /** the viewer holds silent oversight (`archive.view`); absent: an OWNER-rank viewer is read as holding it */
  oversight?: boolean;
  /** the viewer is a row of the conversation (the owner only where he joined) */
  isMember: boolean;
  canModerateHere: boolean;
  /** the viewer may post in this conversation (the policy's `canPost`); absent reads as «no» — a hand-made viewer never gets a button */
  canPost?: boolean;
  /** the company's switch `chatChecklists`: `false` draws the list with no working box or button (the data stays); absent reads as on */
  checklists?: boolean;
};

/** Who may do what to ONE checklist: the single rule, used by the presenter AND by the routes (so a button never lies and a route never differs). */
export function checklistRights(
  viewer: ChecklistViewer,
  list: { authorId: string; othersCanAdd: boolean; othersCanTick: boolean },
  deleted = false,
): { silent: boolean; guest: boolean; add: boolean; tick: boolean; moderate: boolean } {
  const guest = viewer.role === "GUEST";
  // the silent eye neither adds nor ticks (a tick carries a name and a time, and his reading leaves no trace): he joins first, like for a poll
  const silent = isSilentOwner(viewer);
  const may = !deleted && !guest && !silent && viewer.canPost === true && viewer.checklists !== false;
  const author = viewer.userId === list.authorId;
  return { silent, guest, add: may && (author || list.othersCanAdd), tick: may && (author || list.othersCanTick), moderate: !deleted && !guest && !silent && viewer.canModerateHere };
}

/**
 * May this viewer reword or remove this item: the item's author, the list's author, a moderator — and only while they may write here (a muted person, a closed topic and a
 * poster-only topic freeze the list for everybody, a moderator included); never a guest, never the silent eye.
 */
export function mayEditItem(viewer: ChecklistViewer, list: { authorId: string }, item: { addedById: string }, deleted = false): boolean {
  if (deleted || viewer.role === "GUEST" || isSilentOwner(viewer) || viewer.checklists === false || viewer.canPost !== true) return false;
  return viewer.userId === list.authorId || viewer.userId === item.addedById || viewer.canModerateHere;
}

/** «3 من 5»: how many items are done, of how many. */
export function checklistProgress(items: readonly { done: boolean }[]): { done: number; total: number } {
  return { done: items.filter((i) => i.done).length, total: items.length };
}

/**
 * One checklist for one viewer. The list is shown to everybody who reads the conversation; who ticked an item is named to staff only (a guest gets the
 * tick, never the name). A deleted message hides its list (the caller does not call this for one).
 */
export function presentChecklist(row: ChecklistRow, viewer: ChecklistViewer, authorId: string, deleted: boolean): ChecklistDto {
  const rights = checklistRights(viewer, { authorId, othersCanAdd: row.othersCanAdd, othersCanTick: row.othersCanTick }, deleted);
  const items: ChecklistItemDto[] = row.items.map((i) => {
    const done = i.doneAt !== null;
    const dto: ChecklistItemDto = { id: i.id, text: i.text, done, canEdit: mayEditItem(viewer, { authorId }, i, deleted) };
    if (done) {
      dto.doneAt = i.doneAt!.toISOString();
      if (!rights.guest) dto.doneByName = i.doneBy?.name ?? null;
    }
    return dto;
  });
  return {
    id: row.id,
    othersCanAdd: row.othersCanAdd,
    othersCanTick: row.othersCanTick,
    items,
    ...checklistProgress(items),
    canAdd: rights.add && items.length < MAX_CHECKLIST_ITEMS,
    canTick: rights.tick,
    max: MAX_CHECKLIST_ITEMS,
  };
}
