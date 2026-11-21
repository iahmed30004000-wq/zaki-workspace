"use client";

import React from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import type { ConversationHeaderDto } from "@/server/chat/dto";
import { ConversationSearch } from "@/components/chat/conversation/conversation-search";
import { InfoJumpContext } from "@/components/chat/v2/info/info-jump";
import { useInfoSlot } from "@/components/chat/v2/info/info-slot";
import { MediaViewerProvider } from "@/components/chat/v2/media-viewer";
import { CallBar } from "@/components/chat/v2/pane/call-bar";
import { MessageViewport } from "@/components/chat/v2/pane/message-viewport";
import { PaneActionsProvider, usePaneActions, usePaneCommands } from "@/components/chat/v2/pane/pane-actions";
import { PaneHeader } from "@/components/chat/v2/pane/pane-header";
import { PinnedBar } from "@/components/chat/v2/pane/pinned-bar";
import { VoiceMiniPlayer } from "@/components/chat/v2/pane/voice-mini-player";
import { ComposerHost } from "@/components/chat/v2/pane/seams/composer-host";
import { InfoHost } from "@/components/chat/v2/pane/seams/info-host";
import { MenuHost } from "@/components/chat/v2/pane/seams/menu-host";
import { useOptionalToast } from "@/components/ui/toast";
import { chatKeys } from "@/lib/chat/cache/keys";
import { isPendingMessage } from "@/lib/chat/cache/pending";
import { isNotFound } from "@/lib/chat/cache/pages";
import { hideMessage } from "@/lib/chat/cache/writer";
import { useChatHeader, useChatRow } from "@/lib/chat/cache/selectors";
import { useConversationHistory, type ConversationHistory } from "@/lib/chat/history/use-conversation-history";
import { ct } from "@/lib/chat/text";
import { useIsWide } from "@/lib/chat/v2/info/use-wide";
import { bubbleFactsOf, sameFacts } from "@/lib/chat/v2/pane/bubble-facts";
import type { PaneMembers } from "@/lib/chat/v2/pane/composer-detail";
import { usePeople } from "@/lib/chat/v2/pane/use-people";
import { chatHref } from "@/lib/chat/v2/routes";
import { ParityActionsContext, type ParityActions } from "@/lib/chat/v2/phone/parity-actions";
import { replyQuoteStore } from "@/lib/chat/v2/phone/reply-quote";

export interface ConversationPaneProps {
  conversationId: string;
  /** `?m=` of the address: a search hit or a notification opens the conversation around this message */
  focusMessageId?: string;
  /** «نتفرّج سوا» is offered in the «⋮» menu: decided by the SERVER page (the switch, the person's box, never an external partner) */
  watch?: boolean;
}

const NO_MEMBERS: never[] = [];

/** The pane before the header is known: the same box, the same loading line. */
function PaneLoading() {
  return (
    <section dir="rtl" lang="ar" data-chat-pane-root data-pane-state="loading" className="relative flex h-full min-h-0 flex-col bg-surface" aria-label={ct("chatc.title_fallback")}>
      <div className="min-h-14 border-b border-border" />
      <p role="status" className="p-6 text-center text-sm text-fg-muted">
        {ct("chatc.loading")}
      </p>
    </section>
  );
}

/** A conversation the server will not open (gone, or never this person's) or could not be reached: a line and the way back or a retry. */
export function PaneUnavailable({ error, retry }: { error: unknown; retry: () => void }) {
  const gone = isNotFound(error);
  return (
    <section dir="rtl" lang="ar" data-chat-pane-root data-pane-state={gone ? "gone" : "error"} className="relative flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-surface p-6 text-center" aria-label={ct("chatc.title_fallback")}>
      <p role="alert" className="text-sm text-fg-muted">
        {ct(gone ? "chatui.pane.not_found" : "chatc.load_failed")}
      </p>
      {gone ? (
        <Link href={chatHref.list} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-accent hover:bg-surface-2">
          {ct("chatc.back")}
        </Link>
      ) : (
        <button type="button" onClick={retry} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-accent hover:bg-surface-2">
          {ct("chatui.pane.retry")}
        </button>
      )}
    </section>
  );
}

