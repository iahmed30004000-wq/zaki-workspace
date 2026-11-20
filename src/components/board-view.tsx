"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  useDroppable,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  closestCorners,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, MessageSquare, CalendarDays, GripVertical, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ApiError, apiGet, apiPatch, apiPost, apiDelete } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/card";
import { peopleLine } from "@/components/ui/people-multi";
import { PRIORITY_STYLES, fmtDMY, fmtRelative, isOverdue } from "@/lib/format";
import { columnLabel, enumLabel } from "@/lib/i18n/enums";
import { useToast } from "@/components/ui/toast";
import { StepProgressChip } from "@/components/task-steps/step-progress";
import { RunningChip } from "@/components/time/running-chip";
import { RecurringBadge } from "@/components/recurrence/recurring-badge";
import type { StepProgress } from "@/lib/task-steps";
import { PinMark, RewardBadge } from "@/components/rewards/reward-badge";
import { FieldChipPicker, FieldChips, type PickerDef } from "@/components/custom-fields/field-chips";
import { FIELDS_ANCHOR, requiredFieldsOf } from "@/lib/custom-fields";
import type { FieldCell } from "@/lib/custom-fields-display";
import { rt } from "@/lib/reminders/client";
import { WORK_STAGES, stageOrDefault, type WorkStage } from "@/lib/work/stage";

export interface ColumnData {
  id: string;
  name: string;
  color: string;
  position: number;
  done: boolean;
  /** W1.3: the normalized stage; the board screen reads it itself (`GET /api/boards/[id]/columns`) while the switch is on. */
  stage?: string;
}

export interface TaskCardData {
  id: string;
  key: string;
  title: string;
  priority: string;
  columnId: string;
  dueDate: string | null;
  labels: { id: string; name: string; color: string }[];
  assignee: { id: string; name: string } | null;
  /** Every person the task is for («لمين» with more than one), the primary first; absent means one. */
  assigneeNames?: string[];
  commentCount: number;
  completed: boolean;
  /** «٣ من ٥»: the task's checklist progress; absent when it has no steps or the company's «الخطوات» switch is off. */
  steps?: StepProgress;
  /** «حقول مخصصة»: the task's answers as chips, by field id; absent for a partner or while the switch is off. */
  fields?: Record<string, FieldCell>;
  /** «الوقت شغّال»: the viewer's own timer runs on this task (only while the company's «حساب الوقت» switch is on). */
  running?: boolean;
  /** «🔁 متكررة»: the task belongs to a running series; absent when it does not or the company's «مهمة متكررة» switch is off. */
  recurring?: boolean;
  /** «مهمة بمكافأة»: only for a viewer who may see rewards (the board of a partner carries none). */
  reward?: { status: string; amountMinor: number; currency: string } | null;
  /** «تثبيت»: the task is pinned (and the company's switch is on). */
  pinned?: boolean;
}

interface BoardViewProps {
  board: { id: string; workspaceId: string; projectId: string; name: string; projectName: string };
  columns: ColumnData[];
  tasks: TaskCardData[];
  canEdit: boolean;
  /** «حقول مخصصة»: the fields the person may pick to show on the cards (empty: no picker). */
  fieldDefs?: PickerDef[];
}

/** W1.3: what `GET /api/boards/[id]/columns` answers - the stages, whether the company's switch `workStages` is on, whether the viewer is a space manager. */
interface StageInfo {
  columns: { id: string; stage: string }[];
  stagesOn: boolean;
  canSetStage: boolean;
}

interface QuickAddState {
  columnId: string | null;
  title: string;
  error: string | null;
}

