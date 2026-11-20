import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ConversationHeaderDto, MessageDto } from "@/server/chat/dto";
import { isPendingMessage } from "@/lib/chat/cache/pending";
import { fmtDMY, fmtShort, fmtTime } from "@/lib/format";

/**
 * C3b.5 — «حدّد»: the selection of messages in the open conversation, as ONE small store plus the pure rules around it.
 *
 * Why a store and not a context: the messages (the viewport), the menu of each message and the bar (the pane's header) are separate branches that no provider of
 * this package wraps, and all of them must read the same ids. The store is a module singleton on purpose — the screen has one open conversation — and it knows
 * WHICH one: the viewport `attach`es the conversation it draws (with the company's switch `chatMultiSelect` read from the header) and `detach`es it when it
 * goes, a selection belongs to the conversation it began in, and a selection of another one is dropped. So it can never act on the wrong chat.
 *
 * What may be done with a selection is decided here for the bar (a button is disabled where the door would refuse), and again by every door.
 */

/** The server's cap for a batch (messages per request); the store holds no more. */
export const SELECT_MAX = 100;

export interface SelectionState {
  /** the company's switch `chatMultiSelect` as the open conversation's viewport read it: false, nothing begins and no check or bar is drawn */
  enabled: boolean;
  /** the conversation the viewport draws now */
  open: string | null;
  /** the conversation the picked ids belong to (while selecting) */
  conversationId: string | null;
  /** the picked ids, in the order they were picked (the conversation's order is applied by `orderedSelection`) */
  ids: readonly string[];
  /** selecting: at least one message is picked */
  active: boolean;
}

const IDLE: SelectionState = { enabled: false, open: null, conversationId: null, ids: [], active: false };
const cleared = (s: SelectionState): SelectionState => ({ ...s, conversationId: null, ids: [], active: false });

let state: SelectionState = IDLE;
const listeners = new Set<() => void>();
const set = (next: SelectionState) => {
  if (next === state) return;
  state = next;
  for (const listener of [...listeners]) listener();
};

export const selectionStore = {
  get: (): SelectionState => state,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  /**
   * The viewport draws `conversationId` and the company's switch says `enabled`. A selection of another conversation is dropped, and so is one while the switch is off.
   * The same call again changes nothing.
   */
  attach: (conversationId: string, enabled: boolean): void => {
    const drop = state.active && (!enabled || state.conversationId !== conversationId);
    if (!drop && state.open === conversationId && state.enabled === enabled) return;
    set({ ...(drop ? cleared(state) : state), open: conversationId, enabled });
  },
  /** The viewport of `conversationId` went away (another conversation, the list): nothing is selectable until the next `attach`. */
  detach: (conversationId: string): void => {
    if (state.open === conversationId) set({ ...IDLE });
  },
  /** «حدّد» was picked on a message of the open conversation: selection starts with it. Nothing while the switch is off. */
  begin: (messageId: string): void => {
    if (!state.enabled || !state.open) return;
    set({ ...state, conversationId: state.open, ids: [messageId], active: true });
  },
  /** Pick or unpick one message. Unpicking the last one leaves the selection (Telegram does). A 101st is refused: `"full"`. */
  toggle: (messageId: string): "added" | "removed" | "full" => {
    if (!state.active) return "removed";
    if (state.ids.includes(messageId)) {
      const ids = state.ids.filter((id) => id !== messageId);
      set(ids.length ? { ...state, ids } : cleared(state));
      return "removed";
    }
    if (state.ids.length >= SELECT_MAX) return "full";
    set({ ...state, ids: [...state.ids, messageId] });
    return "added";
  },
  /** Leave the selection (Esc, the bar's ✕, an action that finished). */
  end: (): void => {
    if (state.active) set(cleared(state));
  },
  /** Back to the very start, switch included (tests). */
  reset: (): void => set({ ...IDLE }),
};

/** The selection as the screen reads it. */
export function useSelection(): SelectionState {
  return useSyncExternalStore(selectionStore.subscribe, selectionStore.get, selectionStore.get);
}

/** Only the switch (a menu per message listens, and must not draw again for every check that is ticked). */
export function useSelectionEnabled(): boolean {
  return useSyncExternalStore(selectionStore.subscribe, () => selectionStore.get().enabled, () => selectionStore.get().enabled);
}

/** The door that answers 404 while the company's switch is off and 200 while it is on: the screen asks it when the header does not carry the switch. */
export const MULTI_SELECT_PROBE = "/api/chat/messages/delete";

