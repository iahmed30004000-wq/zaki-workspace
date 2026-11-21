"use client";

import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Quote } from "lucide-react";
import type { ConversationHeaderDto, ReaderDto } from "@/server/chat/dto";
import { JumpButtons, StickyDateChip, useMentionsWalk } from "@/components/chat/v2/pane/floating";
import { DateJumpSheet } from "@/components/chat/v2/pane/date-jump-sheet";
import { useBubbleGestures } from "@/components/chat/v2/menu/gesture-context";
import { usePaneCommands } from "@/components/chat/v2/pane/pane-actions";
import { useMessageMenu } from "@/components/chat/v2/pane/seams/menu-host";
import { CallsDialog } from "@/components/chat/v2/pane/service-rows";
import { ViewportRow, rowPadding, type RowEnv } from "@/components/chat/v2/pane/viewport-row";
import { discardPending, retryPending } from "@/lib/chat/outbox/optimistic";
import { removePending } from "@/lib/chat/cache/pending";
import { useChatRow } from "@/lib/chat/cache/selectors";
import { selectionStore, useMultiSelectSwitch, useSelection } from "@/lib/chat/selection";
import { dayLabelOf } from "@/lib/chat/day-separator";
import type { ConversationHistory } from "@/lib/chat/history/use-conversation-history";
import { isAtBottom } from "@/lib/chat/conversation/client";
import { MENTION_ALL_NAME } from "@/lib/chat/conversation/mentions";
import { useOutbox } from "@/lib/chat/outbox/use-outbox";
import { playChatSound } from "@/lib/chat/sounds";
import { runFlags } from "@/lib/chat/group";
import { ct } from "@/lib/chat/text";
import { menuFor } from "@/components/chat/message/message-menu-registry";
import { menuContextV2 } from "@/lib/chat/v2/menu/menu-context";
import { quoteFromSelection } from "@/lib/chat/v2/menu/gestures";
import { replyQuoteStore } from "@/lib/chat/v2/phone/reply-quote";
import type { BubbleFacts } from "@/lib/chat/v2/pane/bubble-facts";
import type { PaneMembers } from "@/lib/chat/v2/pane/composer-detail";
import { arrivalSoundOf } from "@/lib/chat/v2/pane/arrival-sound";
import { jumpButtonsOf, mentionTargetsOf } from "@/lib/chat/v2/pane/jump-model";
import { stableReaders } from "@/lib/chat/v2/pane/readers";
import { useReadMarking } from "@/lib/chat/v2/pane/use-read-marking";
import { useMessageViewport } from "@/lib/chat/viewport/use-message-viewport";
import { buildRows } from "@/lib/chat/viewport/rows";

/** How long the sticky date stays after the last scroll. */
const STICKY_DATE_MS = 1400;

/** What a selection must NOT be taken from: the quote block of another message, the footer, the sender's name (they are not the message's own words). */
const NOT_QUOTABLE = "[data-reply-block],[data-bubble-footer],[data-sender]";

/**
 * S5.7 (d) — «رد بالاقتباس». When the person selects words inside ONE message of the log, a small button shows over the selection; pressing it starts an ordinary reply to that
 * message (the same door a double click uses, so the registry still decides who may reply) and leaves the picked piece for the reply bar and the send (`replyQuoteStore`). The
 * browser's own selection (and its own menu) is untouched; the button only reads `selectionchange`, never writes to the page.
 */
