"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Lock } from "lucide-react";
import { apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { PRIORITY_STYLES, fmtDMY, fmtRelative } from "@/lib/format";
import { dayOfInstant } from "@/lib/due-day";
import { columnLabel, enumLabel } from "@/lib/i18n/enums";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { peopleLine } from "@/components/ui/people-multi";
import { cn } from "@/lib/utils";
import { StepProgressChip } from "@/components/task-steps/step-progress";
import { RunningChip } from "@/components/time/running-chip";
import { RecurringBadge } from "@/components/recurrence/recurring-badge";
import type { StepProgress } from "@/lib/task-steps";
import { PinMark, RewardBadge, type RewardBadgeData } from "@/components/rewards/reward-badge";
import { FieldChips } from "@/components/custom-fields/field-chips";
import { FIELDS_ANCHOR, requiredFieldsOf } from "@/lib/custom-fields";
import type { FieldCell } from "@/lib/custom-fields-display";
import { rt } from "@/lib/reminders/client";
import { AutoMark } from "@/components/work/stale/auto-mark";

import Link from "next/link";
export interface RowTask {
  id: string;
  key: string;
  title: string;
  priority: string;
  dueDate: Date | string | null;
  completedAt: Date | string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  /** Every person the task is for, in order (the first is `assigneeId`); absent means one person. */
  assigneeIds?: string[];
  /** The same people by name, the primary first — what the row shows when there is more than one. */
  assigneeNames?: string[];
  projectName?: string;
  columnName?: string;
  /** The due day as the company reads it (`YYYY-MM-DD`) — what the date box shows; without it the row derives it in the company's zone. */
  dueDay?: string | null;
  /** «٣ من ٥»: the checklist progress; absent when the task has no steps or the «الخطوات» switch is off. */
  steps?: StepProgress;
  /** «الوقت شغّال»: the viewer's own timer runs on this task (only while the company's «حساب الوقت» switch is on). */
  running?: boolean;
  /** «🔁 متكررة»: the task belongs to a running series; absent when it does not or the company's «مهمة متكررة» switch is off. */
  recurring?: boolean;
  /** «مهمة بمكافأة»: only for a viewer who may see rewards (a partner's rows carry none). */
  reward?: { status: string; amountMinor: number; currency: string } | null;
  /** «تثبيت»: when it was pinned (absent: not pinned, or the switch is off). */
  pinnedAt?: Date | string | null;
  /** «مين بيشوفها؟»: PARTICIPANTS draws a lock. */
  visibility?: string;
  /** «آلي» (W1.9, D-W4): the task came in through the door from another system or an agent (`Task.apiTokenId` is set); absent or false draws nothing. */
  automated?: boolean;
  /** «حقول مخصصة»: the task's answers as chips, by field id; absent for a partner or while the switch is off (the person's own choice picks which to draw). */
  fields?: Record<string, FieldCell>;
}

export interface RowMember {
  id: string;
  name: string;
}

/** Compact inline-actionable task row; same data everywhere (My Work / List). */
export function TaskRow({
  task,
  members,
  editable,
  showProject = false,
  showColumn = false,
  timeZone,
}: {
  task: RowTask;
  members?: RowMember[];
  editable: boolean;
  showProject?: boolean;
  showColumn?: boolean;
  /** The company's zone: the day a person picks is that zone's day, never the browser's (review B5). */
  timeZone: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const done = task.completedAt != null;
  const [busy, setBusy] = useState(false);
  const priorityColor = PRIORITY_STYLES[task.priority]?.color ?? "rgb(var(--border))";

  function fail(err: unknown) {
    // «حقول مخصصة»: finishing needs the project's required fields: say which and open the task where they are filled
    const missing = requiredFieldsOf(err);
    if (missing) {
      toast(rt("fields.required_toast", { labels: missing.map((m) => m.label).join("، ") }), "error");
      router.push(`/tasks/${task.id}#${FIELDS_ANCHOR}`);
      return;
    }
    const code = err instanceof ApiError ? err.code : "internal";
    toast(code === "forbidden" ? t("forbidden") : t("common.error"), "error");
  }

  async function toggleComplete() {
    if (busy) return;
    setBusy(true);
    try {
      await apiPost(`/api/tasks/${task.id}/complete`, { complete: !done });
      toast(t("task.updated"), "success");
      router.refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function changeDue(value: string) {
    if (busy) return;
    setBusy(true);
    try {
      // the day as picked (`YYYY-MM-DD`): the server turns it into noon in the COMPANY's zone. Building the
      // instant here meant the browser's clock decided which day was saved (review B5).
      await apiPatch(`/api/tasks/${task.id}`, {
        dueDate: value === "" ? null : value,
      });
      toast(t("task.updated"), "success");
      router.refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function changeAssignee(value: string) {
    if (busy) return;
    setBusy(true);
    try {
      // «لمين» with more than one person: the box picks the primary, and the people already beside them
      // stay on the task — the whole ordered list is sent, never a bare `assigneeId` that would drop them.
      const others = (task.assigneeIds ?? []).filter((id) => id !== (task.assigneeId ?? ""));
      await apiPatch(`/api/tasks/${task.id}`, { assigneeIds: value === "" ? others : [value, ...others.filter((id) => id !== value)] });
      toast(t("task.updated"), "success");
      router.refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const dueValue = task.dueDay ?? (task.dueDate ? dayOfInstant(task.dueDate, timeZone) : "");

  return (
    <li className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2">
      <button
        type="button"
        disabled={!editable || busy}
        onClick={toggleComplete}
        aria-label={done ? t("task.reopen") : t("task.complete")}
        title={done ? t("task.reopen") : t("task.complete")}
        className={cn(
          "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors",
          done
            ? "border-ok bg-ok text-ok-fg"
            : "border-muted/50 hover:border-ok",
          (!editable || busy) && "opacity-40",
        )}
      >
        {done ? <Check className="h-3 w-3" /> : null}
      </button>

      <Link href={`/tasks/${task.id}`} className="flex min-w-0 flex-1 items-center gap-2">
        <span dir="ltr" className="shrink-0 font-mono text-xs text-muted">{task.key}</span>
        <span className={cn("truncate text-sm", done ? "text-muted line-through" : "text-fg")}>
          {task.title}
        </span>
        {task.visibility === "PARTICIPANTS" ? <Lock className="h-3 w-3 shrink-0 text-fg-muted" aria-label={t("taskpriv.lock")} /> : null}
        {task.automated ? <AutoMark /> : null}
        {showProject && task.projectName ? (
          <span className="hidden shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted md:inline">
            {task.projectName}
          </span>
        ) : null}
        {showColumn && task.columnName ? (
          <span className="hidden shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted md:inline">
            {columnLabel(task.columnName)}
          </span>
        ) : null}
        <StepProgressChip progress={task.steps} />
        <RunningChip running={task.running} />
        <RecurringBadge recurring={task.recurring} />
        {task.pinnedAt ? <PinMark /> : null}
        <RewardBadge reward={task.reward as RewardBadgeData | null | undefined} />
        <FieldChips cells={task.fields} />
      </Link>

      <span
        role="img"
        aria-label={`${t("task.priority")}: ${enumLabel("TaskPriority", task.priority)}`}
        title={enumLabel("TaskPriority", task.priority)}
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: priorityColor }}
      />

      {editable ? (
        <input
          type="date"
          aria-label={t("task.due")}
          defaultValue={dueValue}
          onChange={(e) => changeDue(e.target.value)}
          className="w-28 shrink-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-fg-muted hover:border-border focus:border-border focus:outline-none"
        />
      ) : (
        <span
          className="w-28 shrink-0 text-xs text-fg-muted"
          title={task.dueDate ? fmtDMY(task.dueDate) : undefined}
          suppressHydrationWarning
        >
          {task.dueDate ? fmtRelative(task.dueDate) : ""}
        </span>
      )}

      {members && editable ? (
        <select
          aria-label={t("task.assignee")}
          value={task.assigneeId ?? ""}
          disabled={busy}
          onChange={(e) => changeAssignee(e.target.value)}
          className="max-w-28 shrink-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-fg-muted hover:border-border focus:border-border focus:outline-none"
        >
          <option value="">{t("list.unassigned")}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      ) : (
        <span
          className="w-20 shrink-0 truncate text-xs text-muted"
          title={task.assigneeNames?.length ? task.assigneeNames.join("، ") : (task.assigneeName ?? "")}
        >
          {task.assigneeNames?.length ? peopleLine(task.assigneeNames, t("common.and")) : task.assigneeName ?? ""}
        </span>
      )}
    </li>
  );
}