/** The switch the header carries (`chatMultiSelect`), when it carries one. */
function headerSwitch(header: ConversationHeaderDto): boolean | undefined {
  const field = (header as ConversationHeaderDto & { chatMultiSelect?: unknown }).chatMultiSelect;
  return typeof field === "boolean" ? field : undefined;
}

/**
 * The company's switch `chatMultiSelect` for the screen: what the header says when it says (true or false), else what the probe door answered — and while that is not known (not
 * asked yet, or the asking failed) the answer is NO, so no check, bar or «حدّد» is ever drawn for a company that switched it off.
 */
export function resolveMultiSelect(header: ConversationHeaderDto, probe: boolean | undefined): boolean {
  return headerSwitch(header) ?? probe === true;
}

/** The switch as the viewport reads it: the header's own field when there is one, else ONE cheap probe of the door (kept for five minutes, shared by every conversation). */
export function useMultiSelectSwitch(header: ConversationHeaderDto): boolean {
  const known = headerSwitch(header) !== undefined;
  const probe = useQuery({
    queryKey: ["chat-switch", "multiSelect"],
    enabled: !known,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const res = await fetch(MULTI_SELECT_PROBE, { cache: "no-store" });
      if (res.status === 404) return false;
      if (!res.ok) throw new Error("probe");
      return true;
    },
  });
  return resolveMultiSelect(header, probe.data);
}

/** May this message be picked: one the server has, not deleted, not a system line. */
export function isSelectable(message: MessageDto): boolean {
  return !isPendingMessage(message) && !message.deleted && message.kind !== "SYSTEM";
}

/** The picked messages in the conversation's order (not the order they were picked), without ids the loaded window no longer holds. */
export function orderedSelection(ids: readonly string[], messages: readonly MessageDto[]): MessageDto[] {
  const picked = new Set(ids);
  return messages.filter((m) => picked.has(m.id) && isSelectable(m));
}

/** What forwarding takes: everything but polls (a copy would carry no votes). `skipped` counts the ones left out. */
export function forwardableOf(messages: readonly MessageDto[]): { forward: MessageDto[]; skipped: number } {
  const forward = messages.filter((m) => isSelectable(m) && m.kind !== "POLL");
  return { forward, skipped: messages.length - forward.length };
}

/** What deleting takes: my own messages, or any for a moderator; never one already deleted. */
export function deletableOf(messages: readonly MessageDto[], canModerate: boolean): MessageDto[] {
  return messages.filter((m) => isSelectable(m) && (m.mine || canModerate));
}

const hasWords = (m: MessageDto) => (m.body ?? "").trim().length > 0;

/**
 * «انسخ»: for each message with words, its author and time (the device's clock, 24 hours, Western digits: `fmtTime`; with the day too when the selection spans more than one),
 * then the words; a blank line between them. A message with no words (a voice note) is left out.
 */
export function copyTextOf(messages: readonly MessageDto[]): string {
  const picked = messages.filter((m) => isSelectable(m) && hasWords(m));
  const manyDays = new Set(picked.map((m) => fmtDMY(m.createdAt))).size > 1;
  return picked.map((m) => `${m.authorName}، ${manyDays ? `${fmtShort(m.createdAt)} ` : ""}${fmtTime(m.createdAt)}\n${(m.body ?? "").trim()}`).join("\n\n");
}

export interface SelectionActions {
  forward: boolean;
  copy: boolean;
  delete: boolean;
  task: boolean;
}

/** Which of the bar's four buttons are enabled for these messages. The doors decide again; this only keeps the screen from asking for what is certain to be refused. */
export function selectionActionsOf(messages: readonly MessageDto[], me: { canModerate: boolean; canMakeTask: boolean }): SelectionActions {
  const picked = messages.filter(isSelectable);
  return {
    forward: forwardableOf(picked).forward.length > 0,
    copy: picked.some(hasWords),
    delete: deletableOf(picked, me.canModerate).length > 0,
    task: me.canMakeTask && picked.some(hasWords),
  };
}

/** Esc leaves the selection — unless the focus is in a field (the composer's own Esc comes first) or a dialog, sheet or menu is open (it closes first). */
export function escapeLeavesSelection(s: { active: boolean; editable: boolean; overlayOpen: boolean }): boolean {
  return s.active && !s.editable && !s.overlayOpen;
}
