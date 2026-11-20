import type { ChatRowDto } from "@/lib/chat/cache/types";
import { ct } from "@/lib/chat/text";
import type { MediaItemDTO } from "@/server/services/knowledge-media";

/**
 * C3w.2 (Q1.2, Q1.3) — «/آراء» and the picker for «ابعتيها بالمحادثة»: the pure parts.
 *
 *   «/آراء حراك»   the customers' feedback of the product «حراك» (the space after the word says the person has finished it, like the other «/» words)
 *
 * What may be sent is only what the sheet's own door offers: an item of the feedback gallery that has the customer's consent AND an approver's approval (an editor's list
 * also carries the unapproved ones, marked by `state`, and those are never offered here). The server refuses the rest again.
 */
/** The word after the slash (a key of the dictionary: no Arabic letter in a literal of the code). */
export const feedbackWord = (): string => ct("chatui.feedback.word");
export const MAX_FEEDBACK_SEND = 10;
const MAX_COMMAND = 120;

export function feedbackCommand(text: string): { q: string } | null {
  if (text.length > MAX_COMMAND || /[\r\n]/.test(text)) return null;
  const m = /^\/(\S+)\s(.*)$/su.exec(text);
  if (!m || m[1] !== feedbackWord()) return null;
  return { q: (m[2] ?? "").trim() };
}

/** The feedback a person may send: no `state` (a reader's list holds only approved items) or consent and approval both there. */
export function offerableFeedback(items: readonly MediaItemDTO[]): MediaItemDTO[] {
  return items.filter((item) => item.role === "FEEDBACK" && (!item.state || (item.state.consent && item.state.approved)));
}

/** The ids the sheet's «ابعتيهم بالمحادثة» sends: the chosen pictures that may go (an editor's list also holds the unapproved ones), at most ten, in the order chosen. */
export function sendableFeedbackIds(chosen: readonly MediaItemDTO[]): string[] {
  return offerableFeedback(chosen)
    .slice(0, MAX_FEEDBACK_SEND)
    .map((item) => item.id);
}

export interface PickableChat {
  id: string;
  title: string;
  emoji: string | null;
  /** the space a topic belongs to (a private chat has none) */
  space: string | null;
}

/**
 * The conversations a picture can be sent into, from the rows of the chat list: private chats, groups and topics (a space row is not a conversation: its topics, which the
 * row carries as chips, are). Chats the person archived are left out. The server decides again who may post where.
 */
export function pickableChats(rows: readonly ChatRowDto[], query = ""): PickableChat[] {
  const out: PickableChat[] = [];
  for (const row of rows) {
    if (row.archivedByMe) continue;
    if (row.kind === "SPACE") {
      for (const chip of row.topicChips ?? []) out.push({ id: chip.id, title: chip.title, emoji: chip.emoji ?? null, space: row.title });
    } else out.push({ id: row.id, title: row.title, emoji: row.emoji, space: row.kind === "TOPIC" ? (row.space?.name ?? null) : null });
  }
  const q = query.trim().toLowerCase();
  return q ? out.filter((chat) => chat.title.toLowerCase().includes(q) || (chat.space ?? "").toLowerCase().includes(q)) : out;
}

/** Sends the picked items one after another through `send` (one message each); it stops at the first failure and says how many went. */
export async function sendInOrder<T>(ids: readonly string[], send: (id: string) => Promise<T>): Promise<{ sent: T[]; failed: boolean }> {
  const sent: T[] = [];
  for (const id of ids) {
    try {
      sent.push(await send(id));
    } catch {
      return { sent, failed: true };
    }
  }
  return { sent, failed: false };
}
