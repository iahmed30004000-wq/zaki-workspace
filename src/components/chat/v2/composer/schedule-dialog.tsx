"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ct } from "@/lib/chat/text";
import { zonedParts, zonedWallTime } from "@/lib/zoned-time";

/**
 * C3c.3 — «جدول الإرسال»: the dialog that asks WHEN. A date and a time, read in the COMPANY's time zone (not the device's: the same wall clock for everybody in the
 * company), at least a minute ahead and at most 365 days. The server checks every rule again (`src/server/chat/scheduled.ts`); the two numbers below are repeated from there
 * (a client file cannot import a server one) and a test pins that they agree.
 *
 * It sits OUTSIDE the composer's form (the surface draws it next to the form): its own submit never reaches the composer's.
 */
export const SCHEDULE_MIN_LEAD_MS = 60_000;
export const SCHEDULE_MAX_DAYS = 365;
/** A chat upload lives 24 hours until a message claims it, and the server keeps ten minutes of margin: a message with files must go out inside this. */
export const SCHEDULE_FILES_WINDOW_MS = 24 * 60 * 60 * 1000 - 10 * 60 * 1000;

const two = (n: number): string => String(n).padStart(2, "0");

/** The wall clock of an instant in a zone, as the two fields of the dialog read it (`2026-11-20`, `14:30`; Western digits). */
export function wallFieldsOf(instant: Date, timeZone: string): { date: string; time: string } {
  const p = zonedParts(instant, timeZone);
  return { date: `${p.year}-${two(p.month)}-${two(p.day)}`, time: `${two(p.hour)}:${two(p.minute)}` };
}

/** The instant at which the company's wall clock reads these two fields; null when they are not a real date and time. */
export function instantOfWall(date: string, time: string, timeZone: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const [year, month, day, hour, minute] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const instant = zonedWallTime({ year, month, day, hour, minute }, timeZone);
  // a day that does not exist (31 February) rolls over: the fields must read back the same
  const back = wallFieldsOf(instant, timeZone);
  return back.date === date ? instant : null;
}

/** The first suggestion: an hour from now, on the next quarter of an hour. */
export function suggestedWall(now: Date, timeZone: string): { date: string; time: string } {
  const QUARTER = 15 * 60_000;
  return wallFieldsOf(new Date(Math.ceil((now.getTime() + 60 * 60_000) / QUARTER) * QUARTER), timeZone);
}

/** The dictionary key of what is wrong with the chosen moment, or null. Pure. */
export function scheduleProblemOf(instant: Date | null, now: Date, hasFiles: boolean): string | null {
  if (!instant) return "chat.sched.e.bad_time";
  const lead = instant.getTime() - now.getTime();
  if (lead < SCHEDULE_MIN_LEAD_MS) return "chat.sched.e.too_soon";
  if (lead > SCHEDULE_MAX_DAYS * 24 * 60 * 60 * 1000) return "chat.sched.e.too_far";
  if (hasFiles && lead > SCHEDULE_FILES_WINDOW_MS) return "chat.sched.e.files_window";
  return null;
}

/** The dialog reads minutes; a row's own moment may carry seconds. */
const minuteOf = (iso: string): number => Math.floor(new Date(iso).getTime() / 60_000) * 60_000;

/** Did the person change the moment of a row they edit? (The dialog's minute against the row's own: an edit of the words alone must not send a moment, nor hold it to the minimum lead.) Pure. */
export function editChangesTime(originalIso: string, chosenIso: string): boolean {
  return new Date(chosenIso).getTime() !== minuteOf(originalIso);
}

/** `2026/11/20 14:30` in the company's zone (Western digits, no month names). */
export function whenText(iso: string, timeZone: string): string {
  const { date, time } = wallFieldsOf(new Date(iso), timeZone);
  return `${date.replace(/-/g, "/")} ${time}`;
}

export interface ScheduleSubmit {
  /** ISO instant */
  sendAt: string;
  /** the edited words (edit mode only) */
  body?: string;
}

