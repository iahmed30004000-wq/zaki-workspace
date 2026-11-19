"use client";

import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { MessageDto } from "@/server/chat/dto";
import type { OutboxRestore } from "@/components/chat/composer/chat-composer";
import { useOptionalToast } from "@/components/ui/toast";
import { chatKeys } from "@/lib/chat/cache/keys";
import { scheduleSync } from "@/lib/chat/cache/runtime";
import { tombstone } from "@/lib/chat/cache/writer";
import { ct } from "@/lib/chat/text";
import { callDoor, doors, type Door } from "@/lib/chat/v2/pane/message-actions";
import { clearPendingSearch, peekPendingSearch } from "@/lib/chat/v2/phone/pending-search";

/**
 * C2.4 — THE ONE SEAM of the conversation pane (`src/components/chat/v2/pane/`). Everything a later package needs to DO to the open conversation is
 * here, in one context, so C2.5 (the composer), C2.6 (the message menu and the shortcuts) and C2.7 (the info panel) only CONSUME it and never reach into
 * the pane's files:
 *
 *   reply · editing · forward     the three things the composer and the menu hand to each other (`startReply`, `cancelReply`, …)
 *   restore                        the words of a message that failed for good, put back in the composer by «عدّل»
 *   remove · pin · react · ack · setMustRead · copy      the message's own actions (the same doors the old screen called: `message-actions.ts`)
 *   jumpTo · toNewest              move the viewport (the history hook's jump with its 2 s highlight, and «آخر الرسائل»)
 *   openSearch / closeSearch       the search panel under the header
 *   openInfo / closeInfo / toggleInfo / infoOpen      the info panel (C2.7 draws it; the header's title only toggles `infoOpen`)
 *
 * It comes in two parts so that drawing stays cheap: the COMMANDS never change identity for the life of the pane (the bubbles and the menu hold them;
 * a reply being started re-draws no bubble), and the STATE (reply, editing, restore, forwarding, searchOpen, infoOpen) is what the composer, the header
 * and the panels read. `usePaneActions()` gives both; `usePaneCommands()` only the commands.
 *
 * The server decides every action again; a refusal is a toast, never a silent no-op. Nothing here writes a cache key but through the cache's own writer
 * (`tombstone`) or by asking the sync feed to catch up (`scheduleSync`).
 */
export interface PaneState {
  conversationId: string;
  reply: MessageDto | null;
  editing: MessageDto | null;
  restore: OutboxRestore | null;
  forwarding: MessageDto | null;
  searchOpen: boolean;
  infoOpen: boolean;
}

export interface PaneCommands {
  startReply: (message: MessageDto) => void;
  cancelReply: () => void;
  startEdit: (message: MessageDto) => void;
  cancelEdit: () => void;
  startRestore: (restore: OutboxRestore) => void;
  endRestore: () => void;
  startForward: (message: MessageDto) => void;
  endForward: () => void;

  remove: (message: MessageDto) => Promise<boolean>;
  pin: (message: MessageDto) => Promise<boolean>;
  react: (message: MessageDto, emoji: string) => Promise<boolean>;
  ack: (message: MessageDto, on: boolean) => Promise<boolean>;
  setMustRead: (message: MessageDto, on: boolean) => Promise<boolean>;
  copy: (message: MessageDto) => void;
  /** ask a door that is not a message action (close / archive a topic, join) and say what happened; `done` is the toast key on success */
  call: (door: Door, done?: string) => Promise<boolean>;
  /** the messages are asked for again (a task, a ticket or a note was made of one: no event of the feed carries that) */
  refresh: () => void;

  jumpTo: (messageId: string) => void;
  toNewest: () => void;

  openSearch: () => void;
  closeSearch: () => void;
  openInfo: () => void;
  closeInfo: () => void;
  toggleInfo: () => void;

  /** a toast with a dictionary key (no toast provider: nothing is shown) */
  say: (key: string, kind?: "success" | "error") => void;
}

export type PaneActionsValue = PaneState & PaneCommands;

const StateContext = React.createContext<PaneState | null>(null);
const CommandsContext = React.createContext<PaneCommands | null>(null);

