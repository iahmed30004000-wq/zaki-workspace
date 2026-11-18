"use client";

import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ConversationHeaderDto, ReaderDto } from "@/server/chat/dto";
import { JumpButtons, StickyDateChip } from "@/components/chat/v2/pane/floating";
import { usePaneCommands } from "@/components/chat/v2/pane/pane-actions";
import { useMessageMenu } from "@/components/chat/v2/pane/seams/menu-host";
import { ViewportRow, rowPadding, type RowEnv } from "@/components/chat/v2/pane/viewport-row";
import { discardPending, retryPending } from "@/lib/chat/outbox/optimistic";
import { removePending } from "@/lib/chat/cache/pending";
import { useChatRow } from "@/lib/chat/cache/selectors";
import { dayLabelOf } from "@/lib/chat/day-separator";
import type { ConversationHistory } from "@/lib/chat/history/use-conversation-history";
import { isAtBottom } from "@/lib/chat/conversation/client";
import { MENTION_ALL_NAME } from "@/lib/chat/conversation/mentions";
import { useOutbox } from "@/lib/chat/outbox/use-outbox";
import { playChatSound } from "@/lib/chat/sounds";
import { ct } from "@/lib/chat/text";
import type { BubbleFacts } from "@/lib/chat/v2/pane/bubble-facts";
import type { PaneMembers } from "@/lib/chat/v2/pane/composer-detail";
import { arrivalSoundOf } from "@/lib/chat/v2/pane/arrival-sound";
import { jumpButtonsOf, mentionTargetsOf, mentionsButtonOf } from "@/lib/chat/v2/pane/jump-model";
import { useReadMarking } from "@/lib/chat/v2/pane/use-read-marking";
import { useMessageViewport } from "@/lib/chat/viewport/use-message-viewport";
import { buildRows } from "@/lib/chat/viewport/rows";

/** How long the sticky date stays after the last scroll. */
const STICKY_DATE_MS = 1400;

/**
 * C2.4 — THE VIEWPORT of the conversation: the virtualized, reverse log (newest at the bottom). It is only the DRAWING of what the two C1 hooks decide:
 *
 *  - `useConversationHistory` (C1.6) says where the conversation opened (the newest message, the first unread LINE, a message of a link), pages in both
 *    directions from the scroll, jumps to a message with its 2 s highlight and comes back to the newest;
 *  - `useMessageViewport` (C1.7) is `@tanstack/react-virtual` with measured heights, keeps the visible message where it is when older pages arrive, and
 *    applies today's `onNewest()` / `isAtBottom()` rules to a new message (down to it when I wrote it or I was at the bottom, a counter when I was reading).
 *
 * What it adds: the rows (days, the «رسائل غير مقروءة» line, a run of call lines folded into one chip, system lines, pending bubbles, bubbles), the sticky
 * date chip, the two jump buttons, the read mark (only while the newest message is really on screen — `useReadMarking`) and the arrival sound.
 *
 * The virtual list draws no row on the server (there is nothing to measure against), so a row is tested through `ViewportRow`, not through this component.
 */
