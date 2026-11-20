"use client";

import type { NavModel, PlaceKey } from "@/lib/nav/places";
import type { NewActionKey } from "@/lib/nav/new-actions";
import { appBarOf } from "@/lib/nav/shell-v2";
import { CommandPalette } from "@/components/command-palette";
import { NotificationBell } from "@/components/notification-bell";
import { NewWheel } from "./new-wheel";

/**
 * WHAT THE CHAT'S MISSING BAR CARRIED — the chat on a computer has no global bar (src/lib/nav/shell-v2.ts `chatChromeOf`), so its search, the bell and «جديد»
 * are drawn in the rail instead, in the rail's own cells: the palette (Ctrl+K still opens it from anywhere), the notifications and the new-menu. The slots
 * are the bar's (`appBarOf`), so a place that never had a tool never gets one here. These are the ONLY copies on screen while the rail holds them: the
 * frame draws the bar's copies on a phone and everywhere else.
 */
export function RailTools({ nav, place, newActions = [] }: { nav: NavModel; place: PlaceKey | null; newActions?: readonly NewActionKey[] }) {
  const slots = appBarOf(place);
  return (
    <>
      {slots.search ? (
        <div data-tour="search">
          <CommandPalette nav={nav} variant="rail" />
        </div>
      ) : null}
      {slots.bell ? <NotificationBell variant="rail" /> : null}
      {slots.create ? <NewWheel actions={newActions} v2 variant="rail" /> : null}
    </>
  );
}
