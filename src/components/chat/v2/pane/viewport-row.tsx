"use client";

import React from "react";
import { Reply } from "lucide-react";
import type { MessageDto, ReaderDto } from "@/server/chat/dto";
import { MessageBubble, type MessageMenuSlotApi } from "@/components/chat/v2/message-bubble";
import { PendingBubble } from "@/components/chat/message/pending-bubble";
import { CallsChip, DaySeparator, ServiceLine, UnreadLine } from "@/components/chat/v2/pane/service-rows";
import { usePaneCommands } from "@/components/chat/v2/pane/pane-actions";
import { useMenuDialogs } from "@/components/chat/v2/pane/seams/menu-host";
import { useBubbleGestures } from "@/components/chat/v2/menu/gesture-context";
import { isPendingMessage, outboxItemOfPending } from "@/lib/chat/cache/pending";
import { runFlags } from "@/lib/chat/group";
import type { OutboxItem } from "@/lib/chat/outbox/queue";
import type { BubbleFacts } from "@/lib/chat/v2/pane/bubble-facts";
import { sameRow, type Row } from "@/lib/chat/viewport/rows";
import { findCustomerNumbers } from "@/lib/tickets/customer-number";
import { SLIDE_MS, prefersReducedMotion } from "@/lib/chat/v2/phone/motion";
import { REPLY_COMMIT_PX, attachReplySwipe, hapticTick } from "@/lib/chat/v2/phone/swipe-reply";

/** What every row of the log shares; it changes only when the header's flags, the people, the readers, the menu or the pending handlers do. */
export interface RowEnv {
  conversationId: string;
  facts: BubbleFacts;
  mentionNames: readonly string[];
  readersByMessage: ReadonlyMap<string, ReaderDto[]>;
  /** the message menu (seam 3) and the hover slot (C2.6) */
  menu?: (api: MessageMenuSlotApi) => React.ReactNode;
  hover?: React.ReactNode;
  /** a calls chip was pressed: the viewport opens the list (the id of the run's first line) */
  openCalls: (firstLineId: string) => void;
  /** what a pending bubble's buttons do (the viewport owns the outbox) */
  pending: { retry: (item: OutboxItem) => void; discard: (item: OutboxItem) => void; copy: (item: OutboxItem) => void; edit: (item: OutboxItem) => void };
  /** C3b.5 («حدّد»): present while the person is selecting — which rows are picked and how a press toggles one. Absent: the rows are as they were. */
  select?: { on: boolean; selected: ReadonlySet<string>; toggle: (messageId: string) => void };
}

/**
 * S5.7 (b) — SWIPE TO REPLY around ONE bubble (the phone). The finger drags the bubble toward the end (leftwards here) and a reply arrow appears at the start side; at the trigger the
 * phone buzzes, and lifting the finger starts the reply the same way a double click does (`gestures.reply`: the registry decides whether this person may reply to this message).
 * The rules are `src/lib/chat/v2/phone/swipe-reply.ts` (a finger only; never the vertical scroll, the swipe back's edge, a link or a player, selected text or the multi-select); this
 * only moves two elements by hand (no render per move) and honours reduced motion. `touch-pan-y` leaves the page's vertical scroll to the browser.
 */
function SwipeReplyBox({ message, facts, enabled, children }: { message: MessageDto; facts: BubbleFacts; enabled: boolean; children: React.ReactNode }) {
  const gestures = useBubbleGestures();
  const boxRef = React.useRef<HTMLDivElement>(null);
  const leadRef = React.useRef<HTMLDivElement>(null);
  const iconRef = React.useRef<HTMLSpanElement>(null);
  const live = React.useRef({ gestures, message, facts, enabled });
  live.current = { gestures, message, facts, enabled };
  const wired = gestures !== null;
  React.useEffect(() => {
    const box = boxRef.current;
    const lead = leadRef.current;
    const icon = iconRef.current;
    if (!wired || !box || !lead || !icon) return;
    const rtl = () => (typeof document !== "undefined" ? (document.documentElement.dir || getComputedStyle(box).direction) === "rtl" : true);
    return attachReplySwipe(box as unknown as Parameters<typeof attachReplySwipe>[0], {
      rtl,
      width: () => window.innerWidth,
      enabled: () => live.current.enabled,
      hasSelection: () => window.getSelection()?.isCollapsed === false,
      onPull: (px, settle) => {
        lead.style.transition = settle && !prefersReducedMotion() ? `transform ${SLIDE_MS}ms ease-out` : "none";
        lead.style.transform = px > 0 ? `translateX(${(rtl() ? -1 : 1) * px}px)` : "";
        icon.style.opacity = String(Math.min(px / REPLY_COMMIT_PX, 1));
      },
      onReply: () => live.current.gestures?.reply(live.current.message, live.current.facts),
      haptic: () => void hapticTick(),
    });
  }, [wired]);
  return (
    <div ref={boxRef} data-swipe-reply-box="" className="relative touch-pan-y">
      <span ref={iconRef} aria-hidden="true" data-swipe-reply-icon="" style={{ opacity: 0 }} className="pointer-events-none absolute inset-y-0 start-1 flex items-center">
        <span className="grid size-8 place-items-center rounded-full bg-surface-2 text-accent">
          <Reply className="size-4 rtl:-scale-x-100" />
        </span>
      </span>
      <div ref={leadRef}>{children}</div>
    </div>
  );
}