/** Only the commands: stable for the life of the pane, so a component that holds them never re-draws because of the state. */
export function usePaneCommands(): PaneCommands {
  const value = React.useContext(CommandsContext);
  if (!value) throw new Error("usePaneCommands: there is no conversation pane around");
  return value;
}

/** The state and the commands together (what the composer, the header and the panels read). */
export function usePaneActions(): PaneActionsValue {
  const state = React.useContext(StateContext);
  const commands = React.useContext(CommandsContext);
  if (!state || !commands) throw new Error("usePaneActions: there is no conversation pane around");
  return React.useMemo(() => ({ ...state, ...commands }), [state, commands]);
}

export function PaneActionsProvider({
  conversationId,
  jumpTo,
  toNewest,
  children,
}: {
  conversationId: string;
  jumpTo: (messageId: string) => void | Promise<unknown>;
  toNewest: () => void | Promise<unknown>;
  children: React.ReactNode;
}) {
  const qc = useQueryClient();
  const toast = useOptionalToast();
  const [reply, setReply] = React.useState<MessageDto | null>(null);
  const [editing, setEditing] = React.useState<MessageDto | null>(null);
  const [restore, setRestore] = React.useState<OutboxRestore | null>(null);
  const [forwarding, setForwarding] = React.useState<MessageDto | null>(null);
  // C2.8: the phone's info screen leaves a note when «🔍 بحث» was pressed there: this pane opens its search from it, once (the note is cleared after the mount)
  const [searchOpen, setSearchOpen] = React.useState(() => peekPendingSearch(conversationId));
  React.useEffect(() => clearPendingSearch(conversationId), [conversationId]);
  const [infoOpen, setInfoOpen] = React.useState(false);

  // the latest of what the provider was given: the commands below keep one identity for the life of the pane
  const live = React.useRef({ jumpTo, toNewest, toast });
  live.current = { jumpTo, toNewest, toast };

  const commands = React.useMemo<PaneCommands>(() => {
    const say = (key: string, kind: "success" | "error" = "success") => {
      live.current.toast?.toast(ct(key), kind);
    };
    const call = async (door: Door, done?: string): Promise<boolean> => {
      const result = await callDoor(door);
      if (result.ok) {
        if (done) say(done, "success");
        scheduleSync(qc);
        return true;
      }
      say(result.message ?? "chatc.menu.failed", "error");
      return false;
    };
    return {
      startReply: (message) => {
        setEditing(null);
        setReply(message);
      },
      cancelReply: () => setReply(null),
      startEdit: (message) => {
        setReply(null);
        setEditing(message);
      },
      cancelEdit: () => setEditing(null),
      startRestore: setRestore,
      endRestore: () => setRestore(null),
      startForward: setForwarding,
      endForward: () => setForwarding(null),
      remove: async (message) => {
        const ok = await call(doors.remove(message.id));
        if (ok) tombstone(qc, conversationId, message.id);
        return ok;
      },
      pin: (message) => call(doors.pin(message.id)),
      react: (message, emoji) => call(doors.react(message.id, emoji)),
      ack: (message, on) => call(doors.ack(message.id, on)),
      setMustRead: (message, on) => call(doors.mustRead(message.id, on)),
      copy: (message) => {
        void navigator.clipboard?.writeText(message.body ?? "").then(
          () => say("chatc.menu.copied"),
          () => say("chatc.menu.failed", "error"),
        );
      },
      call,
      refresh: () => void qc.invalidateQueries({ queryKey: chatKeys.messages(conversationId), exact: true }),
      jumpTo: (messageId) => void live.current.jumpTo(messageId),
      toNewest: () => void live.current.toNewest(),
      openSearch: () => setSearchOpen(true),
      closeSearch: () => setSearchOpen(false),
      openInfo: () => setInfoOpen(true),
      closeInfo: () => setInfoOpen(false),
      toggleInfo: () => setInfoOpen((v) => !v),
      say,
    };
  }, [qc, conversationId]);

  const state = React.useMemo<PaneState>(() => ({ conversationId, reply, editing, restore, forwarding, searchOpen, infoOpen }), [conversationId, reply, editing, restore, forwarding, searchOpen, infoOpen]);

  return (
    <CommandsContext.Provider value={commands}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </CommandsContext.Provider>
  );
}
