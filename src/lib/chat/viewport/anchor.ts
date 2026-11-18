/**
 * C1.7 — keeping the message on screen where it is when rows are put above it (an older page) or taken away above it (the cap).
 * Pure: the viewport hook records an anchor from the layout BEFORE the change and restores it once the new layout is measured.
 */

export interface AnchorItem {
  key: string | number | bigint;
  index: number;
  start: number;
  end: number;
}

export interface Anchor {
  key: string | number | bigint;
  /** the row's index before the change */
  index: number;
  /** the row's top minus the scroll offset: 0 = at the top edge of the view, negative = cut off above it */
  offset: number;
}

/**
 * The first row that is (even partly) in view, with its distance from the top of the view. `anchorable` says which rows may be held
 * on to: the hook passes «message rows only» — the day row and the unread row have keys that come and go with the pages (the day row
 * of the oldest message goes away when an older page of the same day arrives), and an anchor that vanishes restores nothing.
 */
export function captureAnchor(items: readonly AnchorItem[], scrollTop: number, anchorable: (item: AnchorItem) => boolean = () => true): Anchor | null {
  const item = items.find((i) => i.end > scrollTop && anchorable(i));
  return item ? { key: item.key, index: item.index, offset: item.start - scrollTop } : null;
}

/** The scroll offset that puts the anchor row back at its distance from the top, given where its top is now. Never negative. */
export function restoredScrollTop(anchor: Anchor, startOfAnchorNow: number): number {
  return Math.max(0, startOfAnchorNow - anchor.offset);
}

/**
 * Does the view need to move? Only when rows came or went ABOVE the anchor (its index changed). A message appended below leaves the
 * index alone and must not move the view; `newIndex` is -1 when the anchor row is gone.
 */
export function shouldRestore(anchor: Anchor | null, newIndex: number): boolean {
  return !!anchor && newIndex >= 0 && newIndex !== anchor.index;
}
