"use client";

import React from "react";
import { ArrowRight, Menu, Search, X } from "lucide-react";
import { ListSearchPanel } from "@/components/chat/v2/info/list-search-results";
import { ct } from "@/lib/chat/text";
import { useFrameBridge } from "@/lib/chat/v2/phone/frame-bridge";
import { useTgPhoneOn } from "@/components/shell/tg-phone";
import { ListMenuExtrasContext } from "@/components/chat/v2/list/list-menu";

const iconButton =
  "grid size-11 shrink-0 place-items-center rounded-full text-fg hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

/**
 * C2.8 — THE PHONE'S LIST SCREEN BAR: 56 px under the notch. «☰» at the start (it opens the app's drawer, which the frame hands over through
 * `useFrameBridge`; with the new menu OFF the frame hands nothing and NO «☰» is drawn: the old bottom bar is the way around), the title — the folder
 * the person is in, or «ذكي» for «الكل» — and a search icon that EXPANDS to a full-width field («→» folds it back and clears it; Esc too). The folders and
 * the rows are under it, in the list's own column. The words typed narrow the rows exactly as the computer's search field does (the list holds the state).
 * The frame's own top bar is hidden on the phone while a chat screen is up (app-shell.tsx), so this bar owns the notch.
 *
 * C3d: while the field is open and holds two letters, the chats, people and messages the server found (`GET /api/search?scope=chat`) are drawn as a panel under the
 * bar, over the rows; opening one folds the field.
 */
export function PhoneListBar({ title, query, onQuery, searchId, menu, scrolled = false }: { title: string; query: string; onQuery: (value: string) => void; searchId: string; /** S6.6 «شكل تيليجرام»: the list's main «⋮» menu */ menu?: React.ReactNode; /** «تيليجرام»: the list is scrolled down, so the search pill folds into an icon */ scrolled?: boolean }) {
  const bridge = useFrameBridge();
  const tg = useTgPhoneOn();
  // the field stays open while it holds words (a rebuilt list must not close what the person is typing)
  const [open, setOpen] = React.useState(query !== "");
  const input = React.useRef<HTMLInputElement>(null);
  const expanded = open || query !== "";
  React.useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const fold = () => {
    onQuery("");
    setOpen(false);
  };
  // «تيليجرام»: as in his pictures, only the app's name and the «⋮» stand over the list: «☰» and the notifications are items of the «⋮», and the bell shows by
  // itself only while something is unread (or once it was asked for from the menu)
  const openDrawer = bridge?.openDrawer ?? null;
  const tidy = tg && menu !== undefined && openDrawer !== null;
  const [bellAsked, setBellAsked] = React.useState(false);
  const trailing = React.useRef<HTMLDivElement>(null);
  const extras = React.useMemo(
    () =>
      tidy && openDrawer !== null
        ? {
            openDrawer,
            openNotifications: () => {
              setBellAsked(true);
              // after the menu has closed and given the focus back, or the bell's panel would close at once
              window.setTimeout(() => trailing.current?.querySelector<HTMLButtonElement>("button")?.click(), 220);
            },
          }
        : null,
    [tidy, openDrawer],
  );

  return (
    <header data-chat-phone-bar="" className="relative shrink-0 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
      {expanded ? (
        <div data-chat-phone-search="open" className={tg ? "mx-2 my-1.5 flex h-11 items-center gap-1 rounded-full bg-surface-2" : "flex h-14 items-center gap-1 px-1"}>
          <button type="button" aria-label={ct("chatui.phone.search.close")} onClick={fold} className={iconButton}>
            <ArrowRight aria-hidden="true" className="size-5" />
          </button>
          <label htmlFor={searchId} className="sr-only">
            {ct("chatui.search.label")}
          </label>
          <input
            id={searchId}
            ref={input}
            type="search"
            value={query}
            onChange={(event) => onQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                fold();
              }
            }}
            placeholder={ct("chatui.search.placeholder")}
            autoComplete="off"
            enterKeyHint="search"
            className="h-11 min-w-0 flex-1 bg-transparent px-2 text-base text-fg placeholder:text-fg-muted focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button type="button" aria-label={ct("chatui.search.clear")} onClick={() => onQuery("")} className={iconButton}>
              <X aria-hidden="true" className="size-5" />
            </button>
          ) : null}
        </div>
      ) : (
        <div data-chat-phone-search="closed" className="flex h-14 items-center gap-1 px-1">
          {bridge?.openDrawer && !tidy ? (
            <button type="button" data-chat-drawer-open="" aria-label={ct("chatui.phone.menu")} onClick={bridge.openDrawer} className={iconButton}>
              <Menu aria-hidden="true" className="size-6" />
            </button>
          ) : null}
          <h1 className={`min-w-0 flex-1 truncate text-lg font-semibold leading-tight text-fg ${bridge?.openDrawer && !tidy ? "" : "ps-3"}`}>{title}</h1>
          {tg && !scrolled ? null : (
            <button type="button" data-chat-phone-search-open="" aria-label={ct("chatui.phone.search.open")} onClick={() => setOpen(true)} className={iconButton}>
              <Search aria-hidden="true" className="size-5" />
            </button>
          )}
          <ListMenuExtrasContext.Provider value={extras}>{menu}</ListMenuExtrasContext.Provider>
          {bridge?.trailing ? (
            <div ref={trailing} data-chat-phone-trailing="" {...(tidy && !bellAsked ? { "data-tg-quiet": "" } : {})} className="flex shrink-0 items-center">
              {bridge.trailing}
            </div>
          ) : null}
        </div>
      )}
      {tg && !expanded ? (
        // «تيليجرام»: the search is a pill under the title; scrolling the list down folds it away (the icon above takes its place)
        <div data-tg-search-pill-row="" className={`grid ${scrolled ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}>
          <div className="min-h-0 overflow-hidden">
            <button type="button" data-tg-search-pill="" tabIndex={scrolled ? -1 : 0} aria-hidden={scrolled ? true : undefined} onClick={() => setOpen(true)} className="mx-3 mb-2 flex min-h-11 w-[calc(100%-1.5rem)] items-center gap-2 rounded-full bg-surface-2 px-4 text-start text-sm text-fg-muted">
              <Search aria-hidden="true" className="size-4 shrink-0" />
              <span className="truncate">{ct("chatui.search.placeholder")}</span>
            </button>
          </div>
        </div>
      ) : null}
      {expanded ? <ListSearchPanel query={query} onPick={fold} /> : null}
    </header>
  );
}
