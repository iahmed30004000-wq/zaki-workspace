import { DOUBLE_TAP_MS, DOUBLE_TAP_SLOP, type TapPoint } from "@/lib/chat/v2/menu/quick-reactions";

/**
 * «تيليجرام على التلفون» — what a finger does on a bubble: a TAP opens the menu, a LONG PRESS starts the selection. The quick reaction of a double tap is
 * kept without making the menu wait: the menu opens on the first tap, and a second tap that comes soon and near it (it lands on the menu's own layer)
 * closes the menu and puts the reaction.
 */

/** A press that moved this far was a scroll or a swipe. */
export const TAP_SLOP = 10;

/** What keeps its own tap: links, buttons, players, fields, a hidden spoiler. */
export const TAP_OWN_THING = "a,button,input,textarea,select,label,video,audio,summary,[role=button],[role=checkbox],[role=radio],[role=link],[role=slider],[data-no-reply],[data-spoiler=hidden]";

export function opensMenuOnTap(press: {
  /** the press is inside the bubble's own box (a dialog the bubble opened also bubbles here through React) */
  inside: boolean;
  target: EventTarget | null;
  movedPx: number;
  hasSelection: boolean;
}): boolean {
  if (!press.inside || press.hasSelection || press.movedPx > TAP_SLOP) return false;
  const target = press.target as { closest?: (selector: string) => unknown } | null;
  return !(target && typeof target.closest === "function" && target.closest(TAP_OWN_THING));
}

/** The long press: on the phone it selects where the screen can select; everywhere else it opens the menu, as it did. */
export function longPressDoes(i: { phone: boolean; canSelect: boolean }): "select" | "menu" {
  return i.phone && i.canSelect ? "select" : "menu";
}

export function isSecondTap(first: TapPoint, second: TapPoint): boolean {
  return second.at - first.at <= DOUBLE_TAP_MS && Math.hypot(second.x - first.x, second.y - first.y) <= DOUBLE_TAP_SLOP;
}
