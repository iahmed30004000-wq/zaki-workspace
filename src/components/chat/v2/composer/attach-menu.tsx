"use client";

import React from "react";
import { ChartColumn, FileText, Image as ImageIcon, Paperclip, type LucideIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { COMPOSER_ICON_BUTTON } from "@/components/chat/v2/composer/composer-styles";
import { ct } from "@/lib/chat/text";
import type { AttachItemId } from "@/lib/chat/v2/composer/attach-items";

const ICONS: Record<AttachItemId, LucideIcon> = { media: ImageIcon, file: FileText, poll: ChartColumn };

/** C2.5 — the paperclip menu: «صورة أو فيديو» · «ملف» · «استطلاع» (the items come from `attachItemsOf`, so the poll is there only where the server says I may). Telegram's card: a rounded 12 menu, 36 px rows, the icon first. */
export function AttachMenu({ items, disabled, onPick }: { items: AttachItemId[]; disabled: boolean; onPick: (id: AttachItemId) => void }) {
  return (
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
            <DropdownMenuItem key={id} data-attach-item={id} className="gap-3" onSelect={() => onPick(id)}>
              <Icon aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
              {id === "media" ? ct("chat.f.attach_media") : id === "file" ? ct("chat.f.attach_file") : ct("chatc.poll.menu")}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
