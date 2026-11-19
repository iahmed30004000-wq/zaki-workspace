"use client";

import React, { useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChatListColumn } from "@/components/chat/v2/list/chat-list-column";
import { InfoSlotContext } from "@/components/chat/v2/info/info-slot";
import { PhoneScreenFrame } from "@/components/chat/v2/phone/screen-frame";
import { ShortcutsSheet } from "@/components/chat/v2/menu/shortcuts-sheet";
import { useChatShortcuts } from "@/lib/chat/shortcuts";
import { phoneBackOf, phoneScreenOf } from "@/lib/chat/v2/phone/screens";
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
  const pathname = usePathname();
  const route = chatRouteOf(pathname);
  // C2.8: which phone screen this address is. `data-frame-bars` asks the app frame to hide its own top bar below `md` ("hide-top": the list screen draws its own) and, inside a conversation or its info screen, its bottom bar and people row too ("hide-all"), with CSS only
  const screen = phoneScreenOf(pathname);
  const marker = screen === "other" ? {} : { "data-chat-screen": screen, "data-frame-bars": screen === "conversation" || screen === "info" ? "hide-all" : "hide-top" };
  const desktop = useIsDesktop();
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  // C2.7: the column beside the pane where the info panel is drawn on a wide screen (the pane's info host portals into it)
  const [infoSlot, setInfoSlot] = useState<HTMLElement | null>(null);
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
      <div data-chat-shell="phone" {...marker} className="relative h-full min-h-0 overflow-x-clip">
        <div className={onList ? "h-full" : "hidden"}>{column}</div>
        {/* C2.8: the conversation (or its info screen) is the whole screen: it slides in from the start edge, a swipe from that edge goes back, the composer rides above the keyboard */}
        <PhoneScreenFrame active={!onList} back={phoneBackOf(pathname)}>
          {children}
        </PhoneScreenFrame>
      </div>
    );
  }
  return (
    <InfoSlotContext.Provider value={desktop === true ? infoSlot : null}>
      {/* while the screen size is unknown the pane of a list route is kept off a phone (the list is its screen), so «اختار محادثة» never flashes there */}
      <div data-chat-shell={desktop === true ? "desktop" : "pending"} {...marker} className={isListScreen(route) && desktop === null ? "flex h-full min-h-0 max-md:hidden" : "flex h-full min-h-0"}>
        {desktop === true ? (
          <div data-chat-slot="" className="hidden h-full min-h-0 shrink-0 border-e border-border bg-surface md:flex">
            {column}
          </div>
        ) : null}
        <div data-chat-pane="" className="min-w-0 flex-1">
          {children}
        </div>
        {/* C2.7: the info panel's column (empty, so it takes no room, until the pane's info host portals the panel into it) */}
        {desktop === true ? <div ref={setInfoSlot} data-chat-info-slot="" className="flex h-full min-h-0 shrink-0 empty:hidden" /> : null}
        {desktop === true ? <ShortcutsSheet open={sheet} onOpenChange={setSheet} /> : null}
      </div>
    </InfoSlotContext.Provider>
  );
}