/** Kanban board. Optimistic DnD with server rollback on failure. */
export function BoardView({ board, columns, tasks, canEdit, fieldDefs = [] }: BoardViewProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [items, setItems] = useState<TaskCardData[]>(tasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [quick, setQuick] = useState<QuickAddState>({ columnId: null, title: "", error: null });
  const queryClient = useQueryClient();

  // W1.3: the choice of a column's stage is offered to a space manager while the company's switch `workStages` is on; the board page
  // does not carry it, so the screen asks (only a person who can edit asks)
  const stageQuery = useQuery({
    queryKey: ["board-stages", board.id],
    queryFn: () => apiGet<StageInfo>(`/api/boards/${board.id}/columns`),
    enabled: canEdit,
    staleTime: 60_000,
  });
  const stagesOn = canEdit && stageQuery.data?.stagesOn === true && stageQuery.data.canSetStage === true;
  const stageById = useMemo(() => new Map((stageQuery.data?.columns ?? []).map((c) => [c.id, stageOrDefault(c.stage)])), [stageQuery.data]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const moveMutation = useMutation({
    mutationFn: (input: { taskId: string; columnId: string; index: number }) =>
      apiPost<{ task: unknown }>(`/api/tasks/${input.taskId}/move`, {
        columnId: input.columnId,
        index: input.index,
      }),
  });

  const tasksByColumn = useMemo(() => {
    const map = new Map<string, TaskCardData[]>();
    for (const c of columns) map.set(c.id, []);
    for (const t of items) map.get(t.columnId)?.push(t);
    return map;
  }, [columns, items]);

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    if (!e.over || !canEdit) return;

    const activeTaskId = String(e.active.id);
    const overId = String(e.over.id);

    // drop target: column id directly, or a card inside a column
    const targetColumnId = columns.some((c) => c.id === overId)
      ? overId
      : items.find((t) => t.id === overId)?.columnId;
    if (!targetColumnId) return;

    const colTasks = items.filter((t) => t.columnId === targetColumnId && t.id !== activeTaskId);
    const index = columns.some((c) => c.id === overId)
      ? colTasks.length
      : Math.max(0, colTasks.findIndex((t) => t.id === overId));

    // optimistic move
    const previous = items;
    setItems(items.map((t) => (t.id === activeTaskId ? { ...t, columnId: targetColumnId } : t)));

    moveMutation.mutate(
      { taskId: activeTaskId, columnId: targetColumnId, index },
      {
        onError: (err) => {
          // rollback — never show success when the server rejected the move
          setItems(previous);
          queryClient.invalidateQueries({ queryKey: ["board"] });
          // «حقول مخصصة»: finishing needs the project's required fields: say which, and open the task where they are filled
          const missing = requiredFieldsOf(err);
          if (missing) {
            toast(rt("fields.required_toast", { labels: missing.map((m) => m.label).join("، ") }), "error");
            window.location.assign(`/tasks/${activeTaskId}#${FIELDS_ANCHOR}`);
            return;
          }
          toast(t("board.moveFailed"), "error");
          setQuick((q) => ({ ...q, error: t("board.moveFailed") }));
          window.setTimeout(
            () => setQuick((q) => ({ ...q, error: null })),
            2500,
          );
        },
      },
    );
  }

  async function addTask(columnId: string) {
    const title = quick.title.trim();
    if (!title) {
      setQuick({ columnId: null, title: "", error: null });
      return;
    }
    setQuick((q) => ({ ...q, error: null }));
    try {
      await apiPost<{ task: unknown }>("/api/tasks", {
        workspaceId: board.workspaceId,
        projectId: board.projectId,
        boardId: board.id,
        columnId,
        title,
      });
      setQuick({ columnId: null, title: "", error: null });
      window.location.reload(); // server page refetch keeps DB authoritative
    } catch {
      toast(t("task.createFailed"), "error");
      setQuick((q) => ({ ...q, error: t("task.createFailed") }));
    }
  }

  const addColumn = useMutation({
    mutationFn: () =>
      apiPost<{ column: unknown }>(`/api/boards/${board.id}/columns`, {
        name: t("board.columnName"),
      }),
    onSuccess: () => window.location.reload(),
    onError: () => toast(t("common.error"), "error"),
  });

  const activeTask = items.find((t) => t.id === activeId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
        <div>
          <h1 className="text-base font-semibold text-fg">{board.name}</h1>
          <p className="text-xs text-fg-muted">{board.projectName}</p>
        </div>
        <FieldChipPicker defs={fieldDefs} />
      </header>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
          {columns.map((column) => {
            const colTasks = tasksByColumn.get(column.id) ?? [];
            return (
              <BoardColumn
                key={column.id}
                column={column}
                tasks={colTasks}
                canEdit={canEdit}
                boardId={board.id}
                stage={stagesOn ? (stageById.get(column.id) ?? stageOrDefault(column.stage)) : null}
                quick={quick}
                onOpenQuick={() =>
                  setQuick(
                    quick.columnId === column.id
                      ? { columnId: null, title: "", error: null }
                      : { columnId: column.id, title: "", error: null },
                  )
                }
                onTitleChange={(title) => setQuick((q) => ({ ...q, title }))}
                onCancel={() => setQuick({ columnId: null, title: "", error: null })}
                onSubmit={() => void addTask(column.id)}
              />
            );
          })}

          {canEdit ? (
            <button
              onClick={() => addColumn.mutate()}
              disabled={addColumn.isPending}
              className="flex h-9 w-72 min-w-72 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-xs text-muted transition-colors hover:border-accent/50 hover:text-fg"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("board.addColumn")}
            </button>
          ) : null}
        </div>

        <DragOverlay>
          {activeTask ? (
            <div className="w-64 cursor-grabbing opacity-90">
              <TaskCardContent task={activeTask} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

function BoardColumn({
  column,
  tasks,
  canEdit,
  boardId,
  stage,
  quick,
  onOpenQuick,
  onTitleChange,
  onCancel,
  onSubmit,
}: {
  column: ColumnData;
  tasks: TaskCardData[];
  canEdit: boolean;
  boardId: string;
  /** W1.3: the column's stage while the picker is offered (switch on, space manager); null: no picker. */
  stage: WorkStage | null;
  quick: QuickAddState;
  onOpenQuick: () => void;
  onTitleChange: (t: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const setStage = useMutation({
    mutationFn: (next: WorkStage) => apiPatch<{ column: { stage: string } }>(`/api/boards/${boardId}/columns/${column.id}`, { stage: next }),
    onSuccess: (answer) => {
      // the select shows the saved stage at once; the refetch below makes the server the authority
      queryClient.setQueryData<StageInfo>(["board-stages", boardId], (old) =>
        old ? { ...old, columns: old.columns.map((c) => (c.id === column.id ? { ...c, stage: answer.column.stage } : c)) } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ["board-stages", boardId] });
      toast(t("work.stage.saved"), "success");
    },
    onError: (err) => {
      const key = err instanceof ApiError && err.messageKey ? err.messageKey : "common.error";
      toast(t(key), "error");
    },
  });
  const deleteColumn = useMutation({
    mutationFn: () => apiDelete(`/api/boards/${boardId}/columns/${column.id}`),
    onSuccess: () => window.location.reload(),
    // a refused delete (a column that still holds cards, 409) was SILENT: say why, in the column
    onError: (err) => {
      const key = err instanceof ApiError && err.messageKey ? err.messageKey : "common.error";
      toast(t(key), "error");
    },
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-72 min-w-72 shrink-0 flex-col rounded-xl border border-border bg-surface-1",
        isOver && "border-accent/60",
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="flex items-center gap-2 text-xs font-semibold text-fg">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: column.color }}
          />
          {columnLabel(column.name)}
          <span className="font-normal text-muted">{tasks.length}</span>
        </span>
        {canEdit ? (
          <span className="flex items-center gap-0.5">
            <button
              aria-label={t("task.new")}
              className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg"
              onClick={onOpenQuick}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              aria-label={t("common.delete")}
              title={t("board.deleteColumn")}
              className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-danger"
              onClick={() => {
                if (window.confirm(t("board.deleteColumnConfirm"))) deleteColumn.mutate();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </span>
        ) : null}
      </div>

      {stage ? (
        <label className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted">
          <span className="shrink-0">{t("work.stage.label")}</span>
          <select
            value={stage}
            disabled={setStage.isPending}
            aria-label={rt("work.stage.aria", { name: columnLabel(column.name) })}
            title={t("work.stage.hint")}
            onChange={(e) => setStage.mutate(e.currentTarget.value as WorkStage)}
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-1 text-xs text-fg disabled:opacity-50"
          >
            {WORK_STAGES.map((value) => (
              <option key={value} value={value}>
                {enumLabel("WorkStage", value)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="min-h-16 flex-1 space-y-2 overflow-y-auto p-2">
        {quick.columnId === column.id ? (
          <form
            className="rounded-lg border border-accent/50 bg-surface p-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              onSubmit();
            }}
          >
            <Input
              autoFocus
              value={quick.title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder={t("task.title")}
              className="h-8 text-xs"
              maxLength={280}
            />
            {quick.error ? <p className="mt-1 text-xs text-danger">{quick.error}</p> : null}
            <div className="mt-2 flex gap-1">
              <Button type="submit" size="sm" className="flex-1">
                {t("common.add")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={onCancel} aria-label={t("common.cancel")}>
                ✕
              </Button>
            </div>
          </form>
        ) : null}

        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </SortableContext>

        {tasks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted">
            {t("board.dropHere")}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: TaskCardData }) {
  const { t } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
    >
      <div className="flex items-start gap-1">
        <button
          className="mt-2 cursor-grab touch-none text-muted/60 hover:text-fg"
          aria-label={t("board.dragTask")}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-0 flex-1">
          <Link href={`/tasks/${task.id}`} className="block">
            <TaskCardContent task={task} />
          </Link>
        </div>
      </div>
    </div>
  );
}

function TaskCardContent({ task }: { task: TaskCardData }) {
  const { t } = useI18n();
  const overdue = task.dueDate && isOverdue(task.dueDate) && !task.completed;
  return (
    <div className="rounded-lg border border-border bg-surface p-2.5 shadow-sm transition-colors hover:border-accent/40">
      <div className="flex items-center gap-1.5">
        <span dir="ltr" className="font-mono text-xs text-muted">{task.key}</span>
        {overdue ? <span className="text-xs font-medium text-danger">{t("dash.overdue")}</span> : null}
        {task.pinned ? <PinMark className="ms-auto" /> : null}
      </div>
      <p className={cn("mt-1 text-xs font-medium text-fg", task.completed && "line-through opacity-60")}>
        {task.title}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {task.labels.slice(0, 3).map((l) => (
          <Badge key={l.id} color={l.color}>
            {l.name}
          </Badge>
        ))}
        <RewardBadge reward={task.reward} />
        <span
          className="ms-auto h-3 w-3 rounded-full"
          title={enumLabel("TaskPriority", task.priority)}
          style={{ backgroundColor: PRIORITY_STYLES[task.priority]?.color ?? "rgb(var(--border))" }}
        />
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
        <span className="truncate">
          {task.assigneeNames?.length
            ? peopleLine(task.assigneeNames, t("common.and"))
            : task.assignee?.name ?? t("list.unassigned")}
        </span>
        {task.dueDate ? (
          <span
            title={fmtDMY(task.dueDate)}
            suppressHydrationWarning
            className={cn(
              "flex shrink-0 items-center gap-1",
              overdue ? "text-danger" : undefined,
            )}
          >
            <CalendarDays className="h-3 w-3" />
            {fmtRelative(task.dueDate)}
          </span>
        ) : null}
        {task.commentCount > 0 ? (
          <span className="flex shrink-0 items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {task.commentCount}
          </span>
        ) : null}
        <StepProgressChip progress={task.steps} />
        <RunningChip running={task.running} />
        <RecurringBadge recurring={task.recurring} />
      </div>
      <FieldChips cells={task.fields} block />
    </div>
  );
}
