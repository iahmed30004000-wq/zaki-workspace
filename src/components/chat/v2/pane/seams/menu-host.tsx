"use client";

import React from "react";
import type { ConversationHeaderDto, MemberDto, MessageDto, ReaderDto } from "@/server/chat/dto";
import { menuFor, type MessageMenuId } from "@/components/chat/message/message-menu-registry";
import { ReaderList } from "@/components/chat/message/message-item";
import { ForwardDialog, NoteDialog } from "@/components/chat/message/message-dialogs";
import { ForwardSheet } from "@/components/chat/v2/forward/forward-sheet";
import { ReplyElsewhereSheet } from "@/components/chat/v2/forward/reply-elsewhere-sheet";
import { useMultiSelectSwitch } from "@/lib/chat/selection";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BubbleGesturesContext, type BubbleGestures } from "@/components/chat/v2/menu/gesture-context";
import { MessageMenuV2 } from "@/components/chat/v2/menu/message-menu-v2";
import { ShortcutPane } from "@/components/chat/v2/menu/shortcut-pane";
import { MakeWorkDialog, titleOf, type WorkKind } from "@/components/chat/message/make-work-dialog";
import { ProblemDialog } from "@/components/chat/message/problem-dialog";
import { RemindDialog } from "@/components/reminders/remind-dialog";
import { TicketDetailModal } from "@/components/ticket-detail-modal";
import type { MessageMenuSlotApi } from "@/components/chat/v2/message-bubble";
import { usePaneActions, usePaneCommands } from "@/components/chat/v2/pane/pane-actions";
import type { BubbleFacts } from "@/lib/chat/v2/pane/bubble-facts";
import { ASK_KIND_KEY, askKindOf, gifsOf, menuContextV2 } from "@/lib/chat/v2/menu/menu-context";
import { useQueryClient } from "@tanstack/react-query";
import { GIFS_KEY, GifError, keepGif } from "@/lib/chat/gifs";
import { copyText } from "@/lib/chat/v2/menu/clipboard";
import { messageLinkOf } from "@/lib/chat/v2/menu/message-link";
import { doubleTapReactionOf, quickReactionsOf } from "@/lib/chat/v2/menu/quick-reactions";
import { readDevicePrefs } from "@/lib/device-prefs";
import { ct } from "@/lib/chat/text";

/**
 * C2.4 — SEAM 3: the message menu and what it opens. C2.6 FILLED IT: the menu of a message is `MessageMenuV2` (the six quick reactions and «⌄» on top,
 * then the registry's items in Telegram's order, hover actions beside the bubble, a right click and the phone's long press), drawn from the registry with
 * `menuContextV2` — `messageMenuContext`, the very function the old `MessageItem` uses, plus the new screen's flags. The registry stays the ONE source of
 * what is offered; this file only carries a pick out and runs the dialogs the items open: forward, note, remind, task / ticket, «🎫 مشكلة» (and
 * «اسألي مشرفتك», the same door with the question kind), the list of who read, and the ticket's own window.
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
  /** «اسألي مشرفتك» is on offer: the company's problem kinds have the question kind */
  askKind: boolean;
}

const MenuContext = React.createContext<MenuDialogs | null>(null);

export function useMenuDialogs(): MenuDialogs {
  const value = React.useContext(MenuContext);
  if (!value) throw new Error("useMenuDialogs: there is no menu host around");
  return value;
}

