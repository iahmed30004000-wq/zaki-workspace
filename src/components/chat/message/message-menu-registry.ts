/**
 * The ONE source of what the message menu offers. Each decision mirrors the server's rule, so the menu
 * never shows a door the server would close (the old buttons offered «تعديل» to a moderator on
 * somebody else's message and «تثبيت» to the wrong people):
 *
 * - reply: wherever I may post (`me.canPost`);
 * - react: any message I may read, except while the OWNER reads in silent oversight (toggleReact);
 * - pin: a DM's two people; in a topic or group, its moderators (togglePin);
 * - forward: any message I may read except a poll (forwardMessage checks the target when it is picked);
 * - edit: my own message only, never a voice note (editMessage: author only; a voice note has no text);
 * - delete: my own message, or a moderator's (deleteMessage), after a confirmation;
 * - note: the moderators (addNote);
 * - copy: a message with text;
 * - task / ticket: a message with text, for anybody who may make work of it (not a guest, not the owner in
 *   silent oversight — src/server/chat/make-work.ts);
 * - remind: «ذكّرني», a reminder for MYSELF on a message I may read: any message with the company's `reminders` switch on
 *   (`me.canRemind`: the server sets it from the switch and never in silent oversight; the reminder itself is checked
 *   again when it is set, src/server/services/reminders.ts).
 *
 * - translate: «ترجم», a text message, where the server says the person may (`me.canTranslate`: the switch `messageTranslate` and the
 *   assistant are on, staff, no guest in the conversation; the route checks all of it again).
 *
 * C2.6 — the items only the NEW screen (`chatLayoutV2`) has a handler for. They are opt-in: the context says `surface: "v2"`, so the old screen and
 * the quick chat (which build their context without it) never receive an id they cannot run:
 *
 * - copyLink: «نسخ الرابط», `/chat/<id>?m=<message>`: any message I may read (no door: the link only points; the server checks the reader on open);
 * - readText: «اقرأ النص», a picture, where the header says `imageOcr` (the same button the picture draws under itself);
 * - transcribe: «حوّل الصوت لنص», a voice note, where the header says `voiceTranscript` (the same button the note draws);
 * - seen: «مين شاف», a topic or a group, when somebody's newest read message is this one (today's reader list);
 * - ask: «اسألي مشرفتك», the «🎫 مشكلة» door with the question kind, where the company's kinds have it.
 * «حدّد» (select) is C3b.5: it has no action yet, so its id is NOT here.
 *
 * Nothing at all on a deleted message, a system line, or for the owner in silent oversight.
 */
export type MessageMenuId = "reply" | "pin" | "forward" | "edit" | "delete" | "note" | "copy" | "task" | "ticket" | "problem" | "mustread" | "remind" | "translate" | "copyLink" | "readText" | "transcribe" | "seen" | "ask";

export interface MessageMenuContext {
  mine: boolean;
  deleted: boolean;
  kind: "TEXT" | "VOICE" | "SYSTEM" | "POLL" | "CARD";
  hasText: boolean;
  pinned: boolean;
  conversationKind: "DM" | "GROUP" | "TOPIC";
  canPost: boolean;
  canModerate: boolean;
  oversight: boolean;
  /** may turn a message into a task or a ticket (`me.canMakeWork`) */
  canMakeWork?: boolean;
  /** …and holds the tasks / tickets «يضيف ويعدّل» box of the section grid (absent: yes) */
  canMakeTask?: boolean;
  canMakeTicket?: boolean;
  /** «🎫 مشكلة» is offered (`me.problemKinds` is there: the switch `autoTickets` is on and the person is staff) */
  canProblem?: boolean;
  /** may mark this message «لازم ينقرأ» (`me.canMustRead`), and whether it already is (the menu says the opposite) */
  canMustRead?: boolean;
  mustReadOn?: boolean;
  /** may set a reminder on this message (`me.canRemind`: the «ذكّرني» switch is on; absent: no) */
  canRemind?: boolean;
  /** may translate this message (`me.canTranslate`; absent: no) */
  canTranslate?: boolean;
  /** C2.6: the new screen. Only it gets the items of C2.6 and Telegram's order; absent: the old screen (nothing new is offered) */
  surface?: "v2";
  /** the message has a picture the reading-of-pictures switch covers (`header.imageOcr`) */
  canReadText?: boolean;
  /** the message is a voice note the transcript switch covers (`header.voiceTranscript`) */
  canTranscribe?: boolean;
  /** how many people's newest read message is this one (the reader list of today) */
  readerCount?: number;
  /** the company's problem kinds include the question kind («اسألي مشرفتك») */
  canAsk?: boolean;
}

/** `labelKey`: a key of ar.chat-conversation.json (the strings live there, not here). */
export type MessageMenuAction = { id: MessageMenuId; labelKey: (c: MessageMenuContext) => string; danger?: boolean; available: (c: MessageMenuContext) => boolean };

