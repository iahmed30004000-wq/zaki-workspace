"use client";

import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { fetchChatJson } from "@/lib/chat/cache/http";
import { ct } from "@/lib/chat/text";
import { WEEKDAY_ORDER, dayKeyOf, daysUrl, monthGrid, onDateUrl, shiftMonth } from "@/lib/chat/v2/phone/date-jump";
import { cn } from "@/lib/utils";

/**
 * S5.7 (c) — THE DATE JUMP. A tap on the floating date chip opens this small calendar: one month at a time (the arrows go to the month before and after), every day
 * CLOSED except the ones that hold a message the person can see (the server lists them for the month, in the person's own time zone). A day that does jumps to its first
 * message through the history's own `jumpTo` (the window around it is loaded and the message is highlighted for two seconds, like a search hit), and the sheet closes.
 *
 * It is the chat's own data and nothing else: the server answers only days and one message id of a conversation the person already reads.
 */
export function DateJumpSheet({
  open,
  onOpenChange,
  conversationId,
  initial,
  onJump,
  portal = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  /** the day the log is at now (the month the calendar opens on); absent: this month */
  initial?: Date | null;
  /** jump to a message of the conversation */
  onJump: (messageId: string) => void;
  portal?: boolean;
}) {
  const start = initial ?? new Date();
  const [view, setView] = React.useState({ year: start.getFullYear(), month: start.getMonth() + 1 });
  // the days of the viewed month that hold messages: null while they are asked for
  const [days, setDays] = React.useState<ReadonlySet<number> | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // every opening starts again on the month the log is at
  React.useEffect(() => {
    if (!open) return;
    const at = initial ?? new Date();
    setView({ year: at.getFullYear(), month: at.getMonth() + 1 });
    setFailed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    setDays(null);
    fetchChatJson<{ days: number[] }>(daysUrl(conversationId, view.year, view.month), ctl.signal).then(
      (answer) => {
        if (!ctl.signal.aborted) setDays(new Set(answer.days));
      },
      () => {
        if (!ctl.signal.aborted) {
          setDays(new Set());
          setFailed(true);
        }
      },
    );
    return () => ctl.abort();
  }, [open, conversationId, view.year, view.month]);

  const go = async (day: number) => {
    setBusy(true);
    setFailed(false);
    try {
      const answer = await fetchChatJson<{ id: string | null }>(onDateUrl(conversationId, dayKeyOf(view.year, view.month, day)));
      if (!answer.id) return setFailed(true);
      onOpenChange(false);
      onJump(answer.id);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const weeks = monthGrid(view.year, view.month);
  const nav = "inline-flex size-11 items-center justify-center rounded-lg text-fg hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent portal={portal} data-date-jump-sheet="">
        <SheetHeader>
          <SheetTitle>{ct("chatparity.date.title")}</SheetTitle>
        </SheetHeader>
        <SheetBody>
          <div className="mb-2 flex items-center justify-between gap-2">
            <button type="button" data-date-prev="" className={nav} aria-label={ct("chatparity.date.prev")} onClick={() => setView((v) => shiftMonth(v.year, v.month, -1))}>
              <ChevronRight aria-hidden="true" className="size-5" />
            </button>
            <p data-date-month="" className="text-base font-semibold" aria-live="polite">
              {ct(`chatparity.date.m${view.month}`)} <span className="tabular-nums">{view.year}</span>
            </p>
            <button type="button" data-date-next="" className={nav} aria-label={ct("chatparity.date.next")} onClick={() => setView((v) => shiftMonth(v.year, v.month, 1))}>
              <ChevronLeft aria-hidden="true" className="size-5" />
            </button>
          </div>
          <div role="grid" aria-busy={days === null} className="grid grid-cols-7 gap-y-1 text-center">
            {WEEKDAY_ORDER.map((w) => (
              <span key={w} role="columnheader" className="py-1 text-xs font-semibold text-fg-muted">
                {ct(`chatparity.date.w${w}`)}
              </span>
            ))}
            {weeks.flat().map((day, i) =>
              day === null ? (
                <span key={`e${i}`} aria-hidden="true" />
              ) : (
                <button
                  key={day}
                  type="button"
                  role="gridcell"
                  data-date-day={dayKeyOf(view.year, view.month, day)}
                  disabled={busy || days === null || !days.has(day)}
                  aria-label={days?.has(day) ? ct("chatparity.date.day_label", { day, month: ct(`chatparity.date.m${view.month}`) }) : undefined}
                  onClick={() => void go(day)}
                  className={cn(
                    "mx-auto grid size-11 place-items-center rounded-full text-sm tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                    days?.has(day) ? "font-semibold text-fg hover:bg-accent hover:text-accent-fg" : "text-fg-muted opacity-40",
                  )}
                >
                  {day}
                </button>
              ),
            )}
          </div>
          {days !== null && days.size === 0 && !failed ? (
            <p data-date-empty="" className="mt-2 text-center text-sm text-fg-muted">
              {ct("chatparity.date.empty")}
            </p>
          ) : null}
          {days === null ? (
            <p role="status" className="mt-2 text-center text-sm text-fg-muted">
              {ct("chatparity.date.loading")}
            </p>
          ) : null}
          {failed ? (
            <p role="alert" className="mt-2 text-center text-sm text-danger">
              {ct("chatparity.date.failed")}
            </p>
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
