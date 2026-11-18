/** The id prefix of a pending message (`pending.ts` of the cache owns it, a test pins that the two agree): this file stays small, the old screen imports it. */
export const PENDING_ID_PREFIX_FOR_READS = "pending:";

/**
 * May a message be marked read right now? Only while the tab is VISIBLE and the window FOCUSED (F0.5): a message marked read in a
 * tab nobody looks at puts a ✓✓ on the sender's screen for something that was never seen.
 */
export function canMarkReadNow(page: { visibilityState: string; hasFocus: () => boolean } = document): boolean {
  return page.visibilityState === "visible" && page.hasFocus();
}

export interface ReadMarkerDeps {
  /** `POST /api/chat/conversations/<id>/read?upTo=<message id>`; true when the server accepted it */
  post: (conversationId: string, upToId: string) => Promise<boolean>;
  /** may a message be marked read right now (default: `canMarkReadNow`, the browser's own page) */
  canMark?: () => boolean;
  /** a mark was accepted (the screen tells the rest of the page: the badges, the list) */
  onMarked?: (conversationId: string) => void;
}

export interface ReadMarker {
  /**
   * The newest message that is really on screen is `newestId` (a screen opened, a message arrived, a refetch finished). `silent`: the owner's
   * oversight — never marks anything, not even later. `anchored`: older messages around a search hit are on screen, so the newest are NOT seen.
   */
  consider(conversationId: string, newestId: string | null, opts?: { silent?: boolean; anchored?: boolean }): void;
  /** The tab became visible or got focus: what waited is marked now, once. */
  resume(): void;
  /** The screen was closed: what waited and what was marked are forgotten. */
  forget(conversationId: string): void;
}

/**
 * C1.8 — WHEN a read mark goes out. Three rules, one place:
 *  1. only while the tab is visible AND focused (F0.5: a mark made in a tab nobody looks at puts a ✓✓ on the sender's screen for something that
 *     was never seen) — otherwise the newest waits and is marked once on return;
 *  2. only when the newest read message CHANGED since the last accepted mark of that conversation (a refetch, a reaction or a re-render of the same
 *     newest message sends nothing, and two considerations while a request is in flight send one);
 *  3. never for the owner's silent oversight, never for a pending message (its id is not the server's: `read?upTo=` would be a 404), never while
 *     older messages are on screen around a search hit.
 * The other clients do not refetch the messages for a mark: they apply the `reads` list of the sync answer (C1.4's `applyReads`).
 */
export function createReadMarker(deps: ReadMarkerDeps): ReadMarker {
  const canMark = deps.canMark ?? (() => canMarkReadNow());
  /** the id last accepted (or in flight) per conversation */
  const marked = new Map<string, string>();
  const waiting = new Map<string, string>();

  function send(conversationId: string, id: string): void {
    marked.set(conversationId, id);
    waiting.delete(conversationId);
    void deps
      .post(conversationId, id)
      .then(
        (ok) => ok,
        () => false,
      )
      .then((ok) => {
        if (ok) deps.onMarked?.(conversationId);
        // not accepted: it waits for the next return to the tab, and the next consideration of the same message tries again too
        else if (marked.get(conversationId) === id) {
          marked.delete(conversationId);
          waiting.set(conversationId, id);
        }
      });
  }

  return {
    consider(conversationId, newestId, opts = {}) {
      if (opts.silent || opts.anchored) {
        waiting.delete(conversationId);
        return;
      }
      if (!newestId || newestId.startsWith(PENDING_ID_PREFIX_FOR_READS)) return;
      if (marked.get(conversationId) === newestId) {
        waiting.delete(conversationId);
        return;
      }
      if (!canMark()) {
        waiting.set(conversationId, newestId);
        return;
      }
      send(conversationId, newestId);
    },
    resume() {
      if (!canMark()) return;
      for (const [conversationId, id] of [...waiting]) {
        if (marked.get(conversationId) === id) waiting.delete(conversationId);
        else send(conversationId, id);
      }
    },
    forget(conversationId) {
      waiting.delete(conversationId);
      // a screen opened again marks once more: the person may have marked the conversation unread, or read it on another device, in between
      marked.delete(conversationId);
    },
  };
}
