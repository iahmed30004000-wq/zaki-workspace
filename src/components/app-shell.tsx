"use client";

import { setEconomy } from "@/lib/economy";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import type { Audience } from "@/lib/guide/audience";
import { browserStore } from "@/lib/guide/storage";
import { locate, type NavModel, type NavRole } from "@/lib/nav/places";
import { applyNavOrder, hasOrder, withPlaceOrder, withTabOrder, type NavOrder } from "@/lib/nav/order";
import { useOptionalToast } from "@/components/ui/toast";
import type { NewActionKey } from "@/lib/nav/new-actions";
import type { AvatarUser } from "@/components/shell/avatar-menu";
import { ZakiMark } from "@/components/logo";
import { BottomNav } from "@/components/shell/bottom-nav";
import { PeopleDock } from "@/components/shell/people-dock";
import { QuickChat } from "@/components/shell/quick-chat";
import { PlaceTabs } from "@/components/shell/place-tabs";
import { Sidebar } from "@/components/shell/sidebar";
import { SpaceSwitcher, useCurrentSpace, type ShellSpace } from "@/components/shell/space-switcher";
import { TopBar } from "@/components/shell/top-bar";
import { readSidebarCollapsed, writeSidebarCollapsed } from "@/components/shell/sidebar-state";
import { useChatUnread } from "@/lib/chat/use-chat-unread";
import { parseSidebarCookie, writeSidebarCookie } from "@/components/shell/sidebar-cookie";

export interface AppShellProps {
  user: AvatarUser;
  /** The person's map, computed on the server from their rank and switches (src/lib/nav/places.ts), in the code's order. */
  nav: NavModel;
  /** The person's own saved order of it («ترتيبي», src/lib/nav/order.ts): the server read it, so the first paint has it. */
  navOrder?: NavOrder | null;
  /** The rank in the active organization, shown in Arabic in the avatar menu. */
  rank: NavRole;
  /** The guide level («؟» picks the read-only line for an external partner). */
  audience: Audience;
  /** An external partner: never offered to open a space. */
  isGuest?: boolean;
  /** What the server read from the `zk-sidebar` cookie: the first frame is already the right width. */
  defaultCollapsed?: boolean;
  /** What «جديد» offers this person (`newActionsFor`, on the server). */
  newActions?: readonly NewActionKey[];
  /** The active company's name, under the wordmark. */
  orgName?: string;
  /** The space the person is in (src/server/services/current-space.ts): its name sits at the top. */
  space?: ShellSpace | null;
  /** The owner and the admins: «كل المساحات» in the space menu. */
  canOverview?: boolean;
  /** The company's «شريط الموجودين» switch (`src/lib/features.ts`): off, the row is not drawn. */
  peopleDock?: boolean;
  /** The company's «الدردشة السريعة» switch: off, the floating button is not drawn. */
  quickChat?: boolean;
  /** The company's «وضع التوفير» (`src/lib/features.ts`): the screen's repeated refreshes wait longer (`src/lib/economy.ts`). */
  economy?: boolean;
  children: ReactNode;
}

/**
 * THE FRAME OF EVERY SIGNED-IN PAGE — the five places of the owner's plan, mobile first, right to left.
 *
 *   phone (< md)       the top bar (mark, «ليل/نهار», «؟», bell, «جديد», avatar; the search under them), the tab strip of the current place,
 *                      the page, and the places in a bar fixed along the bottom (no side menu).
 *   computer (>= md)   the side menu on the start side (the places, the spaces, the avatar; it folds to
 *                      an icon rail and remembers that on this device), the top bar (the place's name, search,
 *                      «ليل/نهار», «؟», bell, «جديد»),
 *                      the tab strip, the page.
 *
 * Both the bottom bar and the side menu are in the page; CSS shows one. The map comes from the server
 * (`buildNav` in the (app) layout): the frame only draws it, and the server still decides every request.
 * Theme tokens only, logical CSS only; the decoration is in the side menu's header and nowhere else.
 */
