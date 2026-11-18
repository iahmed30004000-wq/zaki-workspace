"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { reachesNewest } from "@/lib/chat/cache/pages";
import { useChatMessages, useChatRow } from "@/lib/chat/cache/selectors";
import { trimMessages } from "@/lib/chat/cache/trim";
import { nextLoad, type ScrollMetrics } from "@/lib/chat/history/edges";
import { backToNewest, jumpToMessage, JumpSignals, type JumpOutcome } from "@/lib/chat/history/jump";
import { separatorBefore, type Landing } from "@/lib/chat/history/landing";
import { resolveOpening } from "@/lib/chat/history/open";
import type { MessagesData } from "@/lib/chat/cache/types";
import { chatKeys } from "@/lib/chat/cache/keys";

/**
 * C1.6 — what the C2 screen reads to show a conversation's history: the messages, where it opened, paging in both directions from
 * the scroll, the jump to a message, the way back to the newest, and the ten-window cap. One hook per open conversation; it draws
 * nothing and styles nothing (the bubbles, the «رسائل غير مقروءة» line and the «↓ آخر الرسائل» button are C2.4's).
 *
 * The screen feeds it from the scroll: `onViewport(firstVisibleMessageId, metrics)` (the viewport hook of C1.7 does it).
 * It answers with signals: `scroll` (scroll to this message, or to the newest), `highlightId` (two seconds after a jump), `epoch`
 * (the windows were replaced as a whole: forget what was «the newest message» before).
 */

export interface ConversationHistory {
  /** the opening is settled: the messages below are the window to draw, and the screen may land */
  ready: boolean;
  error: Error | null;
  retry: () => void;
  messages: ReturnType<typeof useChatMessages>["messages"];
  hasOlder: boolean;
  hasNewer: boolean;
  /** the windows reach the newest message (so «↓ آخر الرسائل» is not shown) */
  atNewest: boolean;
  readers: ReturnType<typeof useChatMessages>["readers"];
  isFetchingOlder: boolean;
  isFetchingNewer: boolean;
  /** where the conversation opened */
  landing: Landing | null;
  /** the «رسائل غير مقروءة» line goes right above this message (only when it opened on the first unread message) */
  unreadSeparatorBeforeId: string | null;
  /** «scroll here» (a new `token` each time) and «highlight this message» (two seconds) */
  scroll: ReturnType<JumpSignals["getState"]>["scroll"];
  highlightId: string | null;
  /** counts every time the windows were replaced as a whole (opening, a jump to a far message, «آخر الرسائل») */
  epoch: number;
  jumpTo: (messageId: string) => Promise<JumpOutcome>;
  backToNewest: () => Promise<void>;
  onViewport: (firstVisibleMessageId: string | null, metrics: ScrollMetrics) => void;
  fetchOlder: () => Promise<void>;
  fetchNewer: () => Promise<void>;
}

