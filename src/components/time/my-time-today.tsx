"use client";

import React from "react";
import Link from "next/link";
import { Clock, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOptionalToast } from "@/components/ui/toast";
import { errorKeyOf, tt } from "@/lib/time-client";
import { formatClock, formatDecimal, formatHM, runningSeconds } from "@/lib/time-tracking";
import type { MyTimeToday } from "@/server/services/time-tracking";
import { pollMs } from "@/lib/economy";

/** How often the line asks the server again, so a timer stopped elsewhere (another tab, the job runner) shows up without a reload. */
const REFRESH_MS = 60_000;
const TICK_MS = 1000;

/**
 * The compact, presentational «وقتي اليوم» line: the finished time of today, plus the running timer with its live clock
 * and «وقّف». It does no fetching, so it renders in a test and on the server. The live clock is drawn from the SERVER's
 * `startedAt` and `serverNow` (never the browser's date); today's total adds that running time to the finished sum, as
 * integers.
 */
export function TimeTodayLine({
  data,
  receivedAt,
  nowMs,
  busy = false,
  onStop,
}: {
  data: MyTimeToday;
  receivedAt: number;
  nowMs: number;
  busy?: boolean;
  onStop: () => void;
}) {
  const live = data.running ? runningSeconds(data.running.startedAt, data.serverNow, receivedAt, nowMs) : 0;
  const total = data.todaySeconds + live;
  return (
    <div className="space-y-2">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span data-time-today className="text-xl font-semibold tabular-nums text-fg" aria-label={tt("tt.today.total_aria", { hm: formatHM(total) })}>
          {formatHM(total)}
        </span>
        <span className="text-xs tabular-nums text-fg-muted">{formatDecimal(total)}</span>
      </p>
      {data.running ? (
        <div data-time-running className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-surface-2/50 px-3 py-2">
          <span dir="ltr" className="font-mono text-lg font-semibold tabular-nums text-ok" role="timer" aria-label={tt("tt.clock_aria", { clock: formatClock(live) })}>
            {formatClock(live)}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
            {tt("tt.today.running_on")}{" "}
            {data.running.taskId ? (
              <Link href={`/tasks/${data.running.taskId}`} className="text-accent underline-offset-2 hover:underline">
                {data.running.taskTitle}
              </Link>
            ) : (
              data.running.taskTitle
            )}
          </span>
          <Button type="button" variant="danger" size="sm" disabled={busy} onClick={onStop}>
            <Square className="h-3.5 w-3.5" aria-hidden="true" /> {tt("tt.stop")}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-fg-muted">{tt("tt.today.none")}</p>
      )}
    </div>
  );
}

/**
 * «وقتي اليوم» — a small card of the person's own time on the Today page (the page itself is not rewritten: one line
 * mounts this, only while the company's `timeTracking` switch is on and the person is not an external partner).
 */
export function MyTimeToday() {
  const toast = useOptionalToast();
  const [data, setData] = React.useState<MyTimeToday | null>(null);
  const [receivedAt, setReceivedAt] = React.useState(0);
  const [nowMs, setNowMs] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/time/me", { cache: "no-store" });
      if (!res.ok) {
        setError(errorKeyOf(await res.json().catch(() => null)));
        return;
      }
      setData((await res.json()) as MyTimeToday);
      const now = Date.now();
      setReceivedAt(now);
      setNowMs(now);
      setError("");
    } catch {
      setError("tt.failed");
    }
  }, []);

  React.useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), pollMs(REFRESH_MS));
    return () => clearInterval(timer);
  }, [load]);

  const running = data?.running ?? null;
  React.useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [running]);

  async function stop() {
    setBusy(true);
    try {
      const res = await fetch("/api/time/stop", { method: "POST" });
      const body = (await res.json().catch(() => null)) as { entry?: { seconds: number } } | null;
      if (!res.ok) setError(errorKeyOf(body));
      else if (body?.entry) toast?.toast(tt("tt.toast.stopped", { hm: formatHM(body.entry.seconds) }), "success");
    } catch {
      setError("tt.failed");
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <section aria-labelledby="time-today-title" className="rounded-card border border-border bg-surface-1 shadow-card">
      <header className="flex items-center gap-2 px-4 pt-3">
        <h2 id="time-today-title" className="flex min-w-0 flex-1 items-center gap-1.5 text-base font-semibold text-fg">
          <Clock className="h-4 w-4" aria-hidden="true" /> {tt("tt.today.title")}
        </h2>
        <Link href="/time" className="text-xs text-accent underline-offset-2 hover:underline">
          {tt("tt.report_link")}
        </Link>
      </header>
      <div className="space-y-2 px-4 py-3">
        {data ? <TimeTodayLine data={data} receivedAt={receivedAt} nowMs={nowMs} busy={busy} onStop={() => void stop()} /> : error ? null : <p className="text-sm text-fg-muted">{tt("tt.today.loading")}</p>}
        {error ? (
          <p role="alert" className="text-xs text-danger">
            {tt(error)}
          </p>
        ) : null}
      </div>
    </section>
  );
}
