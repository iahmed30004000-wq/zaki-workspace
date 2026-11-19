import type { MessageDto } from "@/server/chat/dto";
import { messageMenuItems, type MessageMenuContext } from "@/components/chat/message/message-menu-registry";

/**
 * C2.5 — «↑» in an EMPTY composer edits my last TEXT message. The rule of what may be edited is the message menu's registry (`edit`: mine, a text message, with
 * words — never a voice note, never somebody else's); this file asks the registry and does not write the rule a second time. A message that is not on the
 * server yet (a pending bubble) or is deleted is never offered.
 */
const edit = messageMenuItems.find((item) => item.id === "edit");

function editable(message: MessageDto, canPost: boolean): boolean {
  if (!edit || message.deleted || message.pending || message.id.includes(":")) return false;
  const context: MessageMenuContext = {
    mine: message.mine,
    deleted: message.deleted,
    kind: message.kind,
    hasText: Boolean(message.body && message.body.trim()),
    pinned: message.pinned,
    conversationKind: "TOPIC",
    canPost,
    canModerate: false,
    oversight: false,
  };
  return edit.available(context);
}

/** The newest of MY messages that the registry lets me edit, or null. `messages` are oldest first, as the cache gives them. */
export function lastEditableOf(messages: readonly MessageDto[], canPost = true): MessageDto | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message && message.mine && editable(message, canPost)) return message;
  }
  return null;
}

export interface ArrowUpInput {
  key: string;
  text: string;
  fileCount: number;
  composing: boolean;
  choicesOpen: boolean;
  editing: boolean;
  recording: boolean;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

/** Does this key press mean «edit my last message»? Only a bare «↑» in a box with nothing in it and nothing attached. */
export function arrowUpEdits(i: ArrowUpInput): boolean {
  if (i.key !== "ArrowUp") return false;
  if (i.shiftKey || i.ctrlKey || i.altKey || i.metaKey) return false;
  if (i.text.length > 0 || i.fileCount > 0) return false;
  return !i.composing && !i.choicesOpen && !i.editing && !i.recording;
}
