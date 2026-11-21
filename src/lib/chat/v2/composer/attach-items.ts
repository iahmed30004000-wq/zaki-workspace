/**
 * C2.5 — what the attach button («📎») offers. «صورة أو فيديو» and «ملف» always; «استطلاع» only where the server says I may make a poll (`me.canPoll`); «قائمة مهام» (C3c.1)
 * only where it says I may send a checklist (`me.canChecklist`: any conversation where a non-guest may post, the company's switch on). «من المنتجات» is the «⚡» button beside the box,
 * not an item of this menu.
 */
export type AttachItemId = "media" | "file" | "poll" | "checklist";

export function attachItemsOf(me: { canPoll?: boolean; canChecklist?: boolean }): AttachItemId[] {
  return ["media", "file", ...(me.canPoll ? (["poll"] as const) : []), ...(me.canChecklist ? (["checklist"] as const) : [])];
}
