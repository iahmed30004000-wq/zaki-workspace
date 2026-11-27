import { AudioLines, Bell, Bookmark, CheckCheck, CircleHelp, Clock, Copy, Forward, Languages, Link, ListChecks, Pencil, Pin, PinOff, ScanText, SquareCheckBig, StickyNote, Ticket, Trash2, TriangleAlert, Unlink, Reply, MessageSquareReply, type LucideIcon } from "lucide-react";
import type { MessageMenuId } from "@/components/chat/message/message-menu-registry";

/**
 * The icon at the start of each row of the message menu (Telegram's outline set, 20 px). One entry per id of the registry, so a new item has to choose one
 * (`tests/chat-v2-menu-render.test.ts`). The pin row says «unpin» with the crossed pin.
 */
export const MENU_ICONS: Record<MessageMenuId, LucideIcon> = {
  reply: Reply,
  replyElsewhere: MessageSquareReply,
  copy: Copy,
  copyLink: Link,
  pin: Pin,
  forward: Forward,
  saved: Bookmark,
  select: SquareCheckBig,
  edit: Pencil,
  delete: Trash2,
  task: ListChecks,
  ticket: Ticket,
  problem: TriangleAlert,
  ask: CircleHelp,
  remind: Clock,
  note: StickyNote,
  mustread: Bell,
  translate: Languages,
  readText: ScanText,
  transcribe: AudioLines,
  seen: CheckCheck,
  removePreview: Unlink,
};

/** The icon of a row: the pinned message's «unpin» gets the crossed pin; the rest come from `MENU_ICONS`. */
export function menuIconOf(id: MessageMenuId, pinned: boolean): LucideIcon {
  return id === "pin" && pinned ? PinOff : MENU_ICONS[id];
}
