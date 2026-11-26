import type { MessageMenuAction, MessageMenuId } from "@/components/chat/message/message-menu-registry";
import { QUICK_PALETTE } from "@/lib/chat/v2/menu/quick-reactions";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";

/**
 * «تيليجرام على التلفون» — the pure rules of the tap menu: the seven reactions, the short list and where the two panels go. What is OFFERED stays the
 * registry's (`menuFor`): this file only splits and places what it is given.
 */

/** The spec's six, in its order: رد · نسخ · تحويل · تثبيت · تعديل · حذف. The rest of the registry's offer sits behind «المزيد», so nothing is lost. */
export const PHONE_MAIN_IDS: readonly MessageMenuId[] = ["reply", "copy", "forward", "pin", "edit", "delete"];

export function splitPhoneMenu(actions: readonly MessageMenuAction[]): { main: MessageMenuAction[]; more: MessageMenuAction[] } {
  const main = PHONE_MAIN_IDS.flatMap((id) => actions.filter((a) => a.id === id));
  return { main, more: actions.filter((a) => !PHONE_MAIN_IDS.includes(a.id)) };
}

const SEVENTH = ["🙏", "👏", "😍", "💯", "🤔", "😢", "⭐", "👌"] as const;

/** The person's six quick reactions and a seventh that is not among them. */
export function sevenReactions(quick: readonly string[]): string[] {
  const seventh = [...SEVENTH, ...QUICK_PALETTE].find((emoji) => !quick.includes(emoji));
  return seventh ? [...quick, seventh] : [...quick];
}

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface Placed {
  top: number;
  left: number;
  /** the point the panel grows from, in its own box */
  originX: number;
  originY: number;
}

const EDGE = 8;
const GAP = 8;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * The bar goes above the message and the menu below it. Both stay on the screen: near the top the bar stops at the edge and the menu follows under it; near
 * the bottom both move up (over the message, as Telegram's do), the bar always above the menu; a menu with no room gets `maxHeight` and scrolls.
 * `align` is the side of the screen the bubble sits on, so the panels hang from the same side.
 */
export function placeOverlay(input: {
  anchor: Rect;
  viewport: Size;
  bar: Size;
  menu: Size;
  align: "left" | "right";
  tap: { x: number; y: number } | null;
  insetTop?: number;
  insetBottom?: number;
}): { bar: Placed; menu: Placed & { maxHeight: number } } {
  const { anchor, viewport, bar, menu, align, tap } = input;
  const minTop = EDGE + (input.insetTop ?? 0);
  const maxBottom = viewport.height - EDGE - (input.insetBottom ?? 0);
  const leftFor = (width: number) => clamp(align === "left" ? anchor.left : anchor.left + anchor.width - width, EDGE, viewport.width - EDGE - width);

  // above the message, but never so low that the two do not fit between the bar and the bottom of the screen
  const barTop = clamp(anchor.top - GAP - bar.height, minTop, maxBottom - bar.height - GAP - menu.height);
  const underBar = barTop + bar.height + GAP;
  const wanted = Math.max(anchor.top + anchor.height + GAP, underBar);
  const menuTop = clamp(Math.min(wanted, maxBottom - menu.height), underBar, wanted);
  const barLeft = leftFor(bar.width);
  const menuLeft = leftFor(menu.width);
  const originX = (left: number, width: number) => clamp((tap ? tap.x : anchor.left + anchor.width / 2) - left, 0, width);

  return {
    bar: { top: barTop, left: barLeft, originX: originX(barLeft, bar.width), originY: bar.height },
    menu: { top: menuTop, left: menuLeft, originX: originX(menuLeft, menu.width), originY: 0, maxHeight: Math.max(maxBottom - menuTop, 0) },
  };
}

/** The reaction card («⌄»): as wide as the phone allows, starting where the bar was and moved only as far as it must to stay on the screen. */
export function placeCard(bar: { top: number; left: number }, viewport: Size, insetBottom = 0): Rect {
  const width = Math.min(viewport.width - EDGE * 2, 360);
  const height = Math.min(Math.round(viewport.height * 0.55), 400);
  return { width, height, top: clamp(bar.top, EDGE, viewport.height - EDGE - insetBottom - height), left: clamp(bar.left, EDGE, viewport.width - EDGE - width) };
}

/** How many rows are staggered; every later row appears with the last of them (nobody waits for a row he scrolled to). */
const STAGGERED_ROWS = 10;

/** When a row of the reaction card starts to fade in: after the morph, one row after the other, all done by `reactionCardFillMs`. */
export function cardRowDelayMs(row: number): number {
  const first = TG_MOTION.reactionCardMs;
  const last = TG_MOTION.reactionCardFillMs - TG_MOTION.cardRowFadeMs;
  return Math.round(first + (Math.min(Math.max(row, 0), STAGGERED_ROWS) / STAGGERED_ROWS) * (last - first));
}
