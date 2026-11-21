/**
 * The small call window's moving rules (src/components/calls/call-provider.tsx `MiniCall`), pure so they are tested without a browser: which corner
 * a dropped window snaps to, how far it may be dragged, what is a tap and what is a drag, and the corner it remembers on this device.
 * Corners are named by the page's logical sides (`start` is the right edge of a right-to-left page), like the rest of the app.
 */

export const CORNERS = ["top-start", "top-end", "bottom-start", "bottom-end"] as const;
export type Corner = (typeof CORNERS)[number];

/** Where the window sits until the person moves it: the bottom corner at the end of the line, where it always was. */
export const DEFAULT_CORNER: Corner = "bottom-end";

const KEY = "zk-mini-call-corner";

/** A press that moves less than this is a tap, not a drag. */
export const TAP_SLOP_PX = 6;
/** A dragged window keeps at least this far from every edge of the screen. */
export const EDGE_MARGIN_PX = 8;

export function parseCorner(value: unknown): Corner | null {
  return typeof value === "string" && (CORNERS as readonly string[]).includes(value) ? (value as Corner) : null;
}

/** The corner remembered on this device (private windows and blocked storage just forget it). */
export function loadCorner(): Corner {
  try {
    return parseCorner(localStorage.getItem(KEY)) ?? DEFAULT_CORNER;
  } catch {
    return DEFAULT_CORNER;
  }
}

export function saveCorner(corner: Corner): void {
  try {
    localStorage.setItem(KEY, corner);
  } catch {
    // storage blocked: the window still moves, it only forgets
  }
}

/**
 * The corner nearest to where the window was dropped: by the window's centre against the middle of the screen. `rtl`: the page reads right to left, so
 * the physical left half is the `end` side.
 */
export function nearestCorner(box: { x: number; y: number; width: number; height: number }, view: { width: number; height: number }, rtl: boolean): Corner {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const top = cy < view.height / 2;
  const physicalLeft = cx < view.width / 2;
  const start = rtl ? !physicalLeft : physicalLeft;
  return `${top ? "top" : "bottom"}-${start ? "start" : "end"}` as Corner;
}

/** A drag offset limited so the window (its rectangle where the drag began) stays inside the screen, `margin` from every edge. */
export function clampOffset(
  offset: { dx: number; dy: number },
  rect: { left: number; top: number; right: number; bottom: number },
  view: { width: number; height: number },
  margin: number = EDGE_MARGIN_PX,
): { dx: number; dy: number } {
  const lo = (min: number, max: number, v: number) => Math.min(Math.max(v, min), Math.max(min, max));
  return {
    dx: lo(margin - rect.left, view.width - margin - rect.right, offset.dx),
    dy: lo(margin - rect.top, view.height - margin - rect.bottom, offset.dy),
  };
}

/** Did the press end close to where it began (a tap on the window, which returns to the call)? */
export function isTap(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) <= TAP_SLOP_PX;
}
