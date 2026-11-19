"use client";

import React from "react";
import { ct } from "@/lib/chat/text";

/** The docked panel: 360 px wide, the full height of the pane, a hairline on the side that meets the conversation. The panel body fills it and scrolls inside. */
export function InfoDock({ children }: { children: React.ReactNode }) {
  return (
    <aside data-info-dock aria-label={ct("chatui.pane.menu.info")} className="flex h-full min-h-0 w-[22.5rem] shrink-0 flex-col border-s border-border bg-surface">
      {children}
    </aside>
  );
}
