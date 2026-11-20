"use client";

import { Lock } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { ApiError } from "@/lib/api-client";
import { fmtDMY, fmtNumber } from "@/lib/format";
import { columnLabel, enumLabel } from "@/lib/i18n/enums";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useWorkTask } from "./use-work-tasks";

/**
 * The side panel (`?task=<id>`): the task beside the list, so a person reads and ticks it without leaving the screen. It holds what a row cannot — the
 * description, where it lives, who it is for — and the link to the full page `/tasks/[id]` (the steps, the time, the fields, the comments), which stays the
 * place for everything else. A task the person may not see is «ما لقينا هالمهمة»: the server answers 404 for a hidden task, never «forbidden».
 */
export function TaskPanel({
  taskId,
  onClose,
  onToggle,
  onDue,
}: {
  taskId: string | null;
  onClose: () => void;
  onToggle: (id: string, done: boolean) => void;
  onDue: (id: string, day: string | null) => void;
}) {
  const { t } = useI18n();
  const query = useWorkTask(taskId);
  const detail = query.data;
  const task = detail?.task;
  const done = task?.completedAt != null;
  const missing = query.error instanceof ApiError && query.error.status === 404;

  return (
    <Sheet open={taskId !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{task ? <span className={cn(done && "text-fg-muted line-through")}>{task.title}</span> : t("mytasks.panel.title")}</SheetTitle>
          <SheetDescription dir="ltr" className="text-start">
            {task?.key ?? ""}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {query.isPending && taskId !== null ? (
            <p role="status" className="flex items-center gap-2 py-6 text-sm text-fg-muted">
              <Spinner /> {t("mytasks.panel.loading")}
            </p>
          ) : null}
          {query.isError ? <p className="py-6 text-sm text-danger">{missing ? t("mytasks.panel.not_found") : t("mytasks.panel.error")}</p> : null}
          {detail && task ? (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!task.editable}
                  onClick={() => onToggle(task.id, !done)}
                  className="min-h-9 rounded-lg border border-border px-3 text-xs hover:bg-surface-2 disabled:opacity-40"
                >
                  {done ? t("task.reopen") : t("task.complete")}
                </button>
                {task.visibility === "PARTICIPANTS" ? (
                  <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                    <Lock className="size-3" aria-hidden /> {t("mytasks.panel.private")}
                  </span>
                ) : null}
              </div>

              <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
                <dt className="text-fg-muted">{t("work.stage.label")}</dt>
                <dd>{enumLabel("WorkStage", task.columnStage)}</dd>
                <dt className="text-fg-muted">{t("mytasks.panel.column")}</dt>
                <dd>{columnLabel(task.columnName)}</dd>
                <dt className="text-fg-muted">{t("mytasks.panel.space")}</dt>
                <dd>{task.spaceName}</dd>
                <dt className="text-fg-muted">{t("mytasks.panel.project")}</dt>
                <dd>{task.projectName}</dd>
                <dt className="text-fg-muted">{t("mytasks.panel.board")}</dt>
                <dd>{detail.boardName}</dd>
                <dt className="text-fg-muted">{t("task.priority")}</dt>
                <dd>{enumLabel("TaskPriority", task.priority)}</dd>
                <dt className="text-fg-muted">{t("task.due")}</dt>
                <dd>
                  {task.editable ? (
                    <input
                      key={task.dueDay ?? "none"}
                      type="date"
                      aria-label={t("task.due")}
                      defaultValue={task.dueDay ?? ""}
                      onChange={(e) => onDue(task.id, e.target.value === "" ? null : e.target.value)}
                      className="rounded border border-border bg-transparent px-1 py-0.5 text-sm"
                    />
                  ) : (
                    <span suppressHydrationWarning>{task.dueDate ? fmtDMY(task.dueDate) : t("mytasks.due.none")}</span>
                  )}
                </dd>
                <dt className="text-fg-muted">{t("mytasks.panel.people")}</dt>
                <dd>{task.assigneeNames.length ? task.assigneeNames.join("، ") : t("mytasks.panel.nobody")}</dd>
                <dt className="text-fg-muted">{t("mytasks.panel.creator")}</dt>
                <dd>{detail.creatorName}</dd>
              </dl>

              <div>
                <h3 className="mb-1 text-xs font-semibold text-fg-muted">{t("mytasks.panel.description")}</h3>
                {detail.description ? <p className="whitespace-pre-wrap break-words">{detail.description}</p> : <p className="text-fg-muted">{t("mytasks.panel.no_description")}</p>}
              </div>

              <p className="text-xs text-fg-muted">{t("mytasks.panel.comments", { n: fmtNumber(detail.commentCount) })}</p>

              <a href={`/tasks/${task.id}`} className="inline-block rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-fg">
                {t("mytasks.panel.open_full")}
              </a>
            </div>
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
