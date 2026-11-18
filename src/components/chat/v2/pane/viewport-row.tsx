"use client";

import React from "react";
import type { MessageDto, ReaderDto } from "@/server/chat/dto";
import { MessageBubble, type MessageMenuSlotApi } from "@/components/chat/v2/message-bubble";
import { PendingBubble } from "@/components/chat/message/pending-bubble";
import { CallsChip, DaySeparator, ServiceLine, UnreadLine } from "@/components/chat/v2/pane/service-rows";
import { usePaneCommands } from "@/components/chat/v2/pane/pane-actions";
import { useMenuDialogs } from "@/components/chat/v2/pane/seams/menu-host";
import { isPendingMessage, outboxItemOfPending } from "@/lib/chat/cache/pending";
import { runFlags } from "@/lib/chat/group";
import type { OutboxItem } from "@/lib/chat/outbox/queue";
import type { BubbleFacts } from "@/lib/chat/v2/pane/bubble-facts";
import type { Row } from "@/lib/chat/viewport/rows";
import { findCustomerNumbers } from "@/lib/tickets/customer-number";

/** What every row of the log shares; it changes only when the header's flags, the people, the readers, the menu or the pending handlers do. */
export interface RowEnv {
  conversationId: string;
  facts: BubbleFacts;
  mentionNames: readonly string[];
  readersByMessage: ReadonlyMap<string, ReaderDto[]>;
  /** the message menu (seam 3) and the hover slot (C2.6) */
  menu?: (api: MessageMenuSlotApi) => React.ReactNode;
  hover?: React.ReactNode;
  /** what a pending bubble's buttons do (the viewport owns the outbox) */
  pending: { retry: (item: OutboxItem) => void; discard: (item: OutboxItem) => void; copy: (item: OutboxItem) => void; edit: (item: OutboxItem) => void };
}

function BubbleRow({ message, start, end, env, highlighted }: { message: MessageDto; start: boolean; end: boolean; env: RowEnv; highlighted: boolean }) {
  const commands = usePaneCommands();
  const dialogs = useMenuDialogs();
  const onOpenWork = React.useCallback((kind: "task" | "ticket", id: string) => (kind === "ticket" ? dialogs.openTicket(id) : undefined), [dialogs]);
  const onHintTicket = React.useCallback((m: MessageDto) => dialogs.problem(m, { customer: findCustomerNumbers(m.body ?? "")[0] ?? null }), [dialogs]);
  const onSuggest = React.useCallback((m: MessageDto, kindKey: string) => dialogs.problem(m, { kindKey }), [dialogs]);
  return (
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
      onReact={commands.react}
      onJump={commands.jumpTo}
      onAck={commands.ack}
      onOpenWork={onOpenWork}
      onHintTicket={onHintTicket}
      onSuggestProblem={onSuggest}
    />
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
function ViewportRowView({ row, env, start, end, highlightId }: { row: Row; env: RowEnv; start: boolean; end: boolean; highlightId: string | null }) {
  if (row.type === "day") return <DaySeparator at={row.at} />;
  if (row.type === "unread") return <UnreadLine />;
  if (row.type === "calls") return <CallsChip messages={row.messages} />;
  const message = row.message;
  if (isPendingMessage(message)) {
    const item = outboxItemOfPending(env.conversationId, message);
    return <PendingBubble item={item} onRetry={env.pending.retry} onDelete={env.pending.discard} onCopy={env.pending.copy} onEdit={env.pending.edit} />;
  }
  if (message.kind === "SYSTEM") return <ServiceLine message={message} />;
  return <BubbleRow message={message} start={start} end={end} env={env} highlighted={highlightId === message.id} />;
}

export const ViewportRow = React.memo(ViewportRowView);

/** The space under a row: a run's last bubble leaves a gap, the bubbles inside a run sit close, and the chips breathe. */
export function rowPadding(row: Row, messages: readonly MessageDto[]): string {
  if (row.type !== "message") return "py-2";
  const m = row.message;
  if (isPendingMessage(m) || m.kind === "SYSTEM") return "py-1.5";
  return runFlags(messages, row.index).end ? "pb-2 pt-0.5" : "pb-0.5 pt-0.5";
}
