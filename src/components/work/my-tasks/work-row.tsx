"use client";

import * as React from "react";
import { Check, Lock } from "lucide-react";
import { ListRow } from "@/components/ui/list-row";
import { PinMark, RewardBadge, type RewardBadgeData } from "@/components/rewards/reward-badge";
import { StepProgressChip } from "@/components/task-steps/step-progress";
import { RunningChip } from "@/components/time/running-chip";
import { RecurringBadge } from "@/components/recurrence/recurring-badge";
import { PRIORITY_STYLES, fmtDMY, fmtRelative } from "@/lib/format";
import { enumLabel } from "@/lib/i18n/enums";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { WorkTaskDto } from "@/lib/work/my-tasks";

/**
 * One task of «مهامي» (W1.1) on D1's `ListRow`: a tick, the title (a link to the task's full page that opens the SIDE PANEL on a plain click, so ctrl-click and
 * «open in a new tab» still reach `/tasks/[id]`), a second line with where it lives, and the due day and the people at the end. Ticking and changing the day
 * are handed to the screen, which changes the cache at once and calls the door (optimistic).
 */
export function WorkRow({
  task,
  showSpace,
  showProject = true,
  showStage = true,
  selected = false,
  onOpen,
  onToggle,
  onDue,
}: {
  task: WorkTaskDto;
  showSpace: boolean;
  showProject?: boolean;
  showStage?: boolean;
  selected?: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string, done: boolean) => void;
  onDue: (id: string, day: string | null) => void;
}) {
  const { t } = useI18n();
  const done = task.completedAt !== null;
  const priorityColor = PRIORITY_STYLES[task.priority]?.color ?? "rgb(var(--border))";
  const parts = [task.key, ...(showSpace ? [task.spaceName] : []), ...(showProject ? [task.projectName] : []), ...(showStage ? [enumLabel("WorkStage", task.columnStage)] : [])];

  return (
    <ListRow
      role="listitem"
      data-task-row={task.id}
      selected={selected}
      leading={
        <button
          type="button"
          disabled={!task.editable}
          onClick={() => onToggle(task.id, !done)}
          aria-label={done ? t("task.reopen") : t("task.complete")}
          title={done ? t("task.reopen") : t("task.complete")}
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            done ? "border-ok bg-ok text-ok-fg" : "border-muted/50 hover:border-ok",
            !task.editable && "opacity-40",
          )}
        >
          {done ? <Check className="size-3.5" aria-hidden /> : null}
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
        </span>
      }
      trailing={
        <span className="flex items-center gap-2">
          <span
            role="img"
            aria-label={`${t("task.priority")}: ${enumLabel("TaskPriority", task.priority)}`}
            title={enumLabel("TaskPriority", task.priority)}
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: priorityColor }}
          />
          {task.editable ? (
            <input
              // a refused change puts the old day back: the new value is a new element
              key={task.dueDay ?? "none"}
              type="date"
              aria-label={t("task.due")}
              defaultValue={task.dueDay ?? ""}
              onChange={(e) => onDue(task.id, e.target.value === "" ? null : e.target.value)}
              className="w-28 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-fg-muted hover:border-border focus:border-border focus:outline-none"
            />
          ) : (
            <span className="w-28 text-xs text-fg-muted" title={task.dueDate ? fmtDMY(task.dueDate) : undefined} suppressHydrationWarning>
              {task.dueDate ? fmtRelative(task.dueDate) : ""}
            </span>
          )}
          <span className="hidden w-20 truncate text-xs text-muted md:inline" title={task.assigneeNames.join("، ")}>
            {task.assigneeNames.length > 1 ? `${task.assigneeNames[0]} +${task.assigneeNames.length - 1}` : (task.assigneeName ?? "")}
          </span>
        </span>
      }
    />
  );
}
