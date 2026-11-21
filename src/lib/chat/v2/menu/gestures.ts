/**
 * C2.6 — the gestures of a bubble that are decided by a pure rule.
 *
 *  - A double click REPLIES, on the computer. Not when the click lands on something that does its own thing (a link, a button, a player, a field, a
 *    picture's box), and never for a finger or a pen: the phone's double tap is the quick reaction, which is a setting of C4 — it is wired only when that
 *    setting exists, so nothing is wired on a touch screen yet.
 */
const OWN_THING = "a,button,input,textarea,select,video,audio,summary,[role=button],[data-no-reply]";

/** Is this press on something that does its own thing (a link, a button, a player, a field, a picture's box)? The gestures of a bubble leave it alone. */
export function isOwnThing(target: EventTarget | null): boolean {
  const el = target as { closest?: (selector: string) => unknown } | null;
  return !!el && typeof el.closest === "function" && !!el.closest(OWN_THING);
}

export function replyOnDoubleClick(event: { pointerType: string; target: EventTarget | null }): boolean {
  if (event.pointerType !== "mouse") return false;
  if (isOwnThing(event.target)) return false;
  return true;
}

/**
 * S5.7 (d) — «رد بالاقتباس»: the rules of a quote, shared by the screen (what it lets a selection become) and the server (what it keeps), so the two can never disagree.
 *
 *  - A quote is a piece of the words of the message being answered, cut to `QUOTE_MAX` characters (whole characters: never half of an emoji), with every run of spaces
 *    and line breaks made one space.
 *  - It is only ever stored with the reply it belongs to, and only when it really is a piece of the parent's words (`quoteIsPartOf`): nobody can put words in another
 *    person's mouth by hand-writing a quote.
 *  - A selection becomes a quote only when both of its ends are inside ONE message (`quoteFromSelection`).
 */
export const QUOTE_MAX = 280;

const squash = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The quote as it is kept: spaces squashed, at most `QUOTE_MAX` characters, or null when nothing is left. */
export function cleanQuote(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const flat = squash(text);
  if (!flat) return null;
  const chars = [...flat];
  return chars.length > QUOTE_MAX ? chars.slice(0, QUOTE_MAX).join("").trim() : flat;
}

/** Is `quote` a piece of any of the `sources` (the message's words as written, as drawn), spaces aside? */
export function quoteIsPartOf(quote: string, ...sources: readonly string[]): boolean {
  const q = squash(quote);
  if (!q) return false;
  return sources.some((s) => squash(s).includes(q));
}

/** A text selection → the quote of the one message it sits in, or null (nothing selected, or it crosses from one message into another). */
export function quoteFromSelection(selection: { text: string; anchorMessageId: string | null; focusMessageId: string | null }): { messageId: string; quote: string } | null {
  const quote = cleanQuote(selection.text);
  if (!quote || !selection.anchorMessageId || selection.anchorMessageId !== selection.focusMessageId) return null;
  return { messageId: selection.anchorMessageId, quote };
}
