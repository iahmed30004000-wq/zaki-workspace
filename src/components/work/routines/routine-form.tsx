"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { WEEK_ORDER } from "@/components/recurrence/recurrence-form";
import { DAY_PRESETS, EVERY_DAY, WORKING_DAYS, presetOfDays, type DayPreset } from "@/lib/daily-routine";
import { errorKeyOf, rt } from "@/lib/reminders/client";
import type { RoutineDto, RoutineSpaceOption } from "@/server/services/daily-routines";
import { cn } from "@/lib/utils";

const CHIP = "min-h-9 rounded-lg border px-3 text-sm transition-colors motion-reduce:transition-none";
const chip = (on: boolean) => cn(CHIP, on ? "border-accent bg-accent/10 font-medium text-fg" : "border-border bg-surface text-fg-muted hover:bg-surface-2");

/**
 * The form of one routine: what, where, for whom, which days and the two times. It posts a new one (or patches `routine`);
 * the server decides everything again. A new routine opens on «العمل of every day»: the first space offered, every day,
 * 08:00, done by the company's usual hour.
 */
export function RoutineForm({
  routine,
  spaces,
  timeZone,
  defaultDueTime,
  onSaved,
  onCancel,
}: {
  routine: RoutineDto | null;
  spaces: RoutineSpaceOption[];
  timeZone: string;
  defaultDueTime: string;
  onSaved: (saved: RoutineDto) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = React.useState(routine?.title ?? "");
  const [description, setDescription] = React.useState(routine?.description ?? "");
  const [spaceId, setSpaceId] = React.useState(spaces.find((s) => s.id === routine?.workspaceId)?.id ?? spaces[0]?.id ?? "");
  const space = spaces.find((s) => s.id === spaceId);
  const [projectId, setProjectId] = React.useState(routine?.projectId ?? "");
  const [assigneeId, setAssigneeId] = React.useState(routine?.assignee.id ?? "");
  const [preset, setPreset] = React.useState<DayPreset>(routine ? presetOfDays(routine.days) : "EVERY");
  const [custom, setCustom] = React.useState<number[]>(routine?.days ?? []);
  const [time, setTime] = React.useState(routine?.time ?? "08:00");
  const [dueTime, setDueTime] = React.useState(routine?.dueTime ?? defaultDueTime);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // a project or a person that the chosen space does not hold is dropped, never sent
  const project = space?.projects.find((p) => p.id === projectId)?.id ?? space?.projects[0]?.id ?? "";
  const person = space?.people.find((p) => p.id === assigneeId)?.id ?? "";
  const days = preset === "EVERY" ? [...EVERY_DAY] : preset === "WORKING" ? [...WORKING_DAYS] : custom;
  const problem = !title.trim()
    ? "routine.title_required"
    : !person
      ? "routine.assignee_required"
      : !days.length
        ? "routine.days_required"
        : !time || !dueTime
          ? "routine.time_invalid"
          : dueTime <= time
            ? "routine.due_after_time"
            : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(routine ? `/api/daily-routines/${encodeURIComponent(routine.id)}` : "/api/daily-routines", {
        method: routine ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: spaceId, projectId: project, title: title.trim(), description: description.trim() || null, assigneeId: person, days, time, dueTime }),
      });
      const body = (await res.json().catch(() => null)) as { routine?: RoutineDto } | null;
      if (!res.ok || !body?.routine) {
        setError(errorKeyOf(body, "routine.failed"));
        return;
      }
      onSaved(body.routine);
    } catch {
      setError("routine.failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" data-routine-form noValidate>
      <div>
        <Label>{rt("routine.field.title")}</Label>
        <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} aria-label={rt("routine.field.title")} />
      </div>
      <div>
        <Label>{rt("routine.field.description")}</Label>
        <textarea
          value={description}
          maxLength={5000}
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
          aria-label={rt("routine.field.description")}
          className="w-full rounded-lg border border-muted bg-surface px-2 py-1.5 text-base text-fg md:text-sm"
        />
      </div>
      {spaces.length > 1 ? (
        <div>
          <Label>{rt("routine.field.space")}</Label>
          <Select value={spaceId} onChange={(e) => setSpaceId(e.target.value)} aria-label={rt("routine.field.space")}>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <div>
        <Label>{rt("routine.field.project")}</Label>
        <Select value={project} onChange={(e) => setProjectId(e.target.value)} aria-label={rt("routine.field.project")}>
          {space?.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>{rt("routine.field.assignee")}</Label>
        <Select value={person} onChange={(e) => setAssigneeId(e.target.value)} aria-label={rt("routine.field.assignee")}>
          <option value="">{rt("routine.field.assignee_pick")}</option>
          {space?.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>{rt("routine.field.days")}</Label>
        <div role="group" aria-label={rt("routine.field.days")} className="flex flex-wrap gap-1.5">
          {DAY_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={preset === p}
              data-day-preset={p}
              onClick={() => {
                if (p === "CUSTOM" && !custom.length) setCustom(days);
                setPreset(p);
              }}
              className={chip(preset === p)}
            >
              {rt(`routine.days.${p}`)}
            </button>
          ))}
        </div>
        {preset === "CUSTOM" ? (
          <div role="group" aria-label={rt("routine.days.CUSTOM")} className="mt-2 flex flex-wrap gap-1.5">
            {WEEK_ORDER.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={custom.includes(d)}
                data-weekday={d}
                onClick={() => setCustom((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))}
                className={chip(custom.includes(d))}
              >
                {rt(`recurring.day.${d}`)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>{rt("routine.field.time")}</Label>
          <Input type="time" dir="ltr" value={time} onChange={(e) => setTime(e.target.value)} aria-label={rt("routine.field.time")} />
        </div>
        <div>
          <Label>{rt("routine.field.due")}</Label>
          <Input type="time" dir="ltr" value={dueTime} onChange={(e) => setDueTime(e.target.value)} aria-label={rt("routine.field.due")} />
        </div>
      </div>
      <p className="text-xs text-fg-muted">{rt("routine.zone", { zone: timeZone })}</p>
      {routine ? <p className="text-xs text-fg-muted">{rt("routine.edit_hint")}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {rt(error)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {rt("routine.cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {rt("routine.save")}
        </Button>
      </div>
    </form>
  );
}
