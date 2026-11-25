"use client";

import React from "react";
import { Menu } from "lucide-react";
import { ct } from "@/lib/chat/text";
import { BOTFATHER_WORDS, botFatherSuggestions } from "@/lib/chat/botfather";

/** What each command of the «/» menu does, one dictionary key each. */
const WHAT: Record<ReturnType<typeof botFatherSuggestions>[number], string> = {
  newbot: "botfather.cmd.newbot",
  mybots: "botfather.cmd.mybots",
  setname: "botfather.cmd.setname",
  setdescription: "botfather.cmd.setdescription",
  setabouttext: "botfather.cmd.setabouttext",
  setuserpic: "botfather.cmd.setuserpic",
  setcommands: "botfather.cmd.setcommands",
  setjoingroups: "botfather.cmd.setjoingroups",
  setprivacy: "botfather.cmd.setprivacy",
  setwebhook: "botfather.cmd.setwebhook",
  token: "botfather.cmd.token",
  revoke: "botfather.cmd.revoke",
  deletebot: "botfather.cmd.deletebot",
  cancel: "botfather.cmd.cancel",
  help: "botfather.cmd.help",
};

/**
 * What sits above the box in my chat with «بوت فاذر», as Telegram's: «ابدأ» before the first message; then «القائمة», and while a word starting with «/» is being typed, the
 * commands that fit it, each with what it does. A tap on a command sends it.
 */
export function BotFatherBar({ text, started, busy, onSend, onType }: { text: string; started: boolean; busy: boolean; onSend: (command: string) => void; onType: (value: string) => void }) {
  const [pressedStart, setPressedStart] = React.useState(false);
  const found = botFatherSuggestions(text);
  if (found.length) {
    return (
      <ul data-botfather-menu aria-label={ct("botfather.menu_label")} className="mx-2 mb-1 max-h-[40dvh] overflow-y-auto rounded-2xl border border-border/60 bg-surface-1 shadow-card">
        {found.map((c) => (
          <li key={c}>
            <button type="button" data-botfather-command={c} disabled={busy} onClick={() => onSend(`/${c}`)} className="flex min-h-11 w-full items-center gap-3 px-3 py-1.5 text-start hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none disabled:opacity-60">
              <bdi dir="ltr" className="shrink-0 text-sm font-semibold text-accent">{`/${c}`}</bdi>
              <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">{ct(WHAT[c], BOTFATHER_WORDS)}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  }
  if (text !== "") return null;
  if (!started && !pressedStart) {
    return (
      <div className="px-3 pb-1">
        <button
          type="button"
          data-botfather-start
          disabled={busy}
          onClick={() => {
            setPressedStart(true);
            onSend("/start");
          }}
          className="min-h-12 w-full rounded-full bg-accent text-base font-semibold text-accent-fg shadow-card hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
        >
          {ct("botfather.start")}
        </button>
      </div>
    );
  }
  return (
    <div className="flex px-3 pb-1">
      <button type="button" data-botfather-open-menu onClick={() => onType("/")} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-accent/15 px-3 text-sm font-semibold text-accent hover:bg-accent/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        <Menu aria-hidden="true" className="size-4" />
        {ct("botfather.menu_button")}
      </button>
    </div>
  );
}
