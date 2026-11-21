"use client";

import React from "react";
import { Search } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { RecentChip, TargetRow } from "@/components/chat/v2/forward/target-row";
import { useForwardTargets, type ForwardTargetsState } from "@/components/chat/v2/forward/use-forward-targets";
import { useForwardSend } from "@/components/chat/v2/forward/use-forward-send";
import {
  FORWARD_COMMENT_MAX,
  FORWARD_MAX_TARGETS,
  groupBySpace,
  matchesTarget,
  recentTargets,
  savedRowFor,
  savedTarget,
  togglePick,
  visibleTargets,
  type ForwardOutcome,
  type ForwardTargetDto,
} from "@/lib/chat/forward";
import { ct, ctCount } from "@/lib/chat/text";

/**
 * S5.2 — THE ONE forward sheet, Telegram's share sheet: a search box, «الرسائل المحفوظة» on top, the recent conversations as a strip of pictures, then every place the person may
 * write in — in every space they are in, grouped by space, and their private chats — each with its picture; up to ten picked; an optional comment that is sent with the forward;
 * «بدون اسم المرسل الأصلي»; ONE «إرسال». A bottom sheet on a phone, a side panel on a computer. The single «حوّل» of a message and «حدّد» then «حوّل» both open THIS (the
 * second through `ForwardManyDialog`). The list is the server's hint; the send is decided again by the server, target by target.
 */
export interface ForwardSheetViewProps {
  open: boolean;
  onClose: () => void;
  /** how many messages go */
  count: number;
  /** how many of the picked messages are left out (polls) */
  skipped?: number;
  /** the conversation the messages are in: never offered */
  from: string | null;
  state: ForwardTargetsState;
  onRetry: () => void;
  query: string;
  onQuery: (text: string) => void;
  picked: readonly string[];
  onToggle: (id: string) => void;
  hideAuthor: boolean;
  onHideAuthor: (on: boolean) => void;
  comment: string;
  onComment: (text: string) => void;
  busy: boolean;
  onSend: () => void;
  /** draw in place instead of on <body> (server-render tests) */
  portal?: boolean;
}