export function MenuHost({ header, members, children }: { header: ConversationHeaderDto; members: MemberDto[]; children: React.ReactNode }) {
  const commands = usePaneCommands();
  const [making, setMaking] = React.useState<{ message: MessageDto; kind: WorkKind } | null>(null);
  const [problemFor, setProblemFor] = React.useState<{ message: MessageDto; kindKey: string | null; customer?: string | null } | null>(null);
  const [ticketOpen, setTicketOpen] = React.useState<string | null>(null);
  const [noting, setNoting] = React.useState<MessageDto | null>(null);
  const [reminding, setReminding] = React.useState<MessageDto | null>(null);
  const [elsewhere, setElsewhere] = React.useState<MessageDto | null>(null);

  const askKind = askKindOf(header.me.problemKinds);
  const conversationId = header.id;
  const queries = useQueryClient();
  const dialogs = React.useMemo<MenuDialogs>(
    () => ({
      askKind,
      act: (message, id) => {
        if (id === "reply") commands.startReply(message);
        else if (id === "replyElsewhere") setElsewhere(message);
        else if (id === "pin") void commands.pin(message);
        else if (id === "forward") commands.startForward(message);
        else if (id === "edit") commands.startEdit(message);
        else if (id === "note") setNoting(message);
        else if (id === "remind") setReminding(message);
        else if (id === "task" || id === "ticket") setMaking({ message, kind: id });
        else if (id === "problem") setProblemFor({ message, kindKey: null });
        else if (id === "ask") setProblemFor({ message, kindKey: ASK_KIND_KEY });
        else if (id === "copyLink")
          void copyText(messageLinkOf(window.location.origin, conversationId, message.id), navigator.clipboard).then((ok) => (ok ? commands.say("chatui.menu.link_copied") : commands.say("chatc.menu.failed", "error")));
        else if (id === "mustread") void commands.setMustRead(message, !message.mustRead);
        else if (id === "removePreview") void commands.removePreview(message);
        else if (id === "delete") void commands.remove(message);
        else if (id === "copy") commands.copy(message);
        // «احفظ بالصور المتحركة»: every GIF of the message goes into my own library (the server judges that I may read each one)
        else if (id === "saveGif")
          void Promise.all(gifsOf(message).map((file) => keepGif(file.id))).then(
            () => {
              void queries.invalidateQueries({ queryKey: GIFS_KEY });
              commands.say("gifs.saved_done", "success");
            },
            (e: unknown) => commands.say(e instanceof GifError ? e.key : "gifs.save_failed", "error"),
          );
      },
      openTicket: setTicketOpen,
      problem: (message, opts = {}) => setProblemFor({ message, kindKey: opts.kindKey ?? null, customer: opts.customer ?? null }),
    }),
    [commands, askKind, conversationId, queries],
  );
  // a double click on a bubble replies where the registry offers «رد», a double tap of a finger reacts (one object for the life of the pane: it holds the commands only)
  const gestures = React.useMemo<BubbleGestures>(
    () => ({
      reply: (message, facts) => {
        if (menuFor(menuContextV2(message, facts, { readerCount: 0, askKind: false })).some((item) => item.id === "reply")) commands.startReply(message);
      },
      // C4.1: the phone's double tap = the person's quick reaction (none chosen: nothing happens). The choice is read from this device's copy at the moment of the tap.
      quickReact: (message, facts) => {
        const emoji = doubleTapReactionOf({ preference: readDevicePrefs().mirror?.doubleTap, reactions: message.reactions, canPost: facts.canPost });
        if (emoji) void commands.react(message, emoji);
      },
    }),
    [commands],
  );

  const privateSource = header.kind !== "TOPIC" || !!header.restricted || !!header.teamId;
  return (
    <MenuContext.Provider value={dialogs}>
      <BubbleGesturesContext.Provider value={gestures}>{children}</BubbleGesturesContext.Provider>
      <ShortcutPane />
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
          if (made.kind === "task" && made.stepsCopied === false) commands.say("chatcl.to_task_steps_failed", "error");
          else commands.say(made.kind === "task" ? (made.stepsCopied ? "chatcl.to_task_done" : "chatc.work.task_made") : "chatc.work.ticket_made", "success");
          commands.refresh();
        }}
      />
      {ticketOpen && header.me.id ? <TicketDetailModal ticketId={ticketOpen} currentUserId={header.me.id} onClose={() => setTicketOpen(null)} /> : null}
      <ForwardHost header={header} />
      {elsewhere ? <ReplyElsewhereSheet message={elsewhere} from={conversationId} onClose={() => setElsewhere(null)} /> : null}
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

