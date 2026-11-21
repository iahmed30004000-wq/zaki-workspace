"use client";

import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChartColumn, FileText, Image as ImageIcon, ListChecks, Paperclip, type LucideIcon } from "lucide-react";
import type { MessageDto } from "@/server/chat/dto";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { COMPOSER_ICON_BUTTON } from "@/components/chat/v2/composer/composer-styles";
import { ChecklistDialog } from "@/components/chat/v2/composer/checklist-dialog";
import { usePaneActions, usePaneCommands } from "@/components/chat/v2/pane/pane-actions";
import { appendMessage } from "@/lib/chat/cache/writer";
import { ct } from "@/lib/chat/text";
import type { AttachItemId } from "@/lib/chat/v2/composer/attach-items";

const ICONS: Record<AttachItemId, LucideIcon> = { media: ImageIcon, file: FileText, poll: ChartColumn, checklist: ListChecks };
const LABELS: Record<AttachItemId, string> = { media: "chat.f.attach_media", file: "chat.f.attach_file", poll: "chatc.poll.menu", checklist: "chatcl.menu" };

/**
 * «قائمة مهام» (C3c.1): the dialog this menu opens by itself, inside the conversation pane. A new list lands in the cache through the writer, like every message the
 * composer sends the old way (files, a voice note, a poll), and the pane scrolls to the newest message. It is a component of its own so that the pane's context is read
 * only after «قائمة مهام» was chosen (the menu itself draws anywhere).
 */
function ChecklistFromMenu({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { conversationId } = usePaneActions();
  const commands = usePaneCommands();
  return (
    <ChecklistDialog
      open
      conversationId={conversationId}
      onClose={onClose}
      onCreated={(message: MessageDto) => {
        appendMessage(qc, conversationId, message);
        onClose();
        commands.toNewest();
      }}
    />
  );
}

/**
 * C2.5 — the paperclip menu: «صورة أو فيديو» · «ملف» · «استطلاع» · «قائمة مهام» (the items come from `attachItemsOf`, so the poll and the list are there only where the server
 * says I may). Telegram's card: a rounded 12 menu, 36 px rows, the icon first. «قائمة مهام» is run here, not by the surface: `onPick` hears about the other three only.
 */
export function AttachMenu({ items, disabled, onPick }: { items: AttachItemId[]; disabled: boolean; onPick: (id: AttachItemId) => void }) {
  const [checklistOpen, setChecklistOpen] = React.useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" data-attach-menu className={COMPOSER_ICON_BUTTON} aria-label={ct("chat.f.attach_menu")} disabled={disabled}>
            <Paperclip aria-hidden="true" className="size-6" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {items.map((id) => {
            const Icon = ICONS[id];
            return (
              <DropdownMenuItem key={id} data-attach-item={id} className="gap-3" onSelect={() => (id === "checklist" ? setChecklistOpen(true) : onPick(id))}>
                <Icon aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
                {ct(LABELS[id])}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {checklistOpen ? <ChecklistFromMenu onClose={() => setChecklistOpen(false)} /> : null}
    </>
  );
}