/**
 * The search under the header. C3d: it STAYS open while the person walks the hits (↑ older, ↓ newer, a click, the date jump are JUMPS: around the message, a 2 s
 * highlight), and it offers «من:» with the conversation's people. Esc and «سكّر» close it.
 */
function SearchPanel({ conversationId, people }: { conversationId: string; people: PaneMembers | null }) {
  const a = usePaneActions();
  const members = React.useMemo(() => (people?.members ?? NO_MEMBERS).filter((m) => m.role !== "AI").map((m) => ({ id: m.id, name: m.name })), [people]);
  if (!a.searchOpen) return null;
  return (
    <ConversationSearch
      conversationId={conversationId}
      onClose={a.closeSearch}
      enhanced
      people={members}
      onJump={a.jumpTo}
      onPick={(id) => {
        a.closeSearch();
        a.jumpTo(id);
      }}
    />
  );
}

/**
 * C3d — the info panel's «اعرض بالمحادثة»: scroll this conversation to a message. Where the panel COVERS the conversation (the tablet's sheet) it is closed first; the
 * docked column stays open beside it. The panel reads this through a context because two other files mount it (the host and the phone's screen).
 */
function InfoJumpProvider({ children }: { children: React.ReactNode }) {
  const commands = usePaneCommands();
  const wide = useIsWide();
  const slot = useInfoSlot();
  const docked = wide === true && slot !== null;
  const jump = React.useCallback(
    (messageId: string) => {
      if (!docked) commands.closeInfo();
      commands.jumpTo(messageId);
    },
    [commands, docked],
  );
  return <InfoJumpContext.Provider value={jump}>{children}</InfoJumpContext.Provider>;
}

/**
 * S5.7 — the pane's small extras beside its seam: «حذف عندي» (the doors, the cache write and the toast live here; the menu and the selection bar only call it) and the
 * housekeeping of the quote of «رد بالاقتباس» (a quote belongs to the reply being written: once that reply is another one or none, the quote goes).
 */
