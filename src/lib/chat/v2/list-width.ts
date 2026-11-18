import { browserStorage, type DraftStorage } from "@/lib/cards/draft";

/**
 * C2.1 — the width of the list column on the computer: 360 px to start, dragged between 300 and 480, kept per person on this device
 * (localStorage `zk-chat-list-w`). Pure apart from the storage object it is handed; every access is inside try/catch because storage
 * may be missing, full or blocked, and the column works the same without it.
 */
export const LIST_WIDTH_KEY = "zk-chat-list-w";
export const LIST_WIDTH_DEFAULT = 360;
export const LIST_WIDTH_MIN = 300;
export const LIST_WIDTH_MAX = 480;
/** one press of an arrow key on the resize handle */
export const LIST_WIDTH_STEP = 16;

export function clampListWidth(value: number): number {
  if (!Number.isFinite(value)) return LIST_WIDTH_DEFAULT;
  return Math.min(LIST_WIDTH_MAX, Math.max(LIST_WIDTH_MIN, Math.round(value)));
}

/** What is stored, or the default for anything else (a stranger's value, a damaged one). */
export function readListWidth(storage: DraftStorage | null = browserStorage()): number {
  if (!storage) return LIST_WIDTH_DEFAULT;
  try {
    const raw = storage.getItem(LIST_WIDTH_KEY);
    if (!raw || !/^\d{3}$/.test(raw)) return LIST_WIDTH_DEFAULT;
    return clampListWidth(Number(raw));
  } catch {
    return LIST_WIDTH_DEFAULT;
  }
}

export function saveListWidth(width: number, storage: DraftStorage | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(LIST_WIDTH_KEY, String(clampListWidth(width)));
  } catch {
    /* the width lives until the page closes */
  }
}

/**
 * The width a drag asks for. The column's resize edge is its END edge (the left in the right-to-left layout, where the list sits beside
 * the rail on the right): the pointer's distance from the START edge is the width, whichever way the page runs.
 */
export function widthFromPointer(clientX: number, rect: { left: number; right: number }, rtl: boolean): number {
  return clampListWidth(rtl ? rect.right - clientX : clientX - rect.left);
}

/** Arrow keys on the resize handle: the arrow that points away from the start edge widens the column. */
export function widthFromKey(width: number, key: string, rtl: boolean): number | null {
  if (key === "Home") return LIST_WIDTH_MIN;
  if (key === "End") return LIST_WIDTH_MAX;
  const widen = rtl ? "ArrowLeft" : "ArrowRight";
  const narrow = rtl ? "ArrowRight" : "ArrowLeft";
  if (key === widen) return clampListWidth(width + LIST_WIDTH_STEP);
  if (key === narrow) return clampListWidth(width - LIST_WIDTH_STEP);
  return null;
}
