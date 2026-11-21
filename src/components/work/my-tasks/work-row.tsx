"use client";

import * as React from "react";
import { Check, Lock } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { ListRow } from "@/components/ui/list-row";
import { STAGE_TONE, StateChip } from "@/components/work/look";
import { PinMark, RewardBadge, type RewardBadgeData } from "@/components/rewards/reward-badge";
import { StepProgressChip } from "@/components/task-steps/step-progress";
import { RunningChip } from "@/components/time/running-chip";
import { RecurringBadge } from "@/components/recurrence/recurring-badge";
import { DueDayChip } from "@/components/work/my-tasks/due-chip";
import { AutoMark } from "@/components/work/stale/auto-mark";
import { PRIORITY_STYLES, fmtDMY, fmtRelative } from "@/lib/format";
import { enumLabel } from "@/lib/i18n/enums";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { WorkTaskDto } from "@/lib/work/my-tasks";

/**
 * One task of «مهامي» (W1.1) on D1's `ListRow`: a round tick, the title (a link to the task's full page that opens the SIDE PANEL on a plain click, so ctrl-click and
 * «open in a new tab» still reach `/tasks/[id]`), a second line with where it lives, and at the end the state as a chip, the due day and the person's circle (the
 * Telegram-like look: the rows of a group share one white card, see `WORK_LIST`). Ticking and changing the day
 * are handed to the screen, which changes the cache at once and calls the door (optimistic).
 */
export function WorkRow({
  task,
  showSpace,
  showProject = true,
  showStage = true,
  selected = false,
  todayIso,
  onOpen,
  onToggle,
  onDue,
}: {
  task: WorkTaskDto;
  showSpace: boolean;
  showProject?: boolean;
  showStage?: boolean;
  selected?: boolean;
  /** The company's today: an open task due before it wears its day in the danger colour. */
  todayIso?: string;
  onOpen: (id: string) => void;
  onToggle: (id: string, done: boolean) => void;
  onDue: (id: string, day: string | null) => void;
}) {
  const { t } = useI18n();
  const done = task.completedAt !== null;
  const priorityColor = PRIORITY_STYLES[task.priority]?.color ?? "rgb(var(--border))";
  const parts = [task.key, ...(showSpace ? [task.spaceName] : []), ...(showProject ? [task.projectName] : [])];
  const overdue = !done && !!todayIso && !!task.dueDay && task.dueDay < todayIso;
  const assignee = task.assigneeNames.length > 1 ? `${task.assigneeNames[0]} +${task.assigneeNames.length - 1}` : (task.assigneeName ?? "");

  return (
    <ListRow
      role="listitem"
      data-task-row={task.id}
      selected={selected}
      className="last:border-b-0"
      leading={
        <button
          type="button"
          disabled={!task.editable}
          onClick={() => onToggle(task.id, !done)}
          aria-label={done ? t("task.reopen") : t("task.complete")}
          title={done ? t("task.reopen") : t("task.complete")}
          className={cn(
            "flex size-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            done ? "border-ok bg-ok text-ok-fg" : "border-badge-muted hover:border-ok",
            !task.editable && "opacity-40",
          )}
        >
          {done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : null}
        </button>
      }
      title={
        <a
          href={`/tasks/${task.id}`}
          onClick={(e) => {
            // a plain click opens the panel; a click with a modifier (a new tab, a download) keeps its own meaning
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            onOpen(task.id);
          }}
          className={cn("inline-flex max-w-full items-center gap-1.5 hover:underline", done && "text-fg-muted line-through")}
        >
          <span className="truncate">{task.title}</span>
          {task.visibility === "PARTICIPANTS" ? <Lock className="size-3 shrink-0 text-fg-muted" aria-label={t("taskpriv.lock")} /> : null}
        </a>
      }
      subtitle={
        <span className="flex min-w-0 items-center gap-2">
          <span dir="auto" className="truncate">
            {parts.join(" · ")}
          </span>
          <StepProgressChip progress={task.steps} />
          <RunningChip running={task.running} />
          <RecurringBadge recurring={task.recurring} />
          {task.pinnedAt ? <PinMark /> : null}
          <RewardBadge reward={task.reward as RewardBadgeData | null | undefined} />
          {task.automated ? <AutoMark /> : null}
        </span>
      }
      trailing={
        <span className="flex items-center gap-2">
          <span
            role="img"
            aria-label={`${t("task.priority")}: ${enumLabel("TaskPriority", task.priority)}`}
            title={enumLabel("TaskPriority", task.priority)}
            className="size-2 shrink-0 rounded-full max-md:hidden"
            style={{ backgroundColor: priorityColor }}
          />
          {showStage ? <StateChip tone={STAGE_TONE[task.columnStage] ?? "neutral"} className="max-md:hidden">{enumLabel("WorkStage", task.columnStage)}</StateChip> : null}
          {task.editable ? (
            // P2.3: a short Arabic label (اليوم · بكرا · 23 تشرين الثاني) over the invisible native box: a tap opens the picker, `mm/dd/yyyy` is never drawn
            <DueDayChip day={task.dueDay} todayIso={todayIso} overdue={overdue} onChange={(day) => onDue(task.id, day)} />
          ) : (
            <span className={cn("w-28 text-[13px]", overdue ? "text-danger" : "text-fg-muted")} title={task.dueDate ? fmtDMY(task.dueDate) : undefined} suppressHydrationWarning>
              {task.dueDate ? fmtRelative(task.dueDate) : ""}
            </span>
          )}
          {assignee ? (
            <span className="inline-flex items-center gap-1.5" title={task.assigneeNames.join("، ")}>
              <Avatar name={task.assigneeName ?? assignee} className="size-[30px] text-[13px]" />
              {task.assigneeNames.length > 1 ? <span className="text-[13px] text-fg-muted">+{task.assigneeNames.length - 1}</span> : null}
            </span>
          ) : null}
        </span>
      }
    />
  );
}
