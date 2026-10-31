import { decideSave, sameValue, type SaveDecision } from "@/lib/cards/versions";

/**
 * «المستندات» — versions. The same rule as a card's (src/lib/cards/versions.ts, reused, not copied): the editor sends the
 * version it started from; a document that moved on since answers 409; a save that changes nothing writes nothing.
 *
 * What differs is how much history is kept. A document is autosaved every few seconds while somebody types, so keeping a row
 * for every save would bury the real versions. A snapshot of what a save replaces is written when:
 *  - it is a restore (a restore always leaves its mark), or
 *  - somebody else is saving (their change must be undoable), or
 *  - the last save is older than `SNAPSHOT_GAP_MS` (a new sitting), or
 *  - nobody has saved it yet.
 * A run of quick saves by the same person is therefore ONE history row: the state before that sitting.
 */

export const DOC_FIELDS = ["title", "content"] as const;
export type DocField = (typeof DOC_FIELDS)[number];

export interface DocSnapshot {
  title: string;
  content: string;
}

/** Five minutes: a pause longer than this starts a new history row. */
export const SNAPSHOT_GAP_MS = 5 * 60 * 1000;

export function changedDocFields(current: DocSnapshot, next: Partial<DocSnapshot>): DocField[] {
  return DOC_FIELDS.filter((f) => next[f] !== undefined && !sameValue(current[f], next[f]));
}

export function decideDocSave(opts: { baseVersion: number | null | undefined; currentVersion: number; changed: readonly string[] }): SaveDecision {
  return decideSave(opts);
}

export function shouldSnapshot(opts: {
  lastEditorId: string | null;
  editorId: string;
  lastSavedAt: Date;
  now: Date;
  cause: "EDIT" | "RESTORE";
}): boolean {
  if (opts.cause === "RESTORE") return true;
  if (opts.lastEditorId === null || opts.lastEditorId !== opts.editorId) return true;
  return opts.now.getTime() - opts.lastSavedAt.getTime() > SNAPSHOT_GAP_MS;
}