export function useConversationHistory(conversationId: string | null, opts: { around?: string | null } = {}): ConversationHistory {
  const qc = useQueryClient();
  const around = opts.around ?? null;
  const row = useChatRow(conversationId);
  // the row's number at the moment the conversation is opened is what counts; later reads must not reopen it
  const unreadHint = useRef<number | null>(null);
  unreadHint.current = row ? row.unread : null;

  // one set of signals for the hook's life; the opening effect resets it whenever the conversation changes or closes
  const [signals] = useState(() => new JumpSignals());
  const jump = useSyncExternalStore(signals.subscribe, signals.getState, signals.getState);

  const [opened, setOpened] = useState<{ id: string; landing: Landing } | null>(null);
  const [failed, setFailed] = useState<{ id: string; error: Error } | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [attempt, setAttempt] = useState(0);

  const activeId = useRef<string | null>(conversationId);
  activeId.current = conversationId;
  const readyRef = useRef(false);
  // every run that replaces the windows (opening, a jump, the way back) takes the next number; only the latest may write
  const runs = useRef(0);
  const openedAround = useRef<string | null>(null);
  const view = useRef<{ firstVisible: string | null; hasOlder: boolean; hasNewer: boolean; fetchingOlder: boolean; fetchingNewer: boolean }>({ firstVisible: null, hasOlder: false, hasNewer: false, fetchingOlder: false, fetchingNewer: false });
  const asking = useRef({ older: false, newer: false });

  useEffect(() => {
    // a conversation that was opened before is opened again from the start (what `opened` says about it is old), and nothing the
    // screen reported about the last one is about this one
    setOpened((o) => (o && o.id !== conversationId ? null : o));
    view.current.firstVisible = null;
    asking.current = { older: false, newer: false };
    if (!conversationId) return;
    let alive = true;
    const id = conversationId;
    const run = ++runs.current;
    const current = () => alive && runs.current === run && activeId.current === id;
    openedAround.current = around;
    resolveOpening(qc, id, { unreadHint: unreadHint.current, messageId: around, current }).then(
      (landing) => {
        if (!landing || !current()) return;
        setFailed(null);
        setOpened({ id, landing });
        setEpoch((n) => n + 1);
        if (landing.kind === "newest") signals.scrollToNewest();
        else signals.scrollToMessage(landing.messageId, landing.kind === "unread" ? "start" : "center", { highlight: landing.kind === "message" });
      },
      (e: unknown) => {
        if (current()) setFailed({ id, error: e instanceof Error ? e : new Error(String(e)) });
      },
    );
    return () => {
      alive = false;
      signals.reset();
    };
    // `around` is read when the conversation is opened; a later change of it is a jump (below), never a reopening
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, conversationId, attempt, signals]);

  const ready = !!conversationId && opened?.id === conversationId;
  readyRef.current = ready;
  // the messages query is only mounted once the opening has put its window in the cache: nothing is asked for twice
  const m = useChatMessages(ready ? conversationId : null);
  const atNewest = ready && !m.hasNewer;

  view.current.hasOlder = m.hasOlder;
  view.current.hasNewer = m.hasNewer;
  view.current.fetchingOlder = m.isFetchingOlder;
  view.current.fetchingNewer = m.isFetchingNewer;
  const fetchers = useRef({ older: m.fetchOlder, newer: m.fetchNewer });
  fetchers.current = { older: m.fetchOlder, newer: m.fetchNewer };

  const onViewport = useCallback(
    (firstVisibleMessageId: string | null, metrics: ScrollMetrics) => {
      view.current.firstVisible = firstVisibleMessageId;
      // the window the screen is on is known now: windows beyond the cap are cut around it (nothing happens when there is nothing to cut)
      if (activeId.current && firstVisibleMessageId) trimMessages(qc, activeId.current, firstVisibleMessageId);
      const load = nextLoad(metrics, { hasOlder: view.current.hasOlder, hasNewer: view.current.hasNewer, fetchingOlder: view.current.fetchingOlder, fetchingNewer: view.current.fetchingNewer });
      // one request per direction: a scroll event fires many times before the first answer comes, and asking again would cancel it
      const mine = asking.current; // the flags of THIS conversation: a request that settles after a switch must not clear the next one's
      if (load === "older" && !mine.older) {
        mine.older = true;
        void fetchers.current.older().finally(() => (mine.older = false));
      } else if (load === "newer" && !mine.newer) {
        mine.newer = true;
        void fetchers.current.newer().finally(() => (mine.newer = false));
      }
    },
    [qc],
  );

  // the ten-window cap: whenever the windows changed and nothing is in the air, the windows far from the screen go
  useEffect(() => {
    if (!ready || !conversationId || m.isFetching) return;
    trimMessages(qc, conversationId, view.current.firstVisible);
  }, [qc, ready, conversationId, m.messages, m.isFetching]);

  const jumpTo = useCallback(
    async (messageId: string): Promise<JumpOutcome> => {
      // before the opening has settled there is no window to jump in (and a jump must not overtake the opening: it would never finish)
      if (!conversationId || !readyRef.current) return "stale";
      const run = ++runs.current;
      const current = () => runs.current === run && activeId.current === conversationId;
      const outcome = await jumpToMessage(qc, conversationId, messageId, current);
      // overtaken (another conversation, another jump) while the window was on its way: it wrote nothing and says nothing
      if (outcome === "stale" || !current()) return "stale";
      if (outcome === "loaded") setEpoch((n) => n + 1);
      if (outcome !== "missing") signals.scrollToMessage(messageId, "center");
      return outcome;
    },
    [qc, conversationId, signals],
  );

  // a new `?m=` on the conversation that is open is a jump (the opening above only reads it when the conversation is opened); the
  // link losing its `?m=` after the landing changes nothing
  useEffect(() => {
    if (!around) {
      openedAround.current = null;
      return;
    }
    if (!ready || around === openedAround.current) return;
    openedAround.current = around;
    jumpTo(around).catch(() => {
      openedAround.current = null; // a network fault: the same link is tried again at the next change
    });
  }, [ready, around, jumpTo]);

  const goNewest = useCallback(async () => {
    if (!conversationId || !readyRef.current) return;
    const run = ++runs.current;
    const current = () => runs.current === run && activeId.current === conversationId;
    if (!reachesNewest(qc.getQueryData<MessagesData>(chatKeys.messages(conversationId)))) {
      if (!(await backToNewest(qc, conversationId, current)) || !current()) return;
      setEpoch((n) => n + 1);
    }
    signals.scrollToNewest();
  }, [qc, conversationId, signals]);

  const retry = useCallback(() => {
    setFailed(null);
    setAttempt((n) => n + 1);
  }, []);

  const landing = ready ? (opened?.landing ?? null) : null;
  return {
    ready,
    error: failed && failed.id === conversationId ? failed.error : null,
    retry,
    messages: m.messages,
    hasOlder: m.hasOlder,
    hasNewer: m.hasNewer,
    atNewest,
    readers: m.readers,
    isFetchingOlder: m.isFetchingOlder,
    isFetchingNewer: m.isFetchingNewer,
    landing,
    unreadSeparatorBeforeId: separatorBefore(landing),
    scroll: jump.scroll,
    highlightId: jump.highlightId,
    epoch,
    jumpTo,
    backToNewest: goNewest,
    onViewport,
    fetchOlder: m.fetchOlder,
    fetchNewer: m.fetchNewer,
  };
}
