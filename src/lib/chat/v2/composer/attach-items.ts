/**
 * C2.5 — what the attach button («📎») offers. «صورة أو فيديو» and «ملف» always; «استطلاع» only where the server says I may make a poll (`me.canPoll`).
 * «قائمة مهام» is C3c.1 and is NOT here, and «من المنتجات» is the «⚡» button beside the box, not an item of this menu.
 */
export type AttachItemId = "media" | "file" | "poll";

export function attachItemsOf(me: { canPoll?: boolean }): AttachItemId[] {
  return me.canPoll ? ["media", "file", "poll"] : ["media", "file"];
}
