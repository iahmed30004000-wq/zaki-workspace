"use client";

import React from "react";
import Link from "next/link";
import type { ConversationHeaderDto } from "@/server/chat/dto";
import { ConversationSearch } from "@/components/chat/conversation/conversation-search";
import { CallBar } from "@/components/chat/v2/pane/call-bar";
import { MessageViewport } from "@/components/chat/v2/pane/message-viewport";
import { PaneActionsProvider, usePaneActions, usePaneCommands } from "@/components/chat/v2/pane/pane-actions";
import { PaneHeader } from "@/components/chat/v2/pane/pane-header";
import { PinnedBar } from "@/components/chat/v2/pane/pinned-bar";
import { ComposerHost } from "@/components/chat/v2/pane/seams/composer-host";
import { InfoHost } from "@/components/chat/v2/pane/seams/info-host";
import { MenuHost } from "@/components/chat/v2/pane/seams/menu-host";
import { isNotFound } from "@/lib/chat/cache/pages";
import { useChatHeader, useChatRow } from "@/lib/chat/cache/selectors";
import { useConversationHistory, type ConversationHistory } from "@/lib/chat/history/use-conversation-history";
import { ct } from "@/lib/chat/text";
import { bubbleFactsOf } from "@/lib/chat/v2/pane/bubble-facts";
import type { PaneMembers } from "@/lib/chat/v2/pane/composer-detail";
import { usePeople } from "@/lib/chat/v2/pane/use-people";
import { chatHref } from "@/lib/chat/v2/routes";

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

/** The search under the header: a hit is a JUMP (around the message, a 2 s highlight), and the panel closes. */
function SearchPanel({ conversationId }: { conversationId: string }) {
  const a = usePaneActions();
  if (!a.searchOpen) return null;
  return (
    <ConversationSearch
      conversationId={conversationId}
      onClose={a.closeSearch}
      onPick={(id) => {
        a.closeSearch();
        a.jumpTo(id);
      }}
    />
  );
}

function PaneBody({ header, history, people, watch }: { header: ConversationHeaderDto; history: ConversationHistory; people: PaneMembers | null; watch: boolean }) {
  // only the commands: a reply or an edit being started must not draw the whole pane again
  const commands = usePaneCommands();
  const row = useChatRow(header.id);
  const facts = React.useMemo(() => bubbleFactsOf(header), [header]);
  return (
    <MenuHost header={header} members={people?.members ?? NO_MEMBERS}>
      <section dir="rtl" lang="ar" data-chat-pane-root data-pane-state="ready" className="relative flex h-full min-h-0 flex-col bg-surface" aria-label={header.title}>
        <PaneHeader header={header} people={people} watch={watch} system={row?.system === true} />
        <PinnedBar pins={header.pinnedMessages ?? []} onJump={commands.jumpTo} />
        <CallBar conversationId={header.id} enabled={header.calls !== false} />
        <SearchPanel conversationId={header.id} />
        {header.me.oversight ? <p className="border-b border-border p-2 text-center text-sm">{ct("chatc.oversight_banner")}</p> : null}
        {header.space?.hasExternal ? <p className="p-2 text-sm">{ct("chatc.external")}</p> : null}
        <MessageViewport header={header} history={history} facts={facts} people={people} />
        <ComposerHost header={header} people={people} onSent={() => !history.atNewest && void history.backToNewest()} />
        <InfoHost header={header} />
      </section>
    </MenuHost>
  );
}

/**
 * C2.4 — THE CONVERSATION PANE (`chatLayoutV2` ON): `/chat/[id]` draws this beside the list column of C2.1. It reads only the C1 cache through its hooks —
 * `useChatHeader`, `useConversationHistory` (which brings the messages, the unread landing, the paging and the jump) and the viewport hook — and adds no door
 * of the server's. The header, the history and the people are asked for AT ONCE (the messages do not wait for the header), and a conversation the cache
 * already holds paints from it.
 *
 *   <section data-chat-pane-root class="relative">            the root: `relative`, so C2.5 can lay a drop overlay over it
 *     PaneHeader · PinnedBar · CallBar · search · banners
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