export function AppShell({ user, nav: defaultNav, navOrder = null, rank, audience, isGuest = false, defaultCollapsed = false, newActions = [], orgName, space: initialSpace = null, canOverview = false, peopleDock = true, quickChat = true, economy = false, children }: AppShellProps) {
  // set while rendering, on purpose: the shell renders before its children, so every timer below reads the right period
  setEconomy(economy);
  const { t } = useI18n();
  const toast = useOptionalToast();
  // «ترتيبي»: the person's own order, drawn over the map they may see (never adds or hides anything)
  const [order, setOrder] = useState<NavOrder | null>(navOrder);
  const orderRef = useRef<NavOrder | null>(navOrder);
  const [editing, setEditing] = useState(false);
  const nav = useMemo(() => applyNavOrder(defaultNav, order), [defaultNav, order]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // saves go one after the other, so the last drop is the one that stays; a refused save puts the screen back
  const save = (next: NavOrder | null) => {
    const before = orderRef.current;
    orderRef.current = next;
    setOrder(next);
    queue.current = queue.current.then(async () => {
      try {
        const res = await fetch("/api/me/nav-order", {
          method: next ? "PUT" : "DELETE",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          ...(next ? { body: JSON.stringify(next) } : {}),
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        if (orderRef.current === next) {
          orderRef.current = before;
          setOrder(before);
        }
        toast?.toast(t("navorder.save_failed"), "error");
      }
    });
  };
  const reorderPlaces = (keys: string[]) => save(withPlaceOrder(orderRef.current, defaultNav, keys));
  const reorderTabs = (placeKey: string, keys: string[]) => save(withTabOrder(orderRef.current, defaultNav, placeKey, keys));
  const resetOrder = () => save(null);
  // the space the person is in (the layout's answer, then the server's after each navigation)
  const space = useCurrentSpace(initialSpace);
  const pathname = usePathname() ?? "/";
  const here = locate(pathname);
  // a page of a place this person is not offered (a guest who typed /files) marks nothing
  const place = nav.places.find((p) => p.key === here.place) ?? null;
  const tab = place && place.tabs.some((x) => x.key === here.tab) ? here.tab : null;
  // the unread messages behind «الدردشة», on every page (only when the chat is one of this person's places)
  const chatUnread = useChatUnread(nav.places.some((p) => p.key === "chat"));
  const badges = { chat: chatUnread };

  // The folded state starts from the `zk-sidebar` COOKIE the server layout read: no 256px flash and
  // no animated shrink after the first paint. localStorage stays as a second memory for a device
  // whose cookies were cleared, and is only honoured when it DISAGREES after the page has loaded.
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  // the width only animates once the person has toggled the menu in this visit — never on first paint
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    const stored = readSidebarCollapsed(browserStore());
    if (stored !== defaultCollapsed) setCollapsed(stored);
    // the cookie is the truth from now on; this only back-fills a device whose cookie was lost
    writeSidebarCookie(stored || defaultCollapsed ? true : false, document);
  }, [defaultCollapsed]);
  const toggleSidebar = () => {
    const next = !collapsed;
    setCollapsed(next);
    setAnimated(true);
    writeSidebarCollapsed(browserStore(), next);
    writeSidebarCookie(next, document);
  };

  return (
    <div className="flex h-dvh overflow-hidden bg-surface">
      <a
        href="#zk-main"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-[100] focus:rounded-xl focus:bg-surface-1 focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-fg focus:shadow-lg"
      >
        {t("shell.skip")}
      </a>

      <Sidebar
        nav={nav}
        current={place?.key ?? null}
        pathname={pathname}
        user={user}
        rank={rank}
        isGuest={isGuest}
        orgName={orgName}
        space={space}
        canOverview={canOverview}
        collapsed={collapsed}
        onToggle={toggleSidebar}
        animated={animated}
        badges={badges}
        editing={editing}
        onEditStart={() => setEditing(true)}
        onEditDone={() => setEditing(false)}
        onReorder={reorderPlaces}
        onReset={resetOrder}
        canReset={hasOrder(order)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          nav={nav}
          pathname={pathname}
          audience={audience}
          user={user}
          rank={rank}
          title={place ? t(place.labelKey) : undefined}
          space={space}
          newActions={isGuest ? [] : newActions}
        />
        <PlaceTabs
          place={place}
          tab={tab}
          pathname={pathname}
          editing={editing}
          onReorder={reorderTabs}
          end={
            place?.key === "work" ? (
              <div className="shrink-0 border-s border-border px-1 md:hidden">
                <SpaceSwitcher variant="strip" isGuest={isGuest} current={space} canOverview={canOverview} />
              </div>
            ) : null
          }
        />
        {/* on a phone the content stops above the fixed bottom bar (its 56px, its border and the home-indicator inset) */}
        <div className="flex min-h-0 flex-1 flex-col pb-[calc(3.5rem+1px+env(safe-area-inset-bottom))] md:pb-0">
          <main id="zk-main" tabIndex={-1} className="zk-safe-x min-w-0 flex-1 overflow-y-auto focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0">
            {children}
          </main>
          {/* who is here and who is at their screen: its own 40px row above the phone's bar, so it covers no page (never for a guest) */}
          <PeopleDock enabled={!isGuest && peopleDock} />
        </div>
      </div>

      <BottomNav
        places={nav.places}
        current={place?.key ?? null}
        pathname={pathname}
        badges={badges}
        editing={editing}
        onEditStart={() => setEditing(true)}
        onEditDone={() => setEditing(false)}
        onReorder={reorderPlaces}
        onReset={resetOrder}
        canReset={hasOrder(order)}
      />

      {/* the round quick chat in the corner (the owner's ask, 2026-10-30); the chat page itself is the full
          conversation, so the button stays out of its way, and never for a guest (no DMs at all) */}
      <QuickChat enabled={!isGuest && quickChat && place?.key !== "chat"} />
    </div>
  );
}
