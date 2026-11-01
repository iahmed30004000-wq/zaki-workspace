"use client";

import React from "react";
import { ck, errorKeyOf, weekdaysLabel } from "@/lib/checkins-client";
import { Button } from "@/components/ui/button";
import type { TaskChip, TodayView } from "@/server/services/checkins";
import { CheckinForm, RosterSummary, TeamAnswers, type FormValues } from "./checkin-parts";
import { HistoryPanel } from "./history-panel";
import { SettingsDialog } from "./settings-dialog";
import { pollMs } from "@/lib/economy";

/** How often the page asks again, so a teammate's answer and the roster stay current without a reload. */
const REFRESH_MS = 60_000;

/**
 * «التسجيل اليومي» — the page of a space's daily stand-up: today (the form, the roster, the team's answers once I have
 * answered) and the history. The server decides everything that matters (who may read which answer, whether the round still
 * takes answers); this only draws what it was told and sends the person's own writes.
 *
 * ⚠️ The owner and the space's ADMIN read every answer, and the notices are automatic (they may come up to half a minute
 * late). 🔧 The page always shows today's round, whether or not a notice was seen. Both are drawn together.
 */
export function TodayPanel({
  view,
  busy = false,
  error = "",
  note = "",
  onSubmit,
  onExcuse,
  onUndoExcuse,
}: {
  view: TodayView;
  busy?: boolean;
  error?: string;
  note?: string;
  onSubmit?: (values: FormValues) => void;
  onExcuse?: () => void;
  onUndoExcuse?: () => void;
}) {
  if (!view.enabled) {
    return (
      <div data-checkins-off className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">
        <p className="font-medium text-fg">{ck("checkins.off.title")}</p>
        <p className="mt-1">{ck(view.canManage ? "checkins.off.manage" : "checkins.off.member")}</p>
      </div>
    );
  }
  const round = view.round;
  if (!round) {
    const days = view.schedule ? weekdaysLabel(view.schedule.weekdays) : "";
    // the company's today, as a day of the week (0 = الأحد): the day key is already the company's date
    const [y, m, d] = view.day.split("-").map(Number);
    const weekday = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
    const working = view.schedule?.weekdays.includes(weekday) ?? true;
    return (
      <p data-checkins-waiting className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">
        {!view.schedule ? ck("checkins.off.title") : working ? ck("checkins.waiting", { time: view.schedule.timeOfDay, days }) : ck("checkins.waiting.today", { days })}
      </p>
    );
  }
  const me = view.me;
  const offered: TaskChip[] = [...view.myTasks, ...(me?.tasks ?? []).filter((t) => !view.myTasks.some((m) => m.id === t.id))];
  return (
    <div className="space-y-5">
      <p className="text-xs text-fg-muted">{round.open ? ck("checkins.round.open", { zone: view.timeZone }) : ck("checkins.round.closed")}</p>
      {me && me.participant && round.open ? (
        me.excused ? (
          <div data-checkins-excused className="flex flex-wrap items-center gap-3 rounded-card border border-info/40 bg-info/10 p-3 text-sm text-fg">
            <span className="min-w-0 flex-1">{ck("checkins.excuse.on")}</span>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => onUndoExcuse?.()}>
              {ck("checkins.excuse.undo")}
            </Button>
          </div>
        ) : (
          <CheckinForm
            key={me.answered ? "sent" : "new"}
            questions={round.questions}
            initial={{ answers: me.answers, taskIds: me.taskIds }}
            tasks={offered}
            alreadySent={me.answered}
            busy={busy}
            error={error}
            note={note}
            onSubmit={onSubmit}
            onExcuse={onExcuse}
          />
        )
      ) : me && !me.participant ? (
        <p data-checkins-not-participant className="text-sm text-fg-muted">
          {ck("checkins.not_participant")}
        </p>
      ) : null}
      {error && (me?.excused || !me?.participant || !round.open) ? (
        <p role="alert" className="text-xs text-danger">
          {ck(error)}
        </p>
      ) : null}
      <RosterSummary roster={view.roster} counts={view.counts} />
      <TeamAnswers team={view.team} questions={round.questions} silent={view.canManage && !(me?.answered ?? false)} />
    </div>
  );
}

export function CheckinsView({ initial, workspaceId, spaceName }: { initial: TodayView; workspaceId: string; spaceName: string }) {
  const [view, setView] = React.useState<TodayView>(initial);
  const [tab, setTab] = React.useState<"today" | "history">("today");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [note, setNote] = React.useState("");

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/checkins/today?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
      if (!res.ok) {
        setError(errorKeyOf(await res.json().catch(() => null)));
        return;
      }
      setView((await res.json()) as TodayView);
    } catch {
      setError("checkins.e.failed");
    }
  }, [workspaceId]);

  React.useEffect(() => {
    const timer = setInterval(() => void load(), pollMs(REFRESH_MS));
    return () => clearInterval(timer);
  }, [load]);

  async function send(url: string, body: unknown, done: string) {
    setBusy(true);
    setNote("");
    setError("");
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) setError(errorKeyOf(await res.json().catch(() => null)));
      else setNote(done);
    } catch {
      setError("checkins.e.failed");
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4 md:px-6 md:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold text-fg">{ck("checkins.title")}</h1>
          <p className="text-xs text-fg-muted">{ck("checkins.space", { name: spaceName })}</p>
        </div>
        {view.canManage ? <SettingsDialog workspaceId={workspaceId} timeZone={view.timeZone} onSaved={() => void load()} /> : null}
      </header>

      <div role="tablist" aria-label={ck("checkins.title")} className="flex gap-1 border-b border-border">
        {(["today", "history"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`-mb-px min-h-11 border-b-2 px-3 text-sm font-medium ${tab === key ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg"}`}
          >
            {ck(`checkins.tab.${key}`)}
          </button>
        ))}
      </div>

      {tab === "today" ? (
        <TodayPanel
          view={view}
          busy={busy}
          error={error}
          note={note}
          onSubmit={(values) => void send("/api/checkins/answer", { workspaceId, ...values }, "checkins.form.saved")}
          onExcuse={() => void send("/api/checkins/excuse", { workspaceId, on: true }, "checkins.excuse.on")}
          onUndoExcuse={() => void send("/api/checkins/excuse", { workspaceId, on: false }, "checkins.excuse.undo")}
        />
      ) : (
        <HistoryPanel workspaceId={workspaceId} />
      )}

      <div className="space-y-0.5 border-t border-border pt-2 text-xs text-fg-muted">
        <p>{ck("checkins.warn")}</p>
        <p>{ck("checkins.fix")}</p>
      </div>
    </div>
  );
}
