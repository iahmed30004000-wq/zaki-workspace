"use client";

import React, { useEffect, useLayoutEffect, useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ChatListColumn } from "@/components/chat/v2/list/chat-list-column";
import { chatRouteOf, isListScreen } from "@/lib/chat/v2/routes";
import { useIsDesktop } from "@/lib/chat/v2/use-media";
import { useRegisterListSlot } from "./list-slot";

/** A layout effect on the browser, an ordinary one on the server (which has no layout to wait for). */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

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
 *   computer (from `md`)   the list column is handed to the frame's ONE rail (`listSlot`, through `AppShell`: N1.2 built that slot for this; there is no
 *                          second rail and no second drawer) and `children` is the pane beside it: the empty «اختار محادثة», or a conversation.
 *   phone (below `md`)     one screen at a time: the list column IS the screen on `/chat` and `/chat/s/<id>`; on a conversation it stays mounted but
 *                          hidden (so going back finds it where it was) and the conversation is the screen. The frame's drawer («☰», with `navV2`)
 *                          and bottom bar are the frame's own: the shell adds none.
 *
 * Until the screen size is known (the server and the first client render) only the pane is drawn, so the two renders agree.
 */
export function ChatShell({ userId, guest, canMeet, rowMenu, canPurge, children }: ChatShellProps) {
  const route = chatRouteOf(usePathname());
  const desktop = useIsDesktop();
  const register = useRegisterListSlot();

  const column = useMemo(
    () => <ChatListColumn variant={desktop === false ? "screen" : "column"} userId={userId} guest={guest} canMeet={canMeet} rowMenu={rowMenu} canPurge={canPurge} />,
    [desktop, userId, guest, canMeet, rowMenu, canPurge],
  );

  // the computer: the column is drawn by the frame, beside the rail, and goes with the shell
  useBeforePaint(() => {
    if (desktop !== true || !register) return;
    register(column);
    return () => register(null);
  }, [desktop, register, column]);

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
    <div data-chat-shell={desktop === true ? "desktop" : "pending"} className={isListScreen(route) && desktop === null ? "h-full min-h-0 max-md:hidden" : "h-full min-h-0"}>
      {children}
    </div>
  );
}
