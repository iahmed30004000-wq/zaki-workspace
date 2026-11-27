"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bookmark, MoonStar, MoreVertical, Sun, Users, UsersRound } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useThemeToggle } from "@/components/theme/use-theme-toggle";
import { useTgPhoneOn } from "@/components/shell/tg-phone";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";
import { ct } from "@/lib/chat/text";
import { listMenuItemsOf } from "@/lib/chat/v2/list-menu";
import { openSavedId } from "@/lib/chat/v2/menu/menu-context";

/**
 * The list's main «⋮» (Telegram's top-corner menu, under `tgLook`): «وضع النهار» / «وضع الليل» (the same switch as everywhere), «جهات الاتصال» (`/contacts`), «مجموعة جديدة» and
 * «الرسائل المحفوظة» (my own chat with myself, made on first use by the dm door). Nothing the app cannot do is offered (no proxy, no calls list).
 */
export function ListMenu({ guest, onNewGroup }: { guest: boolean; onNewGroup?: () => void }) {
  const router = useRouter();
  const { dark, setDark } = useThemeToggle();
  const tg = useTgPhoneOn();
  const trigger = React.useRef<HTMLButtonElement>(null);
  const turnTheme = () => {
    if (!tg) return setDark(!dark);
    const box = trigger.current?.getBoundingClientRect();
    const origin = box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : undefined;
    window.setTimeout(() => setDark(!dark, origin, false, "circle"), TG_MOTION.themeMenuMs);
  };
  const items = listMenuItemsOf({ guest, canGroup: onNewGroup !== undefined });
  const [missed, setMissed] = React.useState(false);
  const openSaved = async () => {
    const id = await openSavedId();
    if (id) router.push(`/chat/${encodeURIComponent(id)}`);
    else setMissed(true);
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            ref={trigger}
            type="button"
            data-list-menu
            aria-label={ct("chatui.listmenu.label")}
            className="grid size-11 shrink-0 place-items-center rounded-full text-fg hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <MoreVertical aria-hidden="true" className="size-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-[60] min-w-56">
          {items.includes("theme") ? (
            <DropdownMenuItem data-list-menu-item="theme" className="gap-3" onSelect={turnTheme}>
              {dark ? <Sun aria-hidden="true" className="size-5 shrink-0 text-fg-muted" /> : <MoonStar aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />}
              {ct(dark ? "chatui.listmenu.day" : "chatui.listmenu.night")}
            </DropdownMenuItem>
          ) : null}
          {items.includes("contacts") ? (
            <DropdownMenuItem asChild data-list-menu-item="contacts" className="gap-3">
              <Link href="/contacts">
                <Users aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
                {ct("chatui.listmenu.contacts")}
              </Link>
            </DropdownMenuItem>
          ) : null}
          {items.includes("group") && onNewGroup ? (
            <DropdownMenuItem data-list-menu-item="group" className="gap-3" onSelect={onNewGroup}>
              <UsersRound aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
              {ct("chatui.listmenu.group")}
            </DropdownMenuItem>
          ) : null}
          {items.includes("saved") ? (
            <DropdownMenuItem data-list-menu-item="saved" className="gap-3" onSelect={() => void openSaved()}>
              <Bookmark aria-hidden="true" className="size-5 shrink-0 text-fg-muted" />
              {ct("chatui.listmenu.saved")}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {missed ? (
        <span role="status" data-list-menu-note className="sr-only">
          {ct("chatui.listmenu.saved_failed")}
        </span>
      ) : null}
    </>
  );
}
