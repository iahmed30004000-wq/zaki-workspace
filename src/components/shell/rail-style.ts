import { cn } from "@/lib/utils";

/**
 * The look of one cell of the rail — the owner's mock-up (`.rb`): 64 px wide, an icon over a 10.5 px semibold label, 12 px corners; the current one is the
 * accent on accent-soft, the others the muted text with a surface-2 wash on hover. The places, and every tool the chat's rail holds (the search, «جديد»,
 * the bell, the roster), wear the same cell, so the column reads as one. Theme tokens only.
 */
export const RAIL_CELL = "relative flex min-h-14 w-16 shrink-0 flex-col items-center gap-0.5 rounded-xl px-0.5 pb-[5px] pt-[7px] text-center text-[10.5px] font-semibold leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function railCellClass(active = false): string {
  return cn(RAIL_CELL, active ? "bg-accent/[0.12] text-accent" : "text-fg-muted hover:bg-surface-2 hover:text-fg");
}

/** The round number on a cell's icon (the mock-up's `.bd`): accent, 20 px high, the unread count of that place. */
export const RAIL_BADGE_POSITION = "absolute end-1.5 top-px";