function BubbleRow({ message, start, end, env, highlighted }: { message: MessageDto; start: boolean; end: boolean; env: RowEnv; highlighted: boolean }) {
  const commands = usePaneCommands();
  const dialogs = useMenuDialogs();
  const onOpenWork = React.useCallback((kind: "task" | "ticket", id: string) => (kind === "ticket" ? dialogs.openTicket(id) : undefined), [dialogs]);
  const onHintTicket = React.useCallback((m: MessageDto) => dialogs.problem(m, { customer: findCustomerNumbers(m.body ?? "")[0] ?? null }), [dialogs]);
  const onSuggest = React.useCallback((m: MessageDto, kindKey: string) => dialogs.problem(m, { kindKey }), [dialogs]);
  const picked = env.select?.selected.has(message.id) ?? false;
  const toggle = env.select?.toggle;
  const select = React.useMemo(() => (env.select?.on && toggle ? { on: true, selected: picked, toggle } : undefined), [env.select?.on, picked, toggle]);
  // the reply swipe is for a live message of somebody's, never while messages are being picked and never for the owner's silent reading
  const swipes = !select && !env.facts.oversight && !message.deleted;
  return (
    <SwipeReplyBox message={message} facts={env.facts} enabled={swipes}>
      <MessageBubble
        message={message}
        conversationId={env.conversationId}
        facts={env.facts}
        start={start}
        end={end}
        mentionNames={env.mentionNames}
        readers={env.readersByMessage.get(message.id)}
        highlighted={highlighted}
        menu={env.menu}
        hover={env.hover}
        select={select}
        onReact={commands.react}
        onJump={commands.jumpTo}
        onAck={commands.ack}
        onOpenWork={onOpenWork}
        onHintTicket={onHintTicket}
        onSuggestProblem={onSuggest}
      />
    </SwipeReplyBox>
  );
}

/**
 * C2.4 — ONE ROW of the virtual log. A day, the unread line, a folded run of calls and a system line are the centred chips of `service-rows.tsx`; a
 * person's message is a `MessageBubble`; a message of mine that the server does not have yet (its id starts with `pending:`) is the `PendingBubble` with
 * retry / discard — NEVER a `MessageBubble`, whose menu would act on an id the server does not know.
 *
 * `start` / `end` are the run flags of a message row (the viewport asks `runFlags` per row): the env holds no message list, so a new message does not make
 * every row draw again — only the row whose flags changed (the one that stopped being the last of its run).
 */
interface ViewportRowProps {
  row: Row;
  env: RowEnv;
  /** the run flags of a message row (the viewport asks `runFlags` per row) */
  start: boolean;
  end: boolean;
  /** this row's message is the target of a jump */
  highlighted: boolean;
}

function ViewportRowView({ row, env, start, end, highlighted }: ViewportRowProps) {
  if (row.type === "day") return <DaySeparator at={row.at} />;
  if (row.type === "unread") return <UnreadLine />;
  if (row.type === "calls") return <CallsChip messages={row.messages} onOpen={env.openCalls} />;
  const message = row.message;
  if (isPendingMessage(message)) {
    const item = outboxItemOfPending(env.conversationId, message);
    return <PendingBubble item={item} onRetry={env.pending.retry} onDelete={env.pending.discard} onCopy={env.pending.copy} onEdit={env.pending.edit} />;
  }
  if (message.kind === "SYSTEM") return <ServiceLine message={message} formatting={env.facts.formatting} />;
  return <BubbleRow message={message} start={start} end={end} env={env} highlighted={highlighted} />;
}

/** Drawn again only when what it holds changed: `buildRows` makes a new object for every row each time the messages change, so the rows are compared by content. */
export const ViewportRow = React.memo(ViewportRowView, (a, b) => a.env === b.env && a.start === b.start && a.end === b.end && a.highlighted === b.highlighted && sameRow(a.row, b.row));

/** The space under a row: a run's last bubble leaves a gap, the bubbles inside a run sit close, and the chips breathe. */
export function rowPadding(row: Row, flags: { end: boolean }): string {
  if (row.type !== "message") return "py-2";
  const m = row.message;
  if (isPendingMessage(m) || m.kind === "SYSTEM") return "py-1.5";
  return flags.end ? "pb-2 pt-0.5" : "pb-0.5 pt-0.5";
}
