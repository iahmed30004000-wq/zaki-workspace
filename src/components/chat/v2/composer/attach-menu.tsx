"use client";

import React from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/chat/text";
import type { AttachItemId } from "@/lib/chat/v2/composer/attach-items";

/** C2.5 — the «📎» menu: «صورة أو فيديو» · «ملف» · «استطلاع» (the items come from `attachItemsOf`, so the poll is there only where the server says I may). */
export function AttachMenu({ items, disabled, onPick }: { items: AttachItemId[]; disabled: boolean; onPick: (id: AttachItemId) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" data-attach-menu aria-label={ct("chat.f.attach_menu")} disabled={disabled}>
          <span aria-hidden="true" className="text-xl">
            📎
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {items.map((id) => (
          <DropdownMenuItem key={id} data-attach-item={id} onSelect={() => onPick(id)}>
            {id === "media" ? ct("chat.f.attach_media") : id === "file" ? ct("chat.f.attach_file") : ct("chatc.poll.menu")}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
