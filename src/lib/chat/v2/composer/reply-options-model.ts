import { cleanQuote, quoteIsPartOf } from "@/lib/chat/v2/menu/gestures";

/**
 * «خيارات الرد» — what the picked words become: a quoted PART of the message, an ordinary reply to the WHOLE of it (nothing picked, or everything), or
 * NOT a part of it (the server keeps a quote only when it really is a piece of the parent's words, so such a pick is refused here and said).
 */
export type QuoteChoice = { kind: "part"; quote: string } | { kind: "whole" } | { kind: "not-part" };

export function quoteChoice(picked: string, body: string): QuoteChoice {
  const quote = cleanQuote(picked);
  if (!quote || quote === cleanQuote(body)) return { kind: "whole" };
  return quoteIsPartOf(quote, body) ? { kind: "part", quote } : { kind: "not-part" };
}
