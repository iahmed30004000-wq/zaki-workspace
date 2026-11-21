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

/**
 * Where the window goes when the person drops it (the owner, 2026-11-21: «أقدر أحرّكها سواء بالموبايل أو باللابتوب»): ANYWHERE on the screen, not only a corner.
 * It is remembered as two fractions of the room there is (`fx` 0 = the left edge, 1 = the right edge; `fy` 0 = the top, 1 = the bottom), so a turned phone or a
 * resized window keeps it fully on screen with no measuring. `Spot`s are PHYSICAL (left to right), because that is where a finger drops it.
 */
export interface Spot {
  fx: number;
  fy: number;
}

export const SPOT_KEY = "zk-mini-call-spot";

const unit = (n: number): number => Math.min(Math.max(n, 0), 1);

export function parseSpot(value: unknown): Spot | null {
  let v: unknown = value;
  if (typeof value === "string") {
    try {
      v = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const { fx, fy } = v as Record<string, unknown>;
  if (typeof fx !== "number" || typeof fy !== "number" || !Number.isFinite(fx) || !Number.isFinite(fy)) return null;
  return { fx: unit(fx), fy: unit(fy) };
}

export function loadSpot(): Spot | null {
  try {
    return parseSpot(localStorage.getItem(SPOT_KEY));
  } catch {
    return null;
  }
}

export function saveSpot(spot: Spot): void {
  try {
    localStorage.setItem(SPOT_KEY, JSON.stringify(spot));
  } catch {
    // storage blocked: the window still moves, it only forgets
  }
}

/** The fractions of a window dropped at `box` (its rectangle), on a screen `view`, keeping `margin` from every edge and `insets` (the notch, the home bar) clear. */
export function spotOf(
  box: { left: number; top: number; width: number; height: number },
  view: { width: number; height: number },
  insets: { top: number; bottom: number },
  margin: number = EDGE_MARGIN_PX,
): Spot {
  const roomX = view.width - 2 * margin - box.width;
  const roomY = view.height - 2 * margin - insets.top - insets.bottom - box.height;
  return {
    fx: roomX > 0 ? unit((box.left - margin) / roomX) : 0,
    fy: roomY > 0 ? unit((box.top - margin - insets.top) / roomY) : 0,
  };
}

/**
 * The CSS that puts a window at `spot` (the same arithmetic as `spotOf`, in the browser's own units, so it needs the window's size by no measuring):
 * `left`/`top` take the fraction of the room, the transform takes back the same fraction of the window's own size.
 */
export function spotStyle(spot: Spot, margin: number = EDGE_MARGIN_PX): { left: string; top: string; transform: string; right: string; bottom: string } {
  const { fx, fy } = { fx: unit(spot.fx), fy: unit(spot.fy) };
  return {
    left: `calc(${margin}px + (100% - ${2 * margin}px) * ${fx})`,
    top: `calc(${margin}px + env(safe-area-inset-top) + (100% - ${2 * margin}px - env(safe-area-inset-top) - env(safe-area-inset-bottom)) * ${fy})`,
    right: "auto",
    bottom: "auto",
    transform: `translate(calc(-100% * ${fx}), calc(-100% * ${fy}))`,
  };
}
