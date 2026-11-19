"use client";

import React, { useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChatListColumn } from "@/components/chat/v2/list/chat-list-column";
import { ShortcutsSheet } from "@/components/chat/v2/menu/shortcuts-sheet";
import { useChatShortcuts } from "@/lib/chat/shortcuts";
import { chatHref, chatRouteOf, isListScreen, selectedConversationId } from "@/lib/chat/v2/routes";
import { useIsDesktop } from "@/lib/chat/v2/use-media";

export interface ChatShellProps {
  userId: string;
  guest: boolean;
  canMeet: boolean;
  rowMenu: boolean;
  canPurge: boolean;
  children: ReactNode;
}

/**
 * C2.1 — THE CHAT SHELL (switch `chatLayoutV2` ON). It is what `src/app/(app)/chat/layout.tsx` draws around every page of `/chat/**`, so it stays mounted
 * while `/chat/a` becomes `/chat/b`: the list column is never rebuilt and only the pane (`children`) changes.
 *
 *   computer (from `md`)   the list column is drawn HERE, in the page area right after the frame's rail (or the old side menu, with `navV2` off), and
 *                          `children` is the pane beside it: the empty «اختار محادثة», or a conversation. The shell does not touch the frame
 *                          (`app-shell.tsx` belongs to N1): there is no second rail and no second drawer, and the rail's own `listSlot` stays unused.
 *   phone (below `md`)     one screen at a time: the list column IS the screen on `/chat` and `/chat/s/<id>`; on a conversation it stays mounted but
 *                          hidden (so going back finds it where it was) and the conversation is the screen. The frame's drawer («☰», with `navV2`)
 *                          and bottom bar are the frame's own: the shell adds none.
 *
 * Until the screen size is known (the server and the first client render) only the pane is drawn, in the SAME box it has on the computer, so the two
 * renders agree and the pane is not remounted when the column appears.
 */
export function ChatShell({ userId, guest, canMeet, rowMenu, canPurge, children }: ChatShellProps) {
  const route = chatRouteOf(usePathname());
  const desktop = useIsDesktop();
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  // C2.6: the keyboard of the chat, mounted ONCE here (the list and the pane tell it what they hold); only on the computer
  useChatShortcuts({
    enabled: desktop === true,
    currentId: selectedConversationId(route),
    open: (id) => router.push(chatHref.conversation(id), { scroll: false }),
    toList: () => router.push(chatHref.list, { scroll: false }),
    openSheet: () => setSheet(true),
  });

  const column = useMemo(
    () => <ChatListColumn variant={desktop === false ? "screen" : "column"} userId={userId} guest={guest} canMeet={canMeet} rowMenu={rowMenu} canPurge={canPurge} />,
    [desktop, userId, guest, canMeet, rowMenu, canPurge],
  );

  if (desktop === false) {
    const onList = isListScreen(route);
    return (
      <div data-chat-shell="phone" className="relative h-full min-h-0">
        <div className={onList ? "h-full" : "hidden"}>{column}</div>
        <div className={onList ? "hidden" : "h-full min-h-0"}>{children}</div>
      </div>
    );
  }
  return (
    // while the screen size is unknown the pane of a list route is kept off a phone (the list is its screen), so «اختار محادثة» never flashes there
    <div data-chat-shell={desktop === true ? "desktop" : "pending"} className={isListScreen(route) && desktop === null ? "flex h-full min-h-0 max-md:hidden" : "flex h-full min-h-0"}>
      {desktop === true ? (
        <div data-chat-slot="" className="hidden h-full min-h-0 shrink-0 border-e border-border bg-surface md:flex">
          {column}
        </div>
      ) : null}
      <div data-chat-pane="" className="min-w-0 flex-1">
        {children}
      </div>
      {desktop === true ? <ShortcutsSheet open={sheet} onOpenChange={setSheet} /> : null}
    </div>
  );
}
