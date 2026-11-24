"use client";

import React from "react";
import Link from "next/link";
import { ExternalLink, MoreVertical, Search, Share2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ct } from "@/lib/chat/text";
import { profileQrUrl } from "@/lib/chat/v2/qr";

/**
 * The «⋮» of a person's page in Telegram's look (S6.4, under `tgLook`): a round glass button at the corner of the picture that opens a floating card with what the person can
 * really do here: «بحث بالمحادثة», «شاركي الملف» (the person's page address, through the phone's share sheet or, without one, the clipboard) and «افتح الملف الشخصي». Nothing is
 * offered that the app cannot do (no «حظر», no «حذف جهة اتصال»). The line «انتسخ رابط الملف» is the whole confirmation of a copy.
 */
export function InfoMenu({ userId, name, onSearch }: { userId: string; name: string; onSearch: () => void }) {
  const [note, setNote] = React.useState<"copied" | "failed" | null>(null);
  const share = async () => {
    const url = profileQrUrl(window.location.origin, userId);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNote("copied");
    } catch (error) {
      // the person closed the share sheet: not a failure
      if (error instanceof DOMException && error.name === "AbortError") return;
      setNote("failed");
    }
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" data-info-menu aria-label={ct("chatui.info.menu")} className="absolute end-3 top-3 inline-flex size-11 items-center justify-center rounded-full border border-border/60 bg-surface-1/85 text-fg shadow-card backdrop-blur-md hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            <MoreVertical aria-hidden="true" className="size-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem data-info-menu-item="search" className="gap-3" onSelect={onSearch}>
            <Search aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
            {ct("chatui.info.search")}
          </DropdownMenuItem>
          <DropdownMenuItem data-info-menu-item="share" className="gap-3" onSelect={() => void share()}>
            <Share2 aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
            {ct("chatui.info.share")}
          </DropdownMenuItem>
          <DropdownMenuItem asChild data-info-menu-item="profile" className="gap-3">
            <Link href={`/u/${encodeURIComponent(userId)}`}>
              <ExternalLink aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
              {ct("chatui.info.open_profile")}
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {note ? (
        <p role="status" data-info-share-note={note} className="max-w-full text-xs text-fg-muted">
          {note === "copied" ? ct("chatui.info.share_copied") : ct("chatui.info.share_failed")}
        </p>
      ) : null}
    </>
  );
}
