/**
 * C2.5 — what the attach button («📎») offers. «صورة أو فيديو» and «ملف» always; «استطلاع» only where the server says I may make a poll (`me.canPoll`); «قائمة مهام» (C3c.1)
 * only where it says I may send a checklist (`me.canChecklist`: any conversation where a non-guest may post, the company's switch on). «من المنتجات» is the «⚡» button beside the box,
 * not an item of this menu.
 */
export type AttachItemId = "media" | "file" | "poll" | "checklist" | "location";

/** The tabs of the phone's attach sheet («تيليجرام على التلفون»): the same kinds, and «جهة اتصال» (an ordinary text message, so whoever may write may send one). The older menu offers `attachItemsOf`. */
export type AttachTabId = AttachItemId | "contact";

/** «الموقع» is offered only where the server says I may send my place (`me.canLocation`: I may post here and the company's `chatLocation` switch is on). */
export function attachTabsOf(me: { canPoll?: boolean; canChecklist?: boolean; canLocation?: boolean }): AttachTabId[] {
  return ["media", "file", ...(me.canLocation ? (["location"] as const) : []), ...(me.canPoll ? (["poll"] as const) : []), "contact", ...(me.canChecklist ? (["checklist"] as const) : [])];
}

export function attachItemsOf(me: { canPoll?: boolean; canChecklist?: boolean; canLocation?: boolean }): AttachItemId[] {
  return ["media", "file", ...(me.canPoll ? (["poll"] as const) : []), ...(me.canChecklist ? (["checklist"] as const) : []), ...(me.canLocation ? (["location"] as const) : [])];
}
