/**
 * C2.6 — «نسخ الرابط»: the address of ONE message, `/chat/<conversation>?m=<message>` — the address the search hits and the notifications already open
 * (the conversation page reads `?m=` and opens around that message with the 2 s highlight). It is only an address: whoever opens it is checked by the
 * server like any other visit, so a link copied from a private conversation opens nothing for a person who is not in it.
 */
export function messageLinkOf(origin: string, conversationId: string, messageId: string): string {
  return `${origin.replace(/\/+$/, "")}/chat/${encodeURIComponent(conversationId)}?m=${encodeURIComponent(messageId)}`;
}
