"use client";

import React from "react";
import { Copy, EyeOff, Forward, ListChecks, MoreVertical, Pencil, Pin, PinOff, Reply, Trash2, X } from "lucide-react";
import "@/components/chat/v2/phone/tg-messages.css";
import type { ConversationHeaderDto, MessageDto } from "@/server/chat/dto";
import { menuFor } from "@/components/chat/message/message-menu-registry";
import { ForwardManyDialog } from "@/components/chat/v2/menu/selection-dialogs";
import { usePaneCommands } from "@/components/chat/v2/pane/pane-actions";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useChatMessages } from "@/lib/chat/cache/selectors";
import { forwardableOf, orderedSelection, selectionStore, useSelection } from "@/lib/chat/selection";
import { ct, ctCount } from "@/lib/chat/text";
import { isSavedHeader, menuContextV2 } from "@/lib/chat/v2/menu/menu-context";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import { tgMotionVars } from "@/lib/chat/v2/phone/motion";
import { cn } from "@/lib/utils";

const ICON = "flex size-11 shrink-0 items-center justify-center rounded-full active:bg-surface-2 disabled:pointer-events-none disabled:opacity-50";

/**
 * May the ONE picked message be answered, edited or pinned here? The registry's answer (the same one its menu gives), never a second copy of the rules. With
 * two or more picked there is no reply, no edit and no pin.
 */
export function singleOffer(picked: readonly MessageDto[], header: ConversationHeaderDto): { message: MessageDto; reply: boolean; edit: boolean; pin: boolean } | null {
  const message = picked.length === 1 ? picked[0]! : null;
  if (!message) return null;
  const ids = new Set(menuFor(menuContextV2(message, bubbleFactsOf(header), { readerCount: 0, askKind: false })).map((a) => a.id));
  return { message, reply: ids.has("reply"), edit: ids.has("edit"), pin: ids.has("pin") };
}

/**
 * «تيليجرام على التلفون»: the header while messages are picked — ✕ · «محددة» / «محددتان» · تعديل · تثبيت · نسخ · حذف, and behind «⋮» what this app has
 * besides («حذف عندي», «اعمل مهمة»). Reply and forward are the two buttons at the bottom.
 */
export function TgSelectionBar({
  count,
  pinned = false,
  busy = false,
  canCopy,
  canDelete,
  canTask,
  onEdit,
  onPin,
  onCopy,
  onDelete,
  onHide,
  onTask,
  onClose,
}: {
  count: number;
  /** the one picked message is pinned already: the button takes the pin off */
  pinned?: boolean;
  busy?: boolean;
  canCopy: boolean;
  canDelete: boolean;
  canTask: boolean;
  /** absent: not offered (two or more picked, or not mine) */
  onEdit?: () => void;
  onPin?: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onHide?: () => void;
  onTask: () => void;
  onClose: () => void;
}) {
  const label = ctCount("tgmsg.sel.count", count);
  const PinIcon = pinned ? PinOff : Pin;
  return (
    <div data-selection-bar="" data-tg-selection="" role="toolbar" aria-label={ct("tgmsg.sel.actions")} className="flex min-w-0 flex-1 items-center">
      <button type="button" data-selection-close="" aria-label={ct("chatsel.bar.close")} onClick={onClose} className={ICON}>
        <X aria-hidden="true" className="size-6" />
      </button>
      <p data-selection-count="" data-count={count} role="status" className="min-w-0 flex-1 truncate px-1 text-lg font-bold">
        {label}
      </p>
      {onEdit ? (
        <button type="button" data-selection-action="edit" disabled={busy} aria-label={ct("tgmsg.menu.edit")} onClick={onEdit} className={ICON}>
          <Pencil aria-hidden="true" className="size-5" />
        </button>
      ) : null}
      {onPin ? (
        <button type="button" data-selection-action="pin" disabled={busy} aria-label={ct(pinned ? "tgmsg.menu.unpin" : "tgmsg.menu.pin")} onClick={onPin} className={ICON}>
          <PinIcon aria-hidden="true" className="size-5" />
        </button>
      ) : null}
      <button type="button" data-selection-action="copy" disabled={busy || !canCopy} aria-label={ct("tgmsg.menu.copy")} onClick={onCopy} className={ICON}>
        <Copy aria-hidden="true" className="size-5" />
      </button>
      <button type="button" data-selection-action="delete" disabled={busy || !canDelete} aria-label={ct("tgmsg.menu.delete")} onClick={onDelete} className={cn(ICON, "text-danger")}>
        <Trash2 aria-hidden="true" className="size-5" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" data-selection-more="" aria-label={ct("tgmsg.sel.more")} className={ICON}>
            <MoreVertical aria-hidden="true" className="size-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {onHide ? (
            <DropdownMenuItem data-selection-action="hide" disabled={busy || count === 0} onSelect={onHide} className="gap-3">
              <EyeOff aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
              {ct("chatparity.hide.bar")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem data-selection-action="task" disabled={busy || !canTask} onSelect={onTask} className="gap-3">
            <ListChecks aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
            {ct("chatsel.bar.task")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const BIG = "flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-surface-1 text-base font-semibold shadow-card active:bg-surface-2 disabled:opacity-50";

/** «تيليجرام على التلفون»: «رد» · «تحويل» where the box stood, while messages are picked. */
export function SelectionBottomBar({ onReply, onForward, canForward }: { /** absent: not offered (two or more picked, or I may not write here) */ onReply?: () => void; /** absent: there is no forwarding from here */ onForward?: () => void; canForward: boolean }) {
  return (
    <div data-selection-bottom="" role="group" aria-label={ct("tgmsg.sel.actions")} style={tgMotionVars(["barSlideMs"]) as React.CSSProperties} className="zk-tg-slide-up mx-auto flex w-full max-w-[904px] items-center gap-2">
      {onReply ? (
        <button type="button" data-selection-reply="" onClick={onReply} className={BIG}>
          <Reply aria-hidden="true" className="size-5 shrink-0 text-fg-muted rtl:-scale-x-100" />
          {ct("tgmsg.sel.reply")}
        </button>
      ) : null}
      {onForward ? (
        <button type="button" data-selection-forward="" disabled={!canForward} onClick={onForward} className={BIG}>
          <Forward aria-hidden="true" className="size-5 shrink-0 text-fg-muted rtl:-scale-x-100" />
          {ct("tgmsg.sel.forward")}
        </button>
      ) : null}
    </div>
  );
}

/** The bottom bar with what it acts on: the same picked messages and the same forward sheet as the header's bar. */
export function SelectionBottomBarHost({ header }: { header: ConversationHeaderDto }) {
  const commands = usePaneCommands();
  const selection = useSelection();
  const { messages } = useChatMessages(header.id);
  const [forwarding, setForwarding] = React.useState(false);
  const picked = React.useMemo(() => orderedSelection(selection.ids, messages), [selection.ids, messages]);
  const one = singleOffer(picked, header);
  const ready = forwardableOf(picked);
  return (
    <>
      <SelectionBottomBar
        canForward={ready.forward.length > 0}
        {...(one?.reply
          ? {
              onReply: () => {
                selectionStore.end();
                commands.startReply(one.message);
              },
            }
          : {})}
        // the saved chat forwards nowhere (the same rule as the header's bar)
        {...(isSavedHeader(header) ? {} : { onForward: () => setForwarding(true) })}
      />
      <ForwardManyDialog open={forwarding} from={header.id} count={ready.forward.length} skipped={ready.skipped} busy={false} onClose={() => setForwarding(false)} />
    </>
  );
}