/**
 * «حوّل»: the dialog reads the pane's STATE (which message is being forwarded), so it is its own small part — the rest of the host never draws for a reply or an edit.
 * S5.2: with the company's switch `chatMultiSelect` on it is THE forward sheet (the one «حدّد» then «حوّل» opens too: search, the saved chat, every space's places, several
 * targets, a comment, «افتح»); with it off, the plain list of before (the sheet's doors answer «not found» then).
 */
function ForwardHost({ header }: { header: ConversationHeaderDto }) {
  const { conversationId, forwarding, endForward, say } = usePaneActions();
  const sheet = useMultiSelectSwitch(header);
  if (sheet) return <ForwardSheet open={forwarding !== null} from={conversationId} messageIds={forwarding ? [forwarding.id] : []} onClose={endForward} />;
  return (
    <ForwardDialog
      message={forwarding}
      from={conversationId}
      onClose={endForward}
      onDone={(ok) => {
        endForward();
        say(ok ? "chatc.menu.forwarded" : "chatc.menu.failed", ok ? "success" : "error");
      }}
    />
  );
}

/** «مين شاف»: today's reader list of THIS message (the people whose newest read message it is), in a small window. */
function SeenDialog({ readers, onClose }: { readers: ReaderDto[]; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="sm" aria-label={ct("chatc.readers_title")}>
        <DialogHeader>
          <DialogTitle>{ct("chatc.readers_title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>{readers.length ? <ReaderList readers={readers} /> : <p className="text-sm text-fg-muted">{ct("chatui.menu.seen_empty")}</p>}</DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/** The menu of ONE message: hover actions, «⋯» and the right click on a computer, the sheet of a long press on a phone. Nothing for a message that has none. */
function MessageMenuSlot({ message, facts, sheetOpen, setSheetOpen, menuOpen, setMenuOpen, translate, readers, pressInline, phone }: MessageMenuSlotApi & { facts: BubbleFacts }) {
  const { act, askKind } = useMenuDialogs();
  const commands = usePaneCommands();
  const [seen, setSeen] = React.useState(false);
  // C4.1: the person's own six (this device's copy of their choice), read each time a menu opens so a change in «إعداداتي» applies at once
  const asked = menuOpen || sheetOpen;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- read again each time a menu opens or closes: the device's copy is not React state
  const quick = React.useMemo(() => quickReactionsOf(), [asked]);
  const readerCount = readers.length;
  const context = React.useMemo(() => menuContextV2(message, facts, { readerCount, askKind }), [message, facts, readerCount, askKind]);
  const onAction = (id: MessageMenuId) => {
    if (id === "translate") translate();
    else if (id === "seen") setSeen(true);
    else if (id === "readText") pressInline("image-text");
    else if (id === "transcribe") pressInline("voice-transcript");
    else act(message, id);
  };
  return (
    <>
      <MessageMenuV2
        context={context}
        quick={quick}
        onAction={onAction}
        onReact={(emoji) => void commands.react(message, emoji)}
        sheetOpen={sheetOpen}
        onSheetOpenChange={setSheetOpen}
        menuOpen={menuOpen}
        onMenuOpenChange={setMenuOpen}
        {...(phone
          ? {
              phone: {
                ...phone,
                chosen: new Set(message.reactions.filter((r) => r.mine).map((r) => r.emoji)),
                sendReaction: (emoji: string) => commands.react(message, emoji),
                togglePin: () => commands.pin(message),
              },
            }
          : {})}
      />
      {seen ? <SeenDialog readers={readers} onClose={() => setSeen(false)} /> : null}
    </>
  );
}

/** What the bubbles' `menu` slot is given: one function for all of them (it changes only when the header's own flags do). */
export function useMessageMenu(facts: BubbleFacts): (api: MessageMenuSlotApi) => React.ReactNode {
  return React.useCallback((api: MessageMenuSlotApi) => <MessageMenuSlot {...api} facts={facts} />, [facts]);
}
