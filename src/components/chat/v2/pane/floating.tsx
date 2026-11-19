"use client";

import React from "react";
import { ArrowDown, AtSign } from "lucide-react";
import { ct, ctCount } from "@/lib/chat/text";
import { MENTIONS_FORMS, counted } from "@/lib/chat/v2/pane/plural";
import { fetchUnreadMentionIds } from "@/lib/chat/history/jump";
import { mentionsButtonOf, pruneVisited, walkTargetsOf, type DownButton, type MentionsButton } from "@/lib/chat/v2/pane/jump-model";

/**
 * C2.4 — what floats over the viewport: the date of the top visible message (the sticky chip) and the two round buttons at the bottom END (the left, in
 * this right-to-left layout — also on the phone).
 */

/** The date of the top visible message, floating at the top; it shows while the person scrolls and fades after a moment (never under reduced motion: it just goes). */
export function StickyDateChip({ label, visible }: { label: string | null; visible: boolean }) {
  if (!label) return null;
  return (
    <div aria-hidden="true" data-sticky-date className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
      <span className={`rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-fg-muted shadow-sm transition-opacity duration-150 motion-reduce:transition-none ${visible ? "opacity-100" : "opacity-0"}`}>{label}</span>
    </div>
  );
}

const round = "relative inline-flex min-h-11 items-center justify-center gap-1 rounded-full border border-border bg-surface text-accent shadow-lg transition-transform hover:scale-105 motion-reduce:transition-none";

/**
 * C3b.6 — the «@» button's WALK. The unread messages that mention me come from the server (`GET …/mentions`, oldest first, asked when the row says there are
 * some and again when that number moves), so each press goes to the next one oldest to newest even when its message is not loaded (`jumpTo` loads the window
 * around it). While the list is not here (not asked yet, or the request failed) the loaded mentions `loaded` are the walk, as before. Asking never reads
 * anything: the read mark stays where it is, and for a reader in silent oversight the list is empty (the server writes nothing).
 *
 * Give the result to `JumpButtons`: `mentions` and `onMention`.
 */
export function useMentionsWalk({ conversationId, unread, loaded, jumpTo, toNewest }: {
  conversationId: string;
  /** the row's number of unread mentions (the server's, C1.2's rule: it is not changed by the walk) */
  unread: number;
  /** the loaded messages that mention me (the fallback walk) */
  loaded: readonly string[];
  jumpTo: (messageId: string) => void;
  toNewest: () => void | Promise<unknown>;
}): { mentions: MentionsButton; onMention: () => void } {
  // both are kept WITH the conversation they belong to: for the one render after a switch they are nobody's, never the previous conversation's
  const [listed, setListed] = React.useState<{ id: string; ids: string[] } | null>(null);
  const [seen, setSeen] = React.useState<{ id: string; ids: string[] }>({ id: conversationId, ids: [] });
  const ids = listed && listed.id === conversationId ? listed.ids : null;
  const visited = React.useMemo(() => (seen.id === conversationId ? seen.ids : []), [seen, conversationId]);
  const addVisited = React.useCallback((messageId: string) => setSeen((s) => ({ id: conversationId, ids: s.id === conversationId ? [...s.ids, messageId] : [messageId] })), [conversationId]);
  const live = React.useRef(conversationId);
  live.current = conversationId;

  React.useEffect(() => {
    if (unread <= 0) {
      setListed(null);
      setSeen({ id: conversationId, ids: [] });
      return;
    }
    const ctl = new AbortController();
    fetchUnreadMentionIds(conversationId, ctl.signal).then(
      (got) => {
        if (ctl.signal.aborted) return;
        setListed({ id: conversationId, ids: got });
        setSeen((s) => (s.id === conversationId ? { id: conversationId, ids: pruneVisited(s.ids, got) } : s));
      },
      () => undefined, // no list: the loaded mentions stay the walk
    );
    return () => ctl.abort();
  }, [conversationId, unread]);

  const mentions = mentionsButtonOf({ mentionsUnread: unread, targets: walkTargetsOf(ids, loaded), visited });
  const target = mentions.target;
  const onMention = React.useCallback(() => {
    if (target) {
      addVisited(target);
      jumpTo(target);
      return;
    }
    if (ids !== null) return void toNewest();
    // the list was not here yet: ask now, then go to its first one — unless the person has gone to another conversation meanwhile (the answer is not theirs any more)
    fetchUnreadMentionIds(conversationId).then(
      (got) => {
        if (live.current !== conversationId) return;
        setListed({ id: conversationId, ids: got });
        const first = got.find((id) => !visited.includes(id));
        if (!first) return void toNewest();
        addVisited(first);
        jumpTo(first);
      },
      () => {
        if (live.current === conversationId) void toNewest();
      },
    );
  }, [target, ids, visited, conversationId, jumpTo, toNewest, addVisited]);
  return { mentions, onMention };
}

/**
 * «↓» with the unread counter (the number of new messages), or «آخر الرسائل» when only the windows do not reach the newest one; «@» with the number of
 * unread mentions, going to the next one at each press. Nothing is drawn when there is nothing to go to.
 */
export function JumpButtons({ down, mentions, onDown, onMention }: { down: DownButton; mentions: MentionsButton; onDown: () => void; onMention: () => void }) {
  if (!down.show && !mentions.show) return null;
  return (
    <div data-jump-buttons className="absolute bottom-3 end-3 z-10 flex flex-col items-center gap-2">
      {mentions.show ? (
        <button type="button" data-jump-mentions aria-label={counted(MENTIONS_FORMS, mentions.count)} onClick={onMention} className={`${round} min-w-11 px-2`}>
          <AtSign aria-hidden="true" className="size-5" />
          <span className="rounded-full bg-accent px-1.5 text-xs font-bold text-accent-fg">{mentions.count}</span>
        </button>
      ) : null}
      {down.show ? (
        <button type="button" data-jump-down={down.kind} aria-label={down.kind === "unread" ? ctCount("chatc.new_below", down.count) : ct("chatui.pane.jump_newest")} onClick={onDown} className={`${round} px-3 text-sm font-semibold`}>
          <ArrowDown aria-hidden="true" className="size-5" />
          {down.kind === "unread" ? <span className="rounded-full bg-accent px-1.5 text-xs font-bold text-accent-fg">{down.count}</span> : <span>{ct("chatui.pane.jump_newest")}</span>}
        </button>
      ) : null}
    </div>
  );
}