function ParityProvider({ conversationId, children }: { conversationId: string; children: React.ReactNode }) {
  const qc = useQueryClient();
  const toast = useOptionalToast();
  const live = React.useRef(toast);
  live.current = toast;
  const reply = usePaneActions().reply;
  React.useEffect(() => {
    replyQuoteStore.keepOnly(conversationId, reply?.id ?? null);
  }, [conversationId, reply]);
  const value = React.useMemo<ParityActions>(
    () => ({
      hide: async (messageIds) => {
        const ids = [...new Set(messageIds)].filter((id) => !isPendingMessage({ id }));
        if (ids.length === 0) return { ok: 0, total: 0 };
        let done: string[] = [];
        try {
          if (ids.length === 1) {
            const res = await fetch(`/api/chat/messages/${encodeURIComponent(ids[0]!)}/hide`, { method: "POST" });
            if (res.ok) done = ids;
          } else {
            const res = await fetch("/api/chat/messages/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, forMe: true }) });
            if (res.ok) done = ((await res.json()) as { results: { id: string; ok: boolean }[] }).results.filter((r) => r.ok).map((r) => r.id);
          }
        } catch {
          /* nothing went: said below */
        }
        for (const id of done) hideMessage(qc, conversationId, id);
        if (done.length) {
          // the row's last line and numbers are the server's: ask again
          void qc.invalidateQueries({ queryKey: chatKeys.list() });
          void qc.invalidateQueries({ queryKey: chatKeys.spaces() });
        }
        live.current?.toast(ct(done.length ? (ids.length > 1 ? "chatparity.hide.done_many" : "chatparity.hide.done") : "chatparity.hide.failed"), done.length ? "success" : "error");
        return { ok: done.length, total: ids.length };
      },
    }),
    [qc, conversationId],
  );
  return <ParityActionsContext.Provider value={value}>{children}</ParityActionsContext.Provider>;
}

function PaneBody({ header, history, people, watch }: { header: ConversationHeaderDto; history: ConversationHistory; people: PaneMembers | null; watch: boolean }) {
  // only the commands: a reply or an edit being started must not draw the whole pane again
  const commands = usePaneCommands();
  const row = useChatRow(header.id);
  // the header is a new object for a pin or a title; the facts a bubble reads rarely change with it, and the OLD object is kept while they do not
  const next = React.useMemo(() => bubbleFactsOf(header), [header]);
  const kept = React.useRef(next);
  const facts = sameFacts(kept.current, next) ? kept.current : next;
  kept.current = facts;
  return (
    <ParityProvider conversationId={header.id}>
      <MenuHost header={header} members={people?.members ?? NO_MEMBERS}>
        <section dir="rtl" lang="ar" data-chat-pane-root data-pane-state="ready" className="relative flex h-full min-h-0 flex-col bg-surface" aria-label={header.title}>
          <MediaViewerProvider messages={history.messages} conversationId={header.id} onShowInChat={commands.jumpTo}>
            <InfoJumpProvider>
              <PaneHeader header={header} people={people} watch={watch} system={row?.system === true} />
              <VoiceMiniPlayer conversationId={header.id} messages={history.messages} onJump={commands.jumpTo} />
              <PinnedBar pins={header.pinnedMessages ?? []} onJump={commands.jumpTo} />
              <CallBar conversationId={header.id} enabled={header.calls !== false} />
              <SearchPanel conversationId={header.id} people={people} />
              {header.me.oversight ? <p className="border-b border-border p-2 text-center text-sm">{ct("chatc.oversight_banner")}</p> : null}
              {header.space?.hasExternal ? <p className="p-2 text-sm">{ct("chatc.external")}</p> : null}
              <MessageViewport header={header} history={history} facts={facts} people={people} />
              <ComposerHost header={header} people={people} onSent={() => !history.atNewest && void history.backToNewest()} />
              <InfoHost header={header} />
            </InfoJumpProvider>
          </MediaViewerProvider>
        </section>
      </MenuHost>
    </ParityProvider>
  );
}

/**
 * C2.4 — THE CONVERSATION PANE (`chatLayoutV2` ON): `/chat/[id]` draws this beside the list column of C2.1. It reads only the C1 cache through its hooks —
 * `useChatHeader`, `useConversationHistory` (which brings the messages, the unread landing, the paging and the jump) and the viewport hook — and adds no door
 * of the server's. The header, the history and the people are asked for AT ONCE (the messages do not wait for the header), and a conversation the cache
 * already holds paints from it.
 *
 *   <section data-chat-pane-root class="relative">            the root: `relative`, so C2.5 can lay a drop overlay over it
 *     PaneHeader · VoiceMiniPlayer (C3b.4: only while a voice note plays and its bubble is out of sight) · PinnedBar · CallBar · search · banners
 *     MessageViewport                                          the virtual log, sticky date, jump buttons
 *     ComposerHost                                             a DIRECT child of the root (seam 2: C2.5's file afterwards)
 *     InfoHost                                                 nothing yet (seam 4: C2.7's file afterwards)
 *   </section>                                                 MenuHost around it (seam 3: C2.6's file afterwards)
 *
 * Everything the later packages need to do to the open conversation is in `pane-actions.tsx` (seam 1).
 */
export function ConversationPane({ conversationId, focusMessageId, watch = false }: ConversationPaneProps) {
  const headerQuery = useChatHeader(conversationId);
  const history = useConversationHistory(conversationId, { around: focusMessageId ?? null });
  const people = usePeople(conversationId, headerQuery.data?.memberCount);
  const header = headerQuery.data;
  return (
    // one provider per conversation: reply, edit, forward, search and the info panel of the last conversation are never this one's
    <PaneActionsProvider key={conversationId} conversationId={conversationId} jumpTo={history.jumpTo} toNewest={history.backToNewest}>
      {header ? (
        <PaneBody header={header} history={history} people={people} watch={watch} />
      ) : headerQuery.isError ? (
        <PaneUnavailable error={headerQuery.error} retry={() => void headerQuery.refetch()} />
      ) : (
        <PaneLoading />
      )}
    </PaneActionsProvider>
  );
}