function QuoteSelectionButton({ root, onQuote }: { root: React.RefObject<HTMLElement>; onQuote: (messageId: string, quote: string) => void }) {
  const [at, setAt] = React.useState<{ messageId: string; quote: string; x: number; y: number; width: number } | null>(null);
  React.useEffect(() => {
    const idOf = (node: Node | null): string | null => {
      const el = node instanceof Element ? node : (node?.parentElement ?? null);
      return el?.closest?.("[data-message-id]")?.getAttribute("data-message-id") ?? null;
    };
    const onChange = () => {
      const sel = document.getSelection();
      const box = root.current;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !box || !box.contains(sel.anchorNode) || !box.contains(sel.focusNode)) return setAt(null);
      const range = sel.getRangeAt(0);
      const common = range.commonAncestorContainer;
      const commonEl = common instanceof Element ? common : common.parentElement;
      if (commonEl?.closest(NOT_QUOTABLE)) return setAt(null);
      const picked = quoteFromSelection({ text: sel.toString(), anchorMessageId: idOf(sel.anchorNode), focusMessageId: idOf(sel.focusNode) });
      if (!picked) return setAt(null);
      const rect = range.getBoundingClientRect();
      const frame = box.getBoundingClientRect();
      setAt({ ...picked, x: rect.left + rect.width / 2 - frame.left, y: rect.top - frame.top, width: frame.width });
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [root]);
  if (!at) return null;
  return (
    <button
      type="button"
      data-quote-button=""
      // a press must not collapse the selection before the click lands
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onQuote(at.messageId, at.quote);
        document.getSelection()?.removeAllRanges();
        setAt(null);
      }}
      // the coordinates are the browser's own (from the left edge of the log), so the button is placed by `left`, not by a logical edge
      style={{ top: Math.max(at.y - 48, 4), left: Math.min(Math.max(at.x - 60, 4), Math.max(at.width - 150, 4)) }}
      className="absolute z-20 inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm font-semibold text-accent shadow-lg hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <Quote aria-hidden="true" className="size-4" />
      {ct("chatparity.quote.action")}
    </button>
  );
}

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
  const unreadMentions = row?.mentionsUnread ?? 0;
  const targets = React.useMemo(() => mentionTargetsOf(history.messages, facts.meId, unreadMentions), [history.messages, facts.meId, unreadMentions]);
  const { down } = jumpButtonsOf({ atBottom: v.atBottom, atNewest: history.atNewest, unread: row?.unread ?? 0, newBelow: v.newBelow });
  // C3b.6: the «@» walks the SERVER's list of unread mentions (oldest to newest, even the ones far above the loaded window); the loaded ones are the fallback
  const walk = useMentionsWalk({ conversationId, unread: unreadMentions, loaded: targets, jumpTo: commands.jumpTo, toNewest: history.backToNewest });

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
  // the same array for a message whose readers did not change: a read tick elsewhere does not draw every bubble that has readers again
  const readersRef = React.useRef<ReadonlyMap<string, ReaderDto[]>>(new Map());
  const readersByMessage = React.useMemo(() => {
    readersRef.current = stableReaders(readersRef.current, history.readers);
    return readersRef.current;
  }, [history.readers]);
  const menu = useMessageMenu(facts);
  // the run of calls whose list is open, named by its FIRST line: it survives a new line (the chip's key changes) and a row that unmounts
  const [openedCalls, setOpenedCalls] = React.useState<string | null>(null);
  const openCalls = React.useCallback((firstLineId: string) => setOpenedCalls(firstLineId), []);
  const callsOpen = openedCalls ? rows.find((r) => r.type === "calls" && r.messages[0]!.id === openedCalls) : undefined;
  // C3b.5 («حدّد»): the company's switch (from the header; never while the owner reads in silent oversight) is told to the store the menu and the header read, and while
  // messages are picked every row draws its check and a press toggles it. The bar itself is the header's.
  const selection = useSelection();
  const canSelect = useMultiSelectSwitch(header) && !header.me.oversight;
  React.useEffect(() => {
    selectionStore.attach(conversationId, canSelect);
    return () => selectionStore.detach(conversationId);
  }, [conversationId, canSelect]);
  const selecting = canSelect && selection.active && selection.conversationId === conversationId;
  const picked = React.useMemo(() => new Set(selection.ids), [selection.ids]);
  const toggleSelected = React.useCallback(
    (messageId: string) => {
      if (selectionStore.toggle(messageId) === "full") commands.say("chatsel.full", "error");
    },
    [commands],
  );
  const select = React.useMemo<RowEnv["select"]>(() => (selecting ? { on: true, selected: picked, toggle: toggleSelected } : undefined), [selecting, picked, toggleSelected]);
  const env = React.useMemo<RowEnv>(
    () => ({ conversationId, facts, mentionNames, readersByMessage, menu, pending, openCalls, ...(select ? { select } : {}) }),
    [conversationId, facts, mentionNames, readersByMessage, menu, pending, openCalls, select],
  );

  const stickyLabel = topId && byId.get(topId) ? dayLabelOf(byId.get(topId)!.createdAt) : null;

  // S5.7 (c): a tap on the floating date opens the calendar of the date jump, on the month the log is at
  const [dateOpen, setDateOpen] = React.useState(false);
  const topAt = topId && byId.get(topId) ? new Date(byId.get(topId)!.createdAt) : null;
  // S5.7 (d): «رد بالاقتباس» starts the reply through the bubble's own gesture door, then keeps the piece for the bar and the send
  const gestures = useBubbleGestures();
  const logRef = React.useRef<HTMLDivElement>(null);
  const quoteReply = React.useCallback(
    (messageId: string, quote: string) => {
      const message = byId.get(messageId);
      if (!message || !gestures || message.deleted) return;
      // only where the registry offers «رد» (the same rule the double click uses): a quote is never left behind for a reply that did not start
      if (!menuFor(menuContextV2(message, facts, { readerCount: 0, askKind: false })).some((item) => item.id === "reply")) return;
      gestures.reply(message, facts);
      replyQuoteStore.set(conversationId, messageId, quote);
    },
    [byId, gestures, facts, conversationId],
  );

  return (
    <div ref={logRef} data-message-viewport className="relative flex min-h-0 flex-1 flex-col bg-surface-1">
      <div ref={v.scrollRef} role="log" aria-label={ct("chatc.log")} data-conversation-id={conversationId} onScroll={flashDate} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="relative w-full" style={{ height: v.totalSize }}>
          {v.items.map((item) => {
            const r = rows[item.index];
            if (!r) return null;
            const flags = r.type === "message" ? runFlags(history.messages, r.index) : { start: true, end: true };
            return (
              <div key={item.key} data-index={item.index} ref={v.measureElement} className={`absolute inset-x-0 top-0 px-3 ${rowPadding(r, flags)}`} style={{ transform: `translateY(${item.start}px)` }}>
                <ViewportRow row={r} env={env} start={flags.start} end={flags.end} highlighted={r.type === "message" && history.highlightId === r.message.id} />
              </div>
            );
          })}
        </div>
      </div>
      <CallsDialog messages={callsOpen?.type === "calls" ? callsOpen.messages : null} onClose={() => setOpenedCalls(null)} />
      <StickyDateChip label={stickyLabel} visible={scrolling} onOpen={() => setDateOpen(true)} />
      <DateJumpSheet open={dateOpen} onOpenChange={setDateOpen} conversationId={conversationId} initial={topAt} onJump={commands.jumpTo} />
      {gestures && !header.me.oversight ? <QuoteSelectionButton root={logRef} onQuote={quoteReply} /> : null}
      <JumpButtons
        down={down}
        mentions={walk.mentions}
        onDown={() => (history.atNewest ? v.scrollToBottom(true) : history.backToNewest())}
        onMention={walk.onMention}
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