export function ForwardSheetView(p: ForwardSheetViewProps) {
  const ready = p.state.status === "ready" ? p.state.data : null;
  const full = p.picked.length >= FORWARD_MAX_TARGETS;
  const searching = p.query.trim().length > 0;
  const saved = ready ? savedRowFor(ready, ct("chatfwd.saved"), p.from) : null;
  const savedShown = saved && matchesTarget({ title: ct("chatfwd.saved"), spaceName: null }, p.query);
  const visible = ready ? visibleTargets(ready.targets, p.query, p.from) : [];
  const recents = ready && !searching ? recentTargets(ready, p.from) : [];
  const groups = groupBySpace(visible);
  const nothing = ready !== null && !savedShown && visible.length === 0;
  return (
    <Sheet open={p.open} onOpenChange={(next) => !next && p.onClose()}>
      <SheetContent portal={p.portal ?? true} aria-describedby={undefined} data-forward-sheet="">
        <SheetHeader>
          <SheetTitle>{ctCount("chatfwd.title", Math.max(p.count, 1))}</SheetTitle>
          {p.skipped && p.skipped > 0 ? <SheetDescription className="text-warn">{ct("chatfwd.skipped")}</SheetDescription> : null}
        </SheetHeader>
        <div className="shrink-0 px-5 pb-2">
          <label className="relative block">
            <span className="sr-only">{ct("chatfwd.search_label")}</span>
            <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
            <input
              type="search"
              data-forward-search=""
              value={p.query}
              onChange={(e) => p.onQuery(e.currentTarget.value)}
              placeholder={ct("chatfwd.search")}
              className="h-11 w-full rounded-lg border border-muted bg-surface ps-9 pe-3 text-base placeholder:text-muted focus:border-accent/60 md:h-9 md:text-sm"
            />
          </label>
        </div>
        <SheetBody className="min-h-40">
          {p.state.status === "loading" ? (
            <p role="status" className="py-6 text-center text-sm text-fg-muted">
              {ct("chatfwd.loading")}
            </p>
          ) : p.state.status === "error" ? (
            <div role="alert" className="flex flex-col items-center gap-3 py-6 text-center text-sm">
              <p>{ct("chatfwd.load_failed")}</p>
              <Button type="button" variant="secondary" onClick={p.onRetry}>
                {ct("chatfwd.retry")}
              </Button>
            </div>
          ) : ready && ready.targets.length === 0 && !saved ? (
            <p className="py-6 text-center text-sm text-fg-muted">{ct("chatfwd.empty")}</p>
          ) : (
            <>
              {savedShown && saved ? (
                <ul className="mb-1">
                  <TargetRow target={saved} picked={p.picked.includes(saved.id)} disabled={full} onToggle={p.onToggle} />
                </ul>
              ) : null}
              {recents.length > 0 ? (
                <section aria-label={ct("chatfwd.recents")} className="mb-2">
                  <h3 className="px-2 pb-1 pt-2 text-xs font-semibold text-fg-muted">{ct("chatfwd.recents")}</h3>
                  <div data-forward-recents="" className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none]">
                    {recents.map((t) => (
                      <RecentChip key={t.id} target={t} picked={p.picked.includes(t.id)} disabled={full} onToggle={p.onToggle} />
                    ))}
                  </div>
                </section>
              ) : null}
              {nothing ? <p className="py-6 text-center text-sm text-fg-muted">{ct("chatfwd.none")}</p> : null}
              {groups.map((g) => (
                <section key={g.spaceId ?? "private"} data-forward-group={g.spaceId ?? "private"}>
                  <h3 className="px-2 pb-1 pt-3 text-xs font-semibold text-fg-muted">{g.spaceName ?? ct("chatfwd.private")}</h3>
                  <ul>
                    {g.items.map((t: ForwardTargetDto) => (
                      <TargetRow key={t.id} target={t} picked={p.picked.includes(t.id)} disabled={full} onToggle={p.onToggle} />
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </SheetBody>
        <SheetFooter className="flex-col items-stretch gap-2">
          {p.picked.length > 0 ? (
            <>
              <input
                type="text"
                data-forward-comment=""
                value={p.comment}
                maxLength={FORWARD_COMMENT_MAX}
                onChange={(e) => p.onComment(e.currentTarget.value)}
                aria-label={ct("chatfwd.comment")}
                placeholder={ct("chatfwd.comment_placeholder")}
                className="h-11 w-full rounded-lg border border-muted bg-surface px-3 text-base placeholder:text-muted focus:border-accent/60 md:h-9 md:text-sm"
              />
              <div className="flex min-h-11 items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-sm">{ct("chatfwd.hide_author")}</span>
                  <span className="block text-xs text-fg-muted">{ct("chatfwd.hide_author_hint")}</span>
                </span>
                <Switch checked={p.hideAuthor} onChange={p.onHideAuthor} label={ct("chatfwd.hide_author")} />
              </div>
            </>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <span role="status" className="min-w-0 truncate text-sm text-fg-muted">
              {p.picked.length === 0 ? ct("chatfwd.pick") : full ? ct("chatfwd.max") : ctCount("chatfwd.count", p.picked.length)}
            </span>
            <Button type="button" data-forward-send="" disabled={p.busy || p.picked.length === 0 || p.count === 0} onClick={p.onSend}>
              {p.busy ? ct("chatfwd.sending") : ct("chatfwd.send")}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export interface ForwardSheetProps {
  open: boolean;
  /** the conversation the messages are in (never offered as a place to go) */
  from: string | null;
  /** the messages that go, in the conversation's order */
  messageIds: readonly string[];
  /** polls left out of the selection (said above the list) */
  skipped?: number;
  /** another sender is working (the multi-select bar's own busy flag) */
  busy?: boolean;
  onClose: () => void;
  /** at least one target got its copies (the sheet then closes itself) */
  onSent?: (outcome: ForwardOutcome) => void;
}

/** The sheet with its work: the list from the server, the pick, the comment, the send and the toast. */
export function ForwardSheet({ open, from, messageIds, skipped = 0, busy = false, onClose, onSent }: ForwardSheetProps) {
  const { state, reload } = useForwardTargets(open);
  const { send, sending } = useForwardSend();
  const [query, setQuery] = React.useState("");
  const [picked, setPicked] = React.useState<string[]>([]);
  const [hideAuthor, setHideAuthor] = React.useState(false);
  const [comment, setComment] = React.useState("");
  React.useEffect(() => {
    if (!open) return;
    setQuery("");
    setPicked([]);
    setHideAuthor(false);
    setComment("");
  }, [open]);

  const names = React.useMemo(() => {
    const out: Record<string, string> = {};
    if (state.status === "ready") {
      for (const t of state.data.targets) out[t.id] = t.title;
      const saved = savedTarget(state.data, ct("chatfwd.saved"));
      if (saved) out[saved.id] = saved.title;
    }
    return out;
  }, [state]);

  const submit = async () => {
    if (picked.length === 0 || messageIds.length === 0) return;
    const outcome = await send({ messageIds, picked, names, withoutAuthor: hideAuthor, comment });
    if (outcome.state === "none") return;
    // a partial answer keeps the sheet open on the targets that failed: a retry never copies twice into the ones that worked (and the messages stay selected)
    if (outcome.state === "some") {
      setPicked(outcome.remaining);
      return;
    }
    onSent?.(outcome);
    onClose();
  };

  return (
    <ForwardSheetView
      open={open}
      onClose={onClose}
      count={messageIds.length}
      skipped={skipped}
      from={from}
      state={state}
      onRetry={reload}
      query={query}
      onQuery={setQuery}
      picked={picked}
      onToggle={(id) => setPicked((now) => togglePick(now, id))}
      hideAuthor={hideAuthor}
      onHideAuthor={setHideAuthor}
      comment={comment}
      onComment={setComment}
      busy={busy || sending}
      onSend={() => void submit()}
    />
  );
}