export interface ScheduleDialogProps {
  open: boolean;
  onClose: () => void;
  /** the company's time zone (from the scheduled list's answer) */
  timeZone: string;
  /** the message has files: it must go out inside the files' window */
  hasFiles: boolean;
  /** `edit`: the words can be changed too, and the moment starts at the row's own */
  edit?: { body: string; sendAt: string } | null;
  /** Saves it; resolves to a sentence to show (the failure), or null when it worked (the owner of the state closes the dialog). */
  onSubmit: (input: ScheduleSubmit) => Promise<string | null>;
  /** server-render tests */
  portal?: boolean;
  /** server-render tests: the clock */
  now?: () => Date;
}

const field = "h-11 w-full rounded-lg border border-muted bg-surface px-3 text-base md:h-9 md:text-sm";

export function ScheduleDialog({ open, onClose, timeZone, hasFiles, edit = null, onSubmit, portal = true, now = () => new Date() }: ScheduleDialogProps) {
  const [date, setDate] = React.useState("");
  const [time, setTime] = React.useState("");
  const [words, setWords] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  // every time it opens it starts again: from the row's own moment (edit) or an hour from now
  React.useEffect(() => {
    if (!open) return;
    const start = edit ? wallFieldsOf(new Date(edit.sendAt), timeZone) : suggestedWall(now(), timeZone);
    setDate(start.date);
    setTime(start.time);
    setWords(edit?.body ?? "");
    setBusy(false);
    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when it opens
  }, [open]);

  async function submit(event: React.FormEvent) {
    // drawn in a portal but kept out of the composer's form: nothing here may reach it
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    const instant = instantOfWall(date, time, timeZone);
    // an edit that leaves the moment alone only needs it to be still ahead (the row may be seconds from going out)
    const now0 = now();
    const unchanged = edit !== null && instant !== null && !editChangesTime(edit.sendAt, instant.toISOString());
    const problem = unchanged ? (instant!.getTime() > now0.getTime() ? null : "chat.sched.e.too_soon") : scheduleProblemOf(instant, now0, hasFiles);
    if (problem || !instant) {
      setError(ct(problem ?? "chat.sched.e.bad_time"));
      return;
    }
    if (edit && words.trim().length === 0) {
      setError(ct("chat.e.empty"));
      return;
    }
    setBusy(true);
    setError("");
    const failure = await onSubmit({ sendAt: instant.toISOString(), ...(edit ? { body: words.trim() } : {}) });
    setBusy(false);
    if (failure) setError(failure);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md" portal={portal} data-sched-dialog>
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{ct(edit ? "chatsched.dialog.title_edit" : "chatsched.dialog.title")}</DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            {edit ? (
              <div>
                <label htmlFor="chat-schedule-words" className="mb-1 block text-sm font-medium">
                  {ct("chatsched.dialog.words")}
                </label>
                <textarea id="chat-schedule-words" rows={3} value={words} onChange={(event) => setWords(event.currentTarget.value)} className="min-h-11 w-full resize-none rounded-lg border border-muted bg-surface px-3 py-2 text-base md:text-sm" />
              </div>
            ) : null}
            <p className="text-sm font-medium">{ct("chatsched.dialog.when")}</p>
            <div className="flex flex-wrap gap-3">
              <div className="min-w-0 flex-1">
                <label htmlFor="chat-schedule-date" className="mb-1 block text-xs text-fg-muted">
                  {ct("chatsched.dialog.date")}
                </label>
                <input id="chat-schedule-date" type="date" dir="ltr" required value={date} onChange={(event) => setDate(event.currentTarget.value)} className={field} />
              </div>
              <div className="min-w-0 flex-1">
                <label htmlFor="chat-schedule-time" className="mb-1 block text-xs text-fg-muted">
                  {ct("chatsched.dialog.time")}
                </label>
                <input id="chat-schedule-time" type="time" dir="ltr" required value={time} onChange={(event) => setTime(event.currentTarget.value)} className={field} />
              </div>
            </div>
            <p className="text-xs text-fg-muted" data-sched-zone>
              {ct("chatsched.dialog.zone", { zone: timeZone })}
            </p>
            <p className="text-xs text-fg-muted">{ct("chatsched.dialog.limits")}</p>
            {hasFiles ? <p className="text-xs text-warn">{ct("chatsched.dialog.files")}</p> : null}
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {ct("chatsched.dialog.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={busy} data-sched-confirm>
              {busy ? ct("chatsched.dialog.working") : ct(edit ? "chatsched.dialog.save" : "chatsched.dialog.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
