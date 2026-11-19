"use client";

import { useEffect, useRef } from "react";
import { usePaneActions } from "@/components/chat/v2/pane/pane-actions";
import { shortcutBridge } from "@/lib/chat/v2/menu/shortcut-bridge";

/**
 * C2.6 — tells the keyboard module (mounted by the shell, above the pane) what the open conversation can do: open its search, close its search and its
 * info panel, and whether they are open. Drawn by the menu host, inside the pane's provider; it draws nothing. It registers while the pane is on screen and
 * takes itself away when the conversation changes or closes (the pane is keyed by conversation).
 */
export function ShortcutPane() {
  const a = usePaneActions();
  const live = useRef(a);
  live.current = a;
  const conversationId = a.conversationId;
  useEffect(
    () =>
      shortcutBridge.setPane({
        conversationId,
        openSearch: () => live.current.openSearch(),
        closeSearch: () => live.current.closeSearch(),
        closeInfo: () => live.current.closeInfo(),
        infoOpen: () => live.current.infoOpen,
        searchOpen: () => live.current.searchOpen,
      }),
    [conversationId],
  );
  return null;
}
