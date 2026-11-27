"use client";

import React from "react";
import Link from "next/link";
import { Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WEEK_ORDER } from "@/components/recurrence/recurrence-form";
import { presetOfDays } from "@/lib/daily-routine";
import { errorKeyOf, rt, whenLabel } from "@/lib/reminders/client";
import type { RoutineDto, RoutinesScreen } from "@/server/services/daily-routines";
import { RoutineForm } from "./routine-form";

/** «كل يوم» · «أيام الدوام» · the names of the chosen days. */
export function daysText(days: readonly number[]): string {
  const preset = presetOfDays(days);
  if (preset !== "CUSTOM") return rt(`routine.days.${preset}`);
  return WEEK_ORDER.filter((d) => days.includes(d))
    .map((d) => rt(`recurring.day.${d}`))
    .join("، ");
}

function RoutineCard({
  routine,
  timeZone,
  busy,
  canEdit,
  onEdit,
  onToggle,
}: {
  routine: RoutineDto;
  timeZone: string;
  busy: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onToggle: () => void;
}) {
  return (
    <li data-routine={routine.id} data-routine-active={routine.active} className="space-y-1 rounded-2xl border border-border bg-surface-1 p-3">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 break-words text-sm font-semibold text-fg">{routine.title}</h2>
        {routine.active ? null : <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-fg-muted">{rt("routine.paused")}</span>}
      </div>
      <p className="text-xs text-fg-muted">{rt("routine.for", { name: routine.assignee.name, space: routine.workspaceName, project: routine.projectName })}</p>
      <p className="text-xs text-fg">{rt("routine.when", { days: daysText(routine.days), time: routine.time, due: routine.dueTime })}</p>
      {routine.active && routine.nextRunAt ? <p className="text-xs text-info">{rt("routine.next", { when: whenLabel(routine.nextRunAt, timeZone) })}</p> : null}
      {routine.stoppedReason ? (
        <p role="status" className="rounded-lg border border-warn/40 bg-warn/10 p-2 text-xs text-fg">
          <span aria-hidden="true">⚠️ </span>
          {rt(`routine.stopped.${routine.stoppedReason}`)}
        </p>
      ) : null}
      {routine.canManage ? (
        <div className="flex justify-end gap-2 pt-1">
          {canEdit ? (
            <Button type="button" variant="ghost" size="sm" onClick={onEdit} aria-haspopup="dialog">
              {rt("routine.edit")}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onToggle}>
            {rt(routine.active ? "routine.pause" : "routine.resume")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/** «الروتين اليومي»: the routines the person may see, with pause / resume / edit for those they manage, and «روتين جديد». */
export function RoutinesView({ initial, defaultDueTime }: { initial: RoutinesScreen; defaultDueTime: string }) {
  const [routines, setRoutines] = React.useState(initial.routines);
  const [editing, setEditing] = React.useState<RoutineDto | "new" | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const canMake = initial.spaces.length > 0;

  const put = (saved: RoutineDto) =>
    setRoutines((cur) => (cur.some((r) => r.id === saved.id) ? cur.map((r) => (r.id === saved.id ? saved : r)) : [...cur, saved]));

  async function toggle(routine: RoutineDto) {
    setBusyId(routine.id);
    setError("");
    try {
      const res = await fetch(`/api/daily-routines/${encodeURIComponent(routine.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: routine.active ? "pause" : "resume" }),
      });
      const body = (await res.json().catch(() => null)) as { routine?: RoutineDto } | null;
      if (!res.ok || !body?.routine) setError(errorKeyOf(body, "routine.failed"));
      else put(body.routine);
    } catch {
      setError("routine.failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl space-y-3 px-4 pb-8 pt-4">
        <Link href="/my-work" className="inline-flex min-h-9 items-center text-sm font-semibold text-accent hover:underline">
          {rt("routine.back")}
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-lg font-bold text-fg">
            <Repeat aria-hidden="true" className="size-5" />
            {rt("routine.title")}
          </h1>
          {canMake ? (
            <Button type="button" onClick={() => setEditing("new")} aria-haspopup="dialog">
              <Plus aria-hidden="true" className="me-1 size-4" />
              {rt("routine.new")}
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-fg-muted">{rt("routine.intro")}</p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {rt(error)}
          </p>
        ) : null}
        {routines.length ? (
          <ul className="space-y-2">
            {routines.map((routine) => (
              <RoutineCard
                key={routine.id}
                routine={routine}
                timeZone={initial.timeZone}
                busy={busyId === routine.id}
                canEdit={canMake}
                onEdit={() => setEditing(routine)}
                onToggle={() => void toggle(routine)}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-fg-muted">{rt(canMake ? "routine.empty" : "routine.cannot_make")}</p>
        )}
      </div>
      <Dialog open={editing !== null} onOpenChange={(next) => (next ? undefined : setEditing(null))}>
        <DialogContent aria-label={rt(editing === "new" ? "routine.new" : "routine.edit_title")}>
          <DialogHeader>
            <DialogTitle>{rt(editing === "new" ? "routine.new" : "routine.edit_title")}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {editing ? (
              <RoutineForm
                routine={editing === "new" ? null : editing}
                spaces={initial.spaces}
                timeZone={initial.timeZone}
                defaultDueTime={defaultDueTime}
                onCancel={() => setEditing(null)}
                onSaved={(saved) => {
                  put(saved);
                  setEditing(null);
                }}
              />
            ) : null}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