/** The new screen says it in Telegram's words; the old screen keeps the words it always had. */
const v2 = (c: MessageMenuContext) => c.surface === "v2";

export const messageMenuItems: MessageMenuAction[] = [
  { id: "reply", labelKey: () => "chatc.menu.reply", available: (c) => c.canPost },
  { id: "pin", labelKey: (c) => (v2(c) ? (c.pinned ? "chatui.menu.unpin" : "chatui.menu.pin") : c.pinned ? "chatc.menu.unpin" : "chatc.menu.pin"), available: (c) => (c.conversationKind === "DM" ? true : c.canModerate) },
  { id: "forward", labelKey: (c) => (v2(c) ? "chatui.menu.forward" : "chatc.menu.forward"), available: (c) => c.kind !== "POLL" },
  { id: "edit", labelKey: (c) => (v2(c) ? "chatui.menu.edit" : "chatc.menu.edit"), available: (c) => c.mine && c.kind === "TEXT" && c.hasText },
  { id: "note", labelKey: (c) => (v2(c) ? "chatui.menu.note" : "chatc.menu.note"), available: (c) => c.canModerate },
  { id: "copy", labelKey: (c) => (v2(c) ? "chatui.menu.copy" : "chatc.menu.copy"), available: (c) => c.hasText },
  { id: "copyLink", labelKey: () => "chatui.menu.copy_link", available: (c) => v2(c) },
  { id: "task", labelKey: (c) => (v2(c) ? "chatui.menu.task" : "chatc.menu.task"), available: (c) => c.hasText && !!c.canMakeWork && c.canMakeTask !== false },
  { id: "ticket", labelKey: (c) => (v2(c) ? "chatui.menu.ticket" : "chatc.menu.ticket"), available: (c) => c.hasText && !!c.canMakeWork && c.canMakeTicket !== false },
  { id: "problem", labelKey: () => "tickets.menu.problem", available: (c) => c.hasText && c.kind === "TEXT" && !!c.canProblem },
  { id: "mustread", labelKey: (c) => (c.mustReadOn ? "mustread.menu.off" : "mustread.menu.on"), available: (c) => c.hasText && c.kind === "TEXT" && !!c.canMustRead },
  { id: "ask", labelKey: () => "chatui.menu.ask", available: (c) => v2(c) && !!c.canAsk && c.hasText && c.kind === "TEXT" },
  { id: "remind", labelKey: () => "chatc.menu.remind", available: (c) => !!c.canRemind },
  { id: "translate", labelKey: () => "translate.menu", available: (c) => !!c.canTranslate && c.kind === "TEXT" && c.hasText },
  { id: "readText", labelKey: () => "chatui.menu.read_text", available: (c) => v2(c) && !!c.canReadText },
  { id: "transcribe", labelKey: () => "chatui.menu.transcribe", available: (c) => v2(c) && !!c.canTranscribe && c.kind === "VOICE" },
  { id: "seen", labelKey: () => "chatui.menu.seen", available: (c) => v2(c) && c.conversationKind !== "DM" && (c.readerCount ?? 0) > 0 },
  { id: "delete", labelKey: (c) => (v2(c) ? "chatui.menu.delete" : "chatc.menu.delete"), danger: true, available: (c) => c.mine || c.canModerate },
];

/**
 * The order of the NEW screen: Telegram's (رد، نسخ، نسخ الرابط، ثبّت، حوّل، [حدّد: C3b.5]، عدّل، احذف) and then ours (اعمل مهمة، اعمل تذكرة، «🎫 مشكلة»، اسألي
 * مشرفتك، ذكّرني، ملاحظة، «لازم ينقرأ»، ترجم، اقرأ النص، حوّل الصوت لنص، مين شاف). The old screen keeps the order of `messageMenuItems` (the dangerous one last);
 * every id has a place here (a test fails for an id without one), so a new item has to choose.
 */
export const V2_MENU_ORDER: readonly MessageMenuId[] = ["reply", "copy", "copyLink", "pin", "forward", "edit", "delete", "task", "ticket", "problem", "ask", "remind", "note", "mustread", "translate", "readText", "transcribe", "seen"];

/** Is there a menu at all for this message (and a reaction bar)? */
export function menuOpen(c: MessageMenuContext): boolean {
  return !c.deleted && c.kind !== "SYSTEM" && !c.oversight;
}

/** The actions this person gets on this message, in menu order. */
export function menuFor(c: MessageMenuContext): MessageMenuAction[] {
  if (!menuOpen(c)) return [];
  const offered = messageMenuItems.filter((item) => item.available(c));
  return v2(c) ? offered.sort((a, b) => V2_MENU_ORDER.indexOf(a.id) - V2_MENU_ORDER.indexOf(b.id)) : offered;
}
