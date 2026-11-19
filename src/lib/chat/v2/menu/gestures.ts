/**
 * C2.6 — the gestures of a bubble that are decided by a pure rule.
 *
 *  - A double click REPLIES, on the computer. Not when the click lands on something that does its own thing (a link, a button, a player, a field, a
 *    picture's box), and never for a finger or a pen: the phone's double tap is the quick reaction, which is a setting of C4 — it is wired only when that
 *    setting exists, so nothing is wired on a touch screen yet.
 */
const OWN_THING = "a,button,input,textarea,select,video,audio,summary,[role=button],[data-no-reply]";

export function replyOnDoubleClick(event: { pointerType: string; target: EventTarget | null }): boolean {
  if (event.pointerType !== "mouse") return false;
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  if (target && typeof target.closest === "function" && target.closest(OWN_THING)) return false;
  return true;
}
