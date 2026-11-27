"use client";

import React from "react";
import { Search } from "lucide-react";
import type { MessageDto } from "@/server/chat/dto";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useOptionalToast } from "@/components/ui/toast";
import { CrossQuote } from "@/components/chat/v2/bubble/cross-quote";
import { TargetRow } from "@/components/chat/v2/forward/target-row";
import { useForwardTargets, type ForwardTargetsState } from "@/components/chat/v2/forward/use-forward-targets";
import { useOpenChat } from "@/components/chat/v2/forward/use-open-chat";
import { crossSnapshotOf, type CrossSnapshot } from "@/lib/chat/cross-reply";
import { crossReplyStore } from "@/lib/chat/cross-reply-store";
import { groupBySpace, matchesTarget, savedRowFor, SAVED_NEW_ID, visibleTargets, type ForwardTargetDto } from "@/lib/chat/forward";
import { openSavedId } from "@/lib/chat/v2/menu/menu-context";
import { ct } from "@/lib/chat/text";

/**
 * «الرد في محادثة أخرى» — where to answer: the forward sheet's own list (the same door, `GET /api/chat/forward-targets`, the same rows), ONE tap picks. Above the list
 * stands EXACTLY what the people there will read (built by the function the server uses) with the warning. The pick only opens that conversation with the quote waiting in
 * its composer: nothing is sent until the person writes and presses send, and the server decides then (do I read the source, may I post there).
 */
export function ReplyElsewhereSheetView({ open, snapshot, from, state, query, onQuery, onPick, onRetry, onClose, portal = true }: { open: boolean; snapshot: CrossSnapshot; from: string; state: ForwardTargetsState; query: string; onQuery: (text: string) => void; onPick: (id: string) => void; onRetry: () => void; onClose: () => void; portal?: boolean }) {
  const ready = state.status === "ready" ? state.data : null;
  const saved = ready ? savedRowFor(ready, ct("chatfwd.saved"), from) : null;
  const savedShown = saved && matchesTarget({ title: ct("chatfwd.saved"), spaceName: null }, query);
  const visible = ready ? visibleTargets(ready.targets, query, from) : [];
  const groups = groupBySpace(visible);
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent portal={portal} aria-describedby={undefined} data-reply-elsewhere="">
        <SheetHeader>
          <SheetTitle>{ct("tgx.cross.pick_title")}</SheetTitle>
        </SheetHeader>
        <div className="shrink-0 space-y-2 px-5 pb-2">
          <CrossQuote authorName={snapshot.author} text={snapshot.text} kind={snapshot.kind} />
          <p data-cross-warning="" className="text-xs text-warn">
            {ct("tgx.cross.warn")}
          </p>
          <p className="text-xs text-fg-muted">{ct("tgx.cross.fix")}</p>
          <label className="relative block">
            <span className="sr-only">{ct("chatfwd.search_label")}</span>
            <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
            <input type="search" value={query} onChange={(e) => onQuery(e.currentTarget.value)} placeholder={ct("chatfwd.search")} className="h-11 w-full rounded-lg border border-muted bg-surface ps-9 pe-3 text-base placeholder:text-muted focus:border-accent/60 md:h-9 md:text-sm" />
          </label>
        </div>
        <SheetBody className="min-h-40">
          {state.status === "loading" ? (
            <p role="status" className="py-6 text-center text-sm text-fg-muted">
              {ct("chatfwd.loading")}
            </p>
          ) : state.status === "error" ? (
            <div role="alert" className="flex flex-col items-center gap-3 py-6 text-center text-sm">
              <p>{ct("chatfwd.load_failed")}</p>
              <Button type="button" variant="secondary" onClick={onRetry}>
                {ct("chatfwd.retry")}
              </Button>
            </div>
          ) : !savedShown && visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">{ct(query.trim() ? "chatfwd.none" : "chatfwd.empty")}</p>
          ) : (
            <>
              {savedShown && saved ? (
                <ul className="mb-1">
                  <TargetRow target={saved} picked={false} disabled={false} onToggle={onPick} />
                </ul>
              ) : null}
              {groups.map((g) => (
                <section key={g.spaceId ?? "private"} data-forward-group={g.spaceId ?? "private"}>
                  <h3 className="px-2 pb-1 pt-3 text-xs font-semibold text-fg-muted">{g.spaceName ?? ct("chatfwd.private")}</h3>
                  <ul>
                    {g.items.map((t: ForwardTargetDto) => (
                      <TargetRow key={t.id} target={t} picked={false} disabled={false} onToggle={onPick} />
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

export function ReplyElsewhereSheet({ message, from, onClose }: { message: MessageDto; from: string; onClose: () => void }) {
  const { state, reload } = useForwardTargets(true);
  const [query, setQuery] = React.useState("");
  const openChat = useOpenChat();
  const toast = useOptionalToast();
  const busy = React.useRef(false);
  const snapshot = React.useMemo(() => crossSnapshotOf({ kind: message.kind, body: message.body, authorName: message.authorName, attachments: message.attachments }), [message]);
  const pick = async (picked: string) => {
    if (busy.current) return;
    busy.current = true;
    const target = picked === SAVED_NEW_ID ? await openSavedId() : picked;
    busy.current = false;
    if (!target) {
      toast?.toast(ct("chatfwd.saved_failed"), "error");
      return;
    }
    crossReplyStore.set(target, { messageId: message.id, snapshot });
    onClose();
    openChat(target);
  };
  return <ReplyElsewhereSheetView open snapshot={snapshot} from={from} state={state} query={query} onQuery={setQuery} onPick={(id) => void pick(id)} onRetry={reload} onClose={onClose} />;
}