export function MessageViewport({ header, history, facts, people }: { header: ConversationHeaderDto; history: ConversationHistory; facts: BubbleFacts; people: PaneMembers | null }) {
  const qc = useQueryClient();
  const commands = usePaneCommands();
  const conversationId = header.id;
  const row = useChatRow(conversationId);

  // ---- the rows
  const rows = React.useMemo(() => buildRows(history.messages, { unreadBeforeId: history.unreadSeparatorBeforeId, foldCalls: true }), [history.messages, history.unreadSeparatorBeforeId]);
  const byId = React.useMemo(() => new Map(history.messages.map((m) => [m.id, m])), [history.messages]);

  // ---- the sticky date: the day of the first message in view, shown while the person scrolls
  const [topId, setTopId] = React.useState<string | null>(null);
  const [scrolling, setScrolling] = React.useState(false);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => () => void (hideTimer.current && clearTimeout(hideTimer.current)), []);
  const flashDate = React.useCallback(() => {
    setScrolling(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setScrolling(false), STICKY_DATE_MS);
  }, []);
  // where the person REALLY is, from the scroll metrics the viewport reports once a landing has been applied: null until the first report. The hook's own
  // `atBottom` starts as true (before anything was scrolled), and a conversation that opens on its first unread line far above the newest message must
  // not be marked read just because the first render had not scrolled yet.
  const [nearBottom, setNearBottom] = React.useState<boolean | null>(null);
  const onHistoryViewport = history.onViewport;
  const onViewport = React.useCallback(
    (first: string | null, metrics: Parameters<ConversationHistory["onViewport"]>[1]) => {
      onHistoryViewport(first, metrics);
      setTopId(first);
      setNearBottom(isAtBottom(metrics));
    },
    [onHistoryViewport],
  );

  const v = useMessageViewport({ rows, hasNewer: history.hasNewer, scroll: history.scroll, resetKey: conversationId, onViewport });

  // ---- the read mark and the arrival sound
  useReadMarking({ conversationId, messages: history.messages, atNewest: history.atNewest, atBottom: nearBottom === true, silent: header.me.oversight });
  const seen = React.useRef<{ id: string | null; hasNewer: boolean }>({ id: null, hasNewer: false });
  React.useEffect(() => {
    seen.current = { id: null, hasNewer: false };
  }, [conversationId, history.epoch]);
  React.useEffect(() => {
    if (!history.ready) return;
    const was = seen.current;
    const sound = arrivalSoundOf({ previousNewestId: was.id, messages: history.messages, meId: facts.meId, hadNewer: was.hasNewer, hasNewer: history.hasNewer });
    if (sound) playChatSound(sound);
    seen.current = { id: history.messages.at(-1)?.id ?? null, hasNewer: history.hasNewer };
  }, [history.messages, history.ready, history.epoch, history.hasNewer, facts.meId]);

  // ---- the jump buttons
  const [visited, setVisited] = React.useState<string[]>([]);
  const unreadMentions = row?.mentionsUnread ?? 0;
  const targets = React.useMemo(() => mentionTargetsOf(history.messages, facts.meId, unreadMentions), [history.messages, facts.meId, unreadMentions]);
  const { down } = jumpButtonsOf({ atBottom: v.atBottom, atNewest: history.atNewest, unread: row?.unread ?? 0, newBelow: v.newBelow });
  const mentions = mentionsButtonOf({ mentionsUnread: unreadMentions, targets, visited });

  // ---- what the rows share
  const outboxOn = header.chatOutbox !== false && header.me.canPost && !header.me.oversight;
  const { outbox } = useOutbox(header.me.id, outboxOn);
  const pending = React.useMemo<RowEnv["pending"]>(() => {
    const deps = outbox ? { qc, outbox } : null;
    return {
      retry: (item) => void (deps && retryPending(deps, conversationId, item.clientId)),
      discard: (item) => void (deps ? discardPending(deps, conversationId, item.clientId) : removePending(qc, conversationId, item.clientId)),
      copy: (item) => void navigator.clipboard?.writeText(item.body).then(() => commands.say("outbox.copied"), () => commands.say("outbox.copy_failed", "error")),
      edit: (item) => {
        commands.startRestore({ id: item.clientId, body: item.body, mentions: item.mentions });
        if (deps) discardPending(deps, conversationId, item.clientId);
        else removePending(qc, conversationId, item.clientId);
      },
    };
  }, [qc, outbox, conversationId, commands]);
  const mentionNames = React.useMemo(() => [...(people?.mentionables ?? people?.members ?? []).map((m) => m.name), MENTION_ALL_NAME], [people]);
  const readersByMessage = React.useMemo(() => {
    const map = new Map<string, ReaderDto[]>();
    for (const r of history.readers) map.set(r.messageId, [...(map.get(r.messageId) ?? []), r]);
    return map;
  }, [history.readers]);
  const menu = useMessageMenu(facts);
  const env = React.useMemo<RowEnv>(
    () => ({ conversationId, facts, messages: history.messages, mentionNames, readersByMessage, menu, pending }),
    [conversationId, facts, history.messages, mentionNames, readersByMessage, menu, pending],
  );

  const stickyLabel = topId && byId.get(topId) ? dayLabelOf(byId.get(topId)!.createdAt) : null;

  return (
    <div data-message-viewport className="relative flex min-h-0 flex-1 flex-col bg-surface-1">
      <div ref={v.scrollRef} role="log" aria-label={ct("chatc.log")} data-conversation-id={conversationId} onScroll={flashDate} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="relative w-full" style={{ height: v.totalSize }}>
          {v.items.map((item) => {
            const r = rows[item.index];
            if (!r) return null;
            return (
              <div key={item.key} data-index={item.index} ref={v.measureElement} className={`absolute inset-x-0 top-0 px-3 ${rowPadding(r, history.messages)}`} style={{ transform: `translateY(${item.start}px)` }}>
                <ViewportRow row={r} env={env} highlightId={history.highlightId} />
              </div>
            );
          })}
        </div>
      </div>
      <StickyDateChip label={stickyLabel} visible={scrolling} />
      <JumpButtons
        down={down}
        mentions={mentions}
        onDown={() => (history.atNewest ? v.scrollToBottom(true) : history.backToNewest())}
        onMention={() => {
          if (mentions.target) {
            setVisited((list) => [...list, mentions.target!]);
            commands.jumpTo(mentions.target);
          } else void history.backToNewest();
        }}
      />
      {!history.ready && !history.error ? (
        <p role="status" className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-sm text-fg-muted">
          {ct("chatc.loading")}
        </p>
      ) : null}
      {history.error ? (
        <div role="alert" className="absolute inset-x-0 top-1/2 flex flex-col items-center gap-2 text-center text-sm">
          <p className="text-danger">{ct("chatc.load_failed")}</p>
          <button type="button" onClick={history.retry} className="inline-flex min-h-11 items-center rounded-lg px-3 font-semibold text-accent hover:bg-surface-2">
            {ct("chatui.pane.retry")}
          </button>
        </div>
      ) : null}
      {history.ready && history.messages.length === 0 ? (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-sm text-fg-muted">{ct("chatc.empty")}</p>
      ) : null}
    </div>
  );
}
