import { CHECKLIST_KIND, isBlankText, MAX_CHECKLIST_ITEM_LENGTH, MAX_CHECKLIST_ITEMS, MAX_CHECKLIST_TITLE } from "@/lib/chat/checklist";

/**
 * «قائمة مهام» (C3c.1): the small pure parts of the checklist screens (the composer's dialog and the bubble), so they can be tested without a browser.
 */

export const CHECKLIST_TITLE_MAX = MAX_CHECKLIST_TITLE;
export const CHECKLIST_ITEM_MAX = MAX_CHECKLIST_ITEM_LENGTH;
export const CHECKLIST_MAX_ITEMS = MAX_CHECKLIST_ITEMS;

export type ChecklistDraft = { title: string; items: string[]; othersCanAdd: boolean; othersCanTick: boolean };

export const emptyChecklistDraft = (): ChecklistDraft => ({ title: "", items: ["", ""], othersCanAdd: false, othersCanTick: true });

/** The items the server would keep: whitespace folded, blanks dropped. */
export const filledItems = (draft: ChecklistDraft): string[] => draft.items.filter((i) => !isBlankText(i)).map((i) => i.trim().replace(/\s+/g, " "));

/** Why the draft cannot be sent yet (null: it can) — the same rules as the server's, so the button never lies. */
export function checklistDraftProblem(draft: ChecklistDraft): "title" | "items" | "too_many" | "too_long" | null {
  const title = draft.title.trim();
  if (isBlankText(title) || [...title].length > CHECKLIST_TITLE_MAX) return "title";
  const items = filledItems(draft);
  if (items.length < 1) return "items";
  if (items.length > CHECKLIST_MAX_ITEMS) return "too_many";
  if (items.some((i) => [...i].length > CHECKLIST_ITEM_MAX)) return "too_long";
  return null;
}

/** The body of the send request that creates the list: the title is the message body. */
export function buildChecklistPayload(draft: ChecklistDraft, clientId: string) {
  return {
    body: draft.title.trim(),
    clientId,
    checklist: {
      items: filledItems(draft),
      ...(draft.othersCanAdd ? { othersCanAdd: true } : {}),
      ...(draft.othersCanTick ? {} : { othersCanTick: false }),
    },
  };
}

export type ChecklistAction =
  | { type: "add"; text: string }
  | { type: "tick"; itemId: string; done: boolean }
  | { type: "edit"; itemId: string; text: string }
  | { type: "remove"; itemId: string };

/** The request an action of the bubble makes (every one answers the message as the caller now sees it). */
export function checklistRequestOf(messageId: string, action: ChecklistAction): { url: string; method: "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown } {
  const base = `/api/chat/messages/${encodeURIComponent(messageId)}/checklist/items`;
  switch (action.type) {
    case "add":
      return { url: base, method: "POST", body: { text: action.text } };
    case "tick":
      return { url: `${base}/${encodeURIComponent(action.itemId)}`, method: "PUT", body: { done: action.done } };
    case "edit":
      return { url: `${base}/${encodeURIComponent(action.itemId)}`, method: "PATCH", body: { text: action.text } };
    case "remove":
      return { url: `${base}/${encodeURIComponent(action.itemId)}`, method: "DELETE" };
  }
}

/** True for the message that carries a list: «اعمل منها مهمة» on it must copy the items into the task's steps, from every door. */
export const isChecklistMessage = (message: { kind?: string | undefined }): boolean => message.kind === CHECKLIST_KIND;

/** «اعمل منها مهمة» on a list: after the task is made (the one door of messages, `POST …/task`), this writes the list's items as its steps. */
export function checklistStepsRequest(messageId: string, taskId: string): { url: string; method: "POST"; body: { taskId: string } } {
  return { url: `/api/chat/messages/${encodeURIComponent(messageId)}/checklist/steps`, method: "POST", body: { taskId } };
}

/** The line under a ticked item: who finished it and when. A guest is not told who (the server leaves the name out), so he reads only the time. */
export function doneLineKey(item: { done: boolean; doneByName?: string | null }): "chatcl.done_by" | "chatcl.done_at" | null {
  if (!item.done) return null;
  return item.doneByName ? "chatcl.done_by" : "chatcl.done_at";
}
