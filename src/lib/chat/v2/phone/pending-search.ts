/**
 * C2.8 — «🔍 بحث» on the phone's info screen has to END in the conversation's search, but the search state lives in the conversation pane's provider and the
 * info screen is another page. So the screen leaves a note («open the search of this conversation») and the pane that mounts next reads it once. The note
 * expires after a few seconds: a person who never came back must not find the search open the next time they enter that conversation.
 */
export const PENDING_SEARCH_MS = 8000;

const notes = new Map<string, number>();

export function markPendingSearch(conversationId: string, now: number = Date.now()): void {
  notes.set(conversationId, now);
}

/** Is there a fresh note for this conversation? (does not consume it: a strict-mode render may ask twice; the pane clears it once it has mounted) */
export function peekPendingSearch(conversationId: string, now: number = Date.now()): boolean {
  const at = notes.get(conversationId);
  return at !== undefined && now - at <= PENDING_SEARCH_MS;
}

export function clearPendingSearch(conversationId: string): void {
  notes.delete(conversationId);
}
