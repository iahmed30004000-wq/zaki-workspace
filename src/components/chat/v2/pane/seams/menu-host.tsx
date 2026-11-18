"use client";

import React from "react";
import type { ConversationHeaderDto, MemberDto, MessageDto } from "@/server/chat/dto";
import { MessageMenu } from "@/components/chat/message/message-menu";
import type { MessageMenuId } from "@/components/chat/message/message-menu-registry";
import { messageMenuContext } from "@/components/chat/message/message-item";
import { ForwardDialog, NoteDialog } from "@/components/chat/message/message-dialogs";
import { MakeWorkDialog, titleOf, type WorkKind } from "@/components/chat/message/make-work-dialog";
import { ProblemDialog } from "@/components/chat/message/problem-dialog";
import { RemindDialog } from "@/components/reminders/remind-dialog";
import { TicketDetailModal } from "@/components/ticket-detail-modal";
import type { MessageMenuSlotApi } from "@/components/chat/v2/message-bubble";
import { usePaneActions, usePaneCommands } from "@/components/chat/v2/pane/pane-actions";
import type { BubbleFacts } from "@/lib/chat/v2/pane/bubble-facts";

/**
 * C2.4 — SEAM 3: the message menu and what it opens. C2.6 OWNS THIS FILE AFTERWARDS (quick reactions on top, the new registry items, hover actions,
 * shortcuts); until then it draws TODAY'S `MessageMenu` from the registry — the same items, the same rules (`messageMenuContext` is the very function the
 * old `MessageItem` uses), the same confirmation before a delete — and runs the dialogs the items open: forward, note, remind, task / ticket, «🎫 مشكلة»
 * and the ticket's own window. The registry stays the ONE source of what is offered; this file only carries a pick out.
 *
 * The pane wraps its messages in `<MenuHost>`; a bubble gets its menu from `useMessageMenu(facts)`, ONE function for every bubble (so a bubble that did
 * not change does not draw again). Every action goes through the pane's commands (`pane-actions.tsx`).
 */
export interface MenuDialogs {
  /** a pick of the registry's menu */
  act: (message: MessageDto, id: MessageMenuId) => void;
  /** a «صارت تذكرة» chip was pressed */
  openTicket: (ticketId: string) => void;
  /** «🎫 مشكلة»: from the menu, from a suggestion chip (`kindKey`) or from the customer-data hint (`customer`) */
  problem: (message: MessageDto, opts?: { kindKey?: string | null; customer?: string | null }) => void;
}

const MenuContext = React.createContext<MenuDialogs | null>(null);

export function useMenuDialogs(): MenuDialogs {
  const value = React.useContext(MenuContext);
  if (!value) throw new Error("useMenuDialogs: there is no menu host around");
  return value;
}

export function MenuHost({ header, members, children }: { header: ConversationHeaderDto; members: MemberDto[]; children: React.ReactNode }) {
  const commands = usePaneCommands();
  const { conversationId, forwarding } = usePaneActions();
  const [making, setMaking] = React.useState<{ message: MessageDto; kind: WorkKind } | null>(null);
  const [problemFor, setProblemFor] = React.useState<{ message: MessageDto; kindKey: string | null; customer?: string | null } | null>(null);
  const [ticketOpen, setTicketOpen] = React.useState<string | null>(null);
  const [noting, setNoting] = React.useState<MessageDto | null>(null);
  const [reminding, setReminding] = React.useState<MessageDto | null>(null);

  const dialogs = React.useMemo<MenuDialogs>(
    () => ({
      act: (message, id) => {
        if (id === "reply") commands.startReply(message);
        else if (id === "pin") void commands.pin(message);
        else if (id === "forward") commands.startForward(message);
        else if (id === "edit") commands.startEdit(message);
        else if (id === "note") setNoting(message);
        else if (id === "remind") setReminding(message);
        else if (id === "task" || id === "ticket") setMaking({ message, kind: id });
        else if (id === "problem") setProblemFor({ message, kindKey: null });
        else if (id === "mustread") void commands.setMustRead(message, !message.mustRead);
        else if (id === "delete") void commands.remove(message);
        else if (id === "copy") commands.copy(message);
      },
      openTicket: setTicketOpen,
      problem: (message, opts = {}) => setProblemFor({ message, kindKey: opts.kindKey ?? null, customer: opts.customer ?? null }),
    }),
    [commands],
  );

  const privateSource = header.kind !== "TOPIC" || !!header.restricted || !!header.teamId;
  return (
    <MenuContext.Provider value={dialogs}>
      {children}
      <ProblemDialog
        message={problemFor?.message ?? null}
        kinds={header.me.problemKinds ?? []}
        people={members}
        privateSource={privateSource}
        defaultKind={problemFor?.kindKey ?? null}
        defaultCustomer={problemFor?.customer ?? null}
        onClose={() => setProblemFor(null)}
        onDone={(merged) => {
          setProblemFor(null);
          commands.say(merged ? "tickets.dialog.merged" : "tickets.dialog.done", "success");
          commands.refresh();
        }}
      />
      <MakeWorkDialog
        message={making?.message ?? null}
        kind={making?.kind ?? "task"}
        privateSource={privateSource}
        onClose={() => setMaking(null)}
        onDone={(made) => {
          setMaking(null);
          commands.say(made.kind === "task" ? "chatc.work.task_made" : "chatc.work.ticket_made", "success");
          commands.refresh();
        }}
      />
      {ticketOpen && header.me.id ? <TicketDetailModal ticketId={ticketOpen} currentUserId={header.me.id} onClose={() => setTicketOpen(null)} /> : null}
      <ForwardDialog
        message={forwarding}
        from={conversationId}
        onClose={commands.endForward}
        onDone={(ok) => {
          commands.endForward();
          commands.say(ok ? "chatc.menu.forwarded" : "chatc.menu.failed", ok ? "success" : "error");
        }}
      />
      <NoteDialog
        message={noting}
        onClose={() => setNoting(null)}
        onDone={(ok) => {
          setNoting(null);
          commands.say(ok ? "chatc.menu.note_saved" : "chatc.menu.failed", ok ? "success" : "error");
          if (ok) commands.refresh();
        }}
      />
      {reminding ? (
        <RemindDialog
          open
          onClose={() => setReminding(null)}
          onSaved={() => {
            setReminding(null);
            commands.say("reminder.saved", "success");
          }}
          defaultTitle={titleOf(reminding.body)}
          messageId={reminding.id}
        />
      ) : null}
    </MenuContext.Provider>
  );
}

/** The registry's menu of ONE message: the «⋯» beside the bubble on a computer, the sheet of a long press on a phone. Nothing for a message that has none. */
function MessageMenuSlot({ message, facts, sheetOpen, setSheetOpen, translate }: MessageMenuSlotApi & { facts: BubbleFacts }) {
  const { act } = useMenuDialogs();
  const commands = usePaneCommands();
  return (
    <MessageMenu
      context={messageMenuContext(message, facts)}
      onAction={(id) => (id === "translate" ? translate() : act(message, id))}
      onReact={(emoji) => void commands.react(message, emoji)}
      sheetOpen={sheetOpen}
      onSheetOpenChange={setSheetOpen}
    />
  );
}

/** What the bubbles' `menu` slot is given: one function for all of them (it changes only when the header's own flags do). */
export function useMessageMenu(facts: BubbleFacts): (api: MessageMenuSlotApi) => React.ReactNode {
  return React.useCallback((api: MessageMenuSlotApi) => <MessageMenuSlot {...api} facts={facts} />, [facts]);
}
