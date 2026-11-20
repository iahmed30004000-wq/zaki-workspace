"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PRIORITY_STYLES, fmtRelative, fmtNumber } from "@/lib/format";
import { enumLabel } from "@/lib/i18n/enums";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { WORK_STAGES, type WorkStage } from "@/lib/work/stage";
import { groupWorkTasks, type WorkTaskDto } from "@/lib/work/my-tasks";
import { useGroupWords, type RowActions } from "./task-list";

/**
 * «لوحة»: the person's tasks grouped by STAGE (W1.3's normalized column stage), across projects — four columns in the order work travels, whatever each
 * board calls its own columns. A card moves to another stage by dragging it there or with its own «انقل لمرحلة» menu (the keyboard, a phone); the move goes
 * through the task's OWN board (the first column of that stage), so the project's rules, log and recurrence run exactly as on the project's board.
 */
export function TaskBoard({
  tasks,
  todayIso,
  timeZone,
  showSpace,
  openId,
  actions,
  onMove,
}: {
  tasks: readonly WorkTaskDto[];
  todayIso: string;
  timeZone: string;
  showSpace: boolean;
  openId: string | null;
  actions: Pick<RowActions, "onOpen" | "onToggle">;
  onMove: (id: string, stage: WorkStage) => void;
}) {
  const { t } = useI18n();
  const words = useGroupWords();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<WorkStage | null>(null);
  const columns = groupWorkTasks(tasks, "stage", words, { todayIso, timeZone, keepEmptyStages: true });

  return (
    <div className="mt-2 grid items-start gap-3 md:grid-cols-2 xl:grid-cols-4" role="group" aria-label={t("mytasks.board.aria")}>
      {columns.map((column, index) => {
        const stage = WORK_STAGES[index] as WorkStage;
        return (
          <section
            key={column.key}
            aria-label={column.label}
            data-stage={stage}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              setOverStage(stage);
            }}
            onDragLeave={() => setOverStage((current) => (current === stage ? null : current))}
            onDrop={(e) => {
              e.preventDefault();
              const id = dragId;
              setDragId(null);
              setOverStage(null);
              const moved = id ? tasks.find((x) => x.id === id) : undefined;
              if (id && moved && moved.columnStage !== stage) onMove(id, stage);
            }}
            className={cn("flex min-h-40 flex-col rounded-2xl bg-surface-2 p-2", overStage === stage && "ring-2 ring-accent/40")}
          >
            <h2 className="mb-2 flex items-center justify-between gap-2 px-1.5 py-1 text-[13.5px] font-bold text-fg">
              {column.label}
              <Badge tone="accent">{fmtNumber(column.tasks.length)}</Badge>
            </h2>
            {column.tasks.length === 0 ? <p className="px-1 py-6 text-center text-[13px] text-muted">{t("mytasks.empty.board")}</p> : null}
            <div className="space-y-2">
              {column.tasks.map((task) => (
                <article
                  key={task.id}
                  data-task-card={task.id}
                  draggable={task.editable}
                  onDragStart={() => setDragId(task.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverStage(null);
                  }}
                  className={cn(
                    "rounded-[10px] bg-surface-1 px-2.5 py-2 text-sm shadow-card",
                    task.editable && "cursor-grab active:cursor-grabbing",
                    dragId === task.id && "opacity-40",
                    task.id === openId && "ring-2 ring-accent",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      disabled={!task.editable}
                      onClick={() => actions.onToggle(task.id, task.completedAt === null)}
                      aria-label={task.completedAt ? t("task.reopen") : t("task.complete")}
                      className={cn(
                        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                        task.completedAt ? "border-ok bg-ok text-ok-fg" : "border-badge-muted hover:border-ok",
                        !task.editable && "opacity-40",
                      )}
                    >
                      {task.completedAt ? <Check className="size-3" aria-hidden /> : null}
                    </button>
                    <a
                      href={`/tasks/${task.id}`}
                      onClick={(e) => {
                        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                        e.preventDefault();
                        actions.onOpen(task.id);
                      }}
                      className={cn("min-w-0 flex-1 break-words font-medium hover:underline", task.completedAt && "text-fg-muted line-through")}
                    >
                      {task.title}
                    </a>
                    <span
                      role="img"
                      aria-label={`${t("task.priority")}: ${enumLabel("TaskPriority", task.priority)}`}
                      className="mt-1.5 size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: PRIORITY_STYLES[task.priority]?.color ?? "rgb(var(--border))" }}
                    />
                  </div>
                  <p dir="auto" className="mt-1 truncate text-[13px] text-fg-muted">
                    {[task.key, ...(showSpace ? [task.spaceName] : []), task.projectName].join(" · ")}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[13px] text-fg-muted">
                    <span suppressHydrationWarning>{task.dueDate ? fmtRelative(task.dueDate) : ""}</span>
                    {task.editable ? (
                      <select
                        aria-label={t("mytasks.board.move")}
                        value={task.columnStage}
                        onChange={(e) => onMove(task.id, e.target.value as WorkStage)}
                        className="max-w-32 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-[13px] hover:border-border focus:border-border focus:outline-none"
                      >
                        {WORK_STAGES.map((s) => (
                          <option key={s} value={s}>
                            {words.stage(s)}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
