/**
 * «تيليجرام على التلفون» — which messages just went (so they can turn to dust and the others can settle), and the two notes the screen passes around:
 * «I am removing these» (a message that leaves the list for me only looks exactly like a dropped page, so it must be said) and «rows are about to move»
 * (a bubble that grows asks the log to slide its neighbours).
 */

/** The server's cap for one batch: more than this leaving at once is a new window of the history, not a deletion. */
export const MAX_REMOVALS = 100;
const ANNOUNCED_FOR_MS = 20_000;

const announced = new Map<string, number>();

export function announceRemoval(ids: readonly string[], now: number = Date.now()): void {
  for (const [id, at] of announced) if (now - at > ANNOUNCED_FOR_MS) announced.delete(id);
  for (const id of ids) announced.set(id, now);
}

export function isAnnouncedRemoval(id: string, now: number = Date.now()): boolean {
  const at = announced.get(id);
  return at !== undefined && now - at <= ANNOUNCED_FOR_MS;
}

export interface Removal {
  id: string;
  /** `deleted`: for everybody, its line stays; `removed`: it left the list (hidden for me) */
  kind: "deleted" | "removed";
}

type Held = { id: string; deleted: boolean };

export function removalsOf<T extends Held>(before: readonly T[], after: readonly T[], wasAnnounced: (id: string) => boolean): Removal[] {
  const now = new Map<string, T>(after.map((m) => [m.id, m] as const));
  const out: Removal[] = [];
  for (const message of before) {
    const next = now.get(message.id);
    if (next) {
      if (!message.deleted && next.deleted) out.push({ id: message.id, kind: "deleted" });
    } else if (wasAnnounced(message.id)) out.push({ id: message.id, kind: "removed" });
  }
  return out.length > MAX_REMOVALS ? [] : out;
}

/** How far to put a row back so that it slides from `before` to `after` (screen pixels). A hair, or more than a screen, is no slide. */
export function settleOffset(before: number, after: number, screenHeight: number): number {
  const delta = before - after;
  return Math.abs(delta) < 1 || Math.abs(delta) > screenHeight ? 0 : delta;
}

type SettleListener = (durationMs: number) => void;
const settleListeners = new Set<SettleListener>();

/** Called BEFORE the change that moves the rows: the log notes where they are now. */
export function requestSettle(durationMs: number): void {
  for (const listener of [...settleListeners]) listener(durationMs);
}

export function onSettleRequest(listener: SettleListener): () => void {
  settleListeners.add(listener);
  return () => void settleListeners.delete(listener);
}
