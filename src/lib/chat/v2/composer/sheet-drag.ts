import { TG_MOTION } from "@/lib/chat/v2/phone/motion";

/**
 * The phone's attach sheet under a finger (pure). It opens at half the screen; dragged up it becomes a full page, dragged down it steps back: the full page
 * to half, half to closed. `dy` is how far the finger moved, in pixels, positive downwards.
 */
export type SheetSize = "half" | "full";

/** A full page dragged down this many «close distances» goes all the way out. */
const CLOSE_FROM_FULL = 3;

export function sheetDragOutcome(size: SheetSize, dy: number): SheetSize | "close" {
  if (size === "half") {
    if (dy <= -TG_MOTION.sheetExpandPx) return "full";
    return dy >= TG_MOTION.sheetClosePx ? "close" : "half";
  }
  if (dy >= TG_MOTION.sheetClosePx * CLOSE_FROM_FULL) return "close";
  return dy >= TG_MOTION.sheetClosePx ? "half" : "full";
}

/** How far the sheet itself moves while the finger does: a full page cannot go higher. */
export const sheetDragOffset = (size: SheetSize, dy: number): number => (size === "full" ? Math.max(0, dy) : dy);
