"use client";

import React from "react";
import { ArrowRight, Menu, Search, X } from "lucide-react";
import { ct } from "@/lib/chat/text";
import { useFrameBridge } from "@/lib/chat/v2/phone/frame-bridge";

const iconButton =
  "grid size-11 shrink-0 place-items-center rounded-full text-fg hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

/**
 * C2.8 — THE PHONE'S LIST SCREEN BAR: 56 px under the notch. «☰» at the start (it opens the app's drawer, which the frame hands over through
 * `useFrameBridge`; with the new menu OFF the frame hands nothing and NO «☰» is drawn: the old bottom bar is the way around), the title — the folder
 * the person is in, or «زاكي» for «الكل» — and a search icon that EXPANDS to a full-width field («→» folds it back and clears it; Esc too). The folders and
 * the rows are under it, in the list's own column. The words typed narrow the rows exactly as the computer's search field does (the list holds the state).
 * The frame's own top bar is hidden on the phone while a chat screen is up (app-shell.tsx), so this bar owns the notch.
 */
export function PhoneListBar({ title, query, onQuery, searchId }: { title: string; query: string; onQuery: (value: string) => void; searchId: string }) {
  const bridge = useFrameBridge();
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

  return (
    <header data-chat-phone-bar="" className="shrink-0 border-b border-border bg-surface pt-[env(safe-area-inset-top)]">
      {expanded ? (
        <div data-chat-phone-search="open" className="flex h-14 items-center gap-1 px-1">
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
          {bridge ? (
            <button type="button" data-chat-drawer-open="" aria-label={ct("chatui.phone.menu")} onClick={bridge.openDrawer} className={iconButton}>
              <Menu aria-hidden="true" className="size-6" />
            </button>
          ) : null}
          <h1 className={`min-w-0 flex-1 truncate text-lg font-semibold leading-tight text-fg ${bridge ? "" : "ps-3"}`}>{title}</h1>
          <button type="button" data-chat-phone-search-open="" aria-label={ct("chatui.phone.search.open")} onClick={() => setOpen(true)} className={iconButton}>
            <Search aria-hidden="true" className="size-5" />
          </button>
        </div>
      )}
    </header>
  );
}
