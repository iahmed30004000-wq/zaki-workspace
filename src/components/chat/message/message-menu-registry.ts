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
 * Nothing at all on a deleted message, a system line, or for the owner in silent oversight.
 */
export type MessageMenuId = "reply" | "pin" | "forward" | "edit" | "delete" | "note" | "copy" | "task" | "ticket" | "remind" | "translate";

export interface MessageMenuContext {
  mine: boolean;
  deleted: boolean;
  kind: "TEXT" | "VOICE" | "SYSTEM" | "POLL";
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
  /** may set a reminder on this message (`me.canRemind`: the «ذكّرني» switch is on; absent: no) */
  canRemind?: boolean;
  /** may translate this message (`me.canTranslate`; absent: no) */
  canTranslate?: boolean;
}

/** `labelKey`: a key of ar.chat-conversation.json (the strings live there, not here). */
export type MessageMenuAction = { id: MessageMenuId; labelKey: (c: MessageMenuContext) => string; danger?: boolean; available: (c: MessageMenuContext) => boolean };

export const messageMenuItems: MessageMenuAction[] = [
  { id: "reply", labelKey: () => "chatc.menu.reply", available: (c) => c.canPost },
  { id: "pin", labelKey: (c) => (c.pinned ? "chatc.menu.unpin" : "chatc.menu.pin"), available: (c) => (c.conversationKind === "DM" ? true : c.canModerate) },
  { id: "forward", labelKey: () => "chatc.menu.forward", available: (c) => c.kind !== "POLL" },
  { id: "edit", labelKey: () => "chatc.menu.edit", available: (c) => c.mine && c.kind === "TEXT" && c.hasText },
  { id: "note", labelKey: () => "chatc.menu.note", available: (c) => c.canModerate },
  { id: "copy", labelKey: () => "chatc.menu.copy", available: (c) => c.hasText },
  { id: "task", labelKey: () => "chatc.menu.task", available: (c) => c.hasText && !!c.canMakeWork && c.canMakeTask !== false },
  { id: "ticket", labelKey: () => "chatc.menu.ticket", available: (c) => c.hasText && !!c.canMakeWork && c.canMakeTicket !== false },
  { id: "remind", labelKey: () => "chatc.menu.remind", available: (c) => !!c.canRemind },
  { id: "translate", labelKey: () => "translate.menu", available: (c) => !!c.canTranslate && c.kind === "TEXT" && c.hasText },
  { id: "delete", labelKey: () => "chatc.menu.delete", danger: true, available: (c) => c.mine || c.canModerate },
];

/** Is there a menu at all for this message (and a reaction bar)? */
export function menuOpen(c: MessageMenuContext): boolean {
  return !c.deleted && c.kind !== "SYSTEM" && !c.oversight;
}

/** The actions this person gets on this message, in menu order. */
export function menuFor(c: MessageMenuContext): MessageMenuAction[] {
  if (!menuOpen(c)) return [];
  return messageMenuItems.filter((item) => item.available(c));
}
