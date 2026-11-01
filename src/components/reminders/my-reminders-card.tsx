"use client";

import React from "react";
import Link from "next/link";
import { enumLabel } from "@/lib/i18n/enums";
import { errorKeyOf, rt, whenLabel } from "@/lib/reminders/client";
import type { ReminderDto } from "@/server/services/reminders";
import { Button } from "@/components/ui/button";
import { ReminderForm } from "./reminder-form";
import { pollMs } from "@/lib/economy";

/** How often the card asks again, so a reminder that just fired shows up without a reload. */
const REFRESH_MS = 60_000;

export interface RemindersData {
  reminders: ReminderDto[];
  timeZone: string;
}

/**
 * «تذكيراتي» — the person's own reminders, a compact card on the Today page (the page itself is not rewritten: one line
 * mounts this, when the company's «ذكّرني» switch is on).
 *
 * What fired and waits for «تمّ» comes first, then what is still to come. Each row: snooze «بعد ساعة» or
 * «بكرا الصبح», or «تمّ». ⚠️ The runner is automatic (the server checks every half minute), so a notice can come up to
 * half a minute late; 🔧 the card itself always lists it, whether or not a notice was seen. Both are drawn together.
 */
export function RemindersList({
  data,
  busy = false,
  onSnooze,
  onDone,
}: {
  data: RemindersData;
  busy?: boolean;
  onSnooze: (id: string, preset: "HOUR" | "TOMORROW_MORNING") => void;
  onDone: (id: string) => void;
}) {
  const { reminders, timeZone } = data;
  if (reminders.length === 0) return <p className="text-sm text-fg-muted">{rt("reminder.empty")}</p>;
  return (
    <ul className="divide-y divide-border/60">
      {reminders.map((r) => (
        <li key={r.id} className="py-2" data-reminder={r.id}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{r.title}</span>
            {r.fired ? <span className="rounded bg-warn/10 px-1.5 py-0.5 text-xs font-medium text-warn">{rt("reminder.fired")}</span> : null}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
            <span suppressHydrationWarning>{whenLabel(r.dueAt, timeZone)}</span>
            {r.repeat !== "NONE" ? <span>{enumLabel("ReminderRepeat", r.repeat)}</span> : null}
            {r.taskId ? <span>{rt("reminder.on_task")}</span> : r.messageId ? <span>{rt("reminder.on_message")}</span> : null}
            {r.href ? (
              <Link href={r.href} className="text-accent underline-offset-2 hover:underline">
                {rt("reminder.open")}
              </Link>
            ) : null}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => onSnooze(r.id, "HOUR")}>
              {rt("reminder.snooze_hour")}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => onSnooze(r.id, "TOMORROW_MORNING")}>
              {rt("reminder.snooze_tomorrow")}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={busy} aria-label={rt("reminder.done_aria", { title: r.title })} onClick={() => onDone(r.id)}>
              {rt("reminder.done")}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MyRemindersCard() {
  const [data, setData] = React.useState<RemindersData | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/reminders", { cache: "no-store" });
      if (!res.ok) {
        setError(errorKeyOf(await res.json().catch(() => null)));
        return;
      }
      setData((await res.json()) as RemindersData);
      setError("");
    } catch {
      setError("reminder.failed");
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), pollMs(REFRESH_MS));
    return () => clearInterval(timer);
  }, [load]);

  async function send(url: string, init: RequestInit, done: string) {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
      if (!res.ok) setError(errorKeyOf(await res.json().catch(() => null)));
      else {
        setError("");
        setNote(done);
      }
    } catch {
      setError("reminder.failed");
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <section aria-labelledby="reminders-title" className="rounded-card border border-border bg-surface-1 shadow-card">
      <header className="flex items-center gap-2 px-4 pt-3">
        <div className="min-w-0 flex-1">
          <h2 id="reminders-title" className="text-base font-semibold text-fg">
            {rt("reminder.title")}
          </h2>
          <p className="text-xs text-fg-muted">{rt("reminder.hint")}</p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
          {rt("reminder.add_standalone")}
        </Button>
      </header>
      <div className="space-y-3 px-4 py-3">
        {adding && data ? (
          <ReminderForm
            timeZone={data.timeZone}
            onSaved={() => {
              setAdding(false);
              setNote("reminder.saved");
              void load();
            }}
            onCancel={() => setAdding(false)}
          />
        ) : null}
        {data ? (
          <RemindersList
            data={data}
            busy={busy}
            onSnooze={(id, preset) => void send(`/api/reminders/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ snooze: preset }) }, "reminder.snoozed")}
            onDone={(id) => void send(`/api/reminders/${encodeURIComponent(id)}`, { method: "DELETE" }, "reminder.dismissed")}
          />
        ) : error ? null : (
          <p className="text-sm text-fg-muted">{rt("reminder.loading")}</p>
        )}
        {note ? (
          <p role="status" className="text-xs text-ok">
            {rt(note)}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {rt(error)}
          </p>
        ) : null}
        <div className="space-y-0.5 border-t border-border pt-2 text-xs text-fg-muted">
          <p>
            <span aria-hidden="true">⚠️ </span>
            {rt("reminder.warn")}
          </p>
          <p>
            <span aria-hidden="true">🔧 </span>
            {rt("reminder.fix")}
          </p>
        </div>
      </div>
    </section>
  );
}
