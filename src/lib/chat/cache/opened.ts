/**
 * C1.5 — when each conversation was last OPENED by a person (a screen mounted on it, not a prefetch or a sync): the eviction order of
 * the device copy. Kept in memory, written into each conversation's record, and put back from there when the copy is read, so
 * «least recently opened» still means something after a restart. No imports: the writer and the persister both use it.
 */
const openedAt = new Map<string, number>();
const listeners = new Set<() => void>();

export function markConversationOpened(id: string, now: number = Date.now()): void {
  openedAt.set(id, now);
  for (const l of listeners) l();
}

/** The time stored with a copy comes back; a later opening in this page is never overwritten by an older stored one. */
export function restoreOpened(id: string, at: number): void {
  if (Number.isFinite(at) && at > (openedAt.get(id) ?? 0)) openedAt.set(id, at);
}

export function openedAtOf(id: string): number {
  return openedAt.get(id) ?? 0;
}

/** Called whenever a conversation is opened (the persister writes a moment later). Returns the function that stops listening. */
export function onOpened(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
