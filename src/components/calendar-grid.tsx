"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiPatch } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { useI18n } from "@/lib/i18n";
import { weekdayName } from "@/lib/format";
import { dayOfInstant } from "@/lib/due-day";

export interface CalTask {
  id: string;
  key: string;
  title: string;
  dueDate: string;
}

/**
 * Month grid with drag-to-reschedule. Drops persist via PATCH /api/tasks/[id] and re-draw the server page, unless the screen that owns the grid
 * hands in `onReschedule` (W1.1 «مهامي»: an optimistic change of its own cache) — then the drop is THAT function's job. `onOpen` makes a task chip
 * open the screen's side panel instead of doing nothing.
 */
export function CalendarGrid({
  month,
  tasks,
  todayIso,
  editable,
  timeZone,
  onReschedule,
  onOpen,
}: {
  month: string; // YYYY-MM
  tasks: CalTask[];
  todayIso: string;
  editable: boolean;
  /** The company's zone: tasks land in the day it says, not the browser's. */
  timeZone: string;
  onReschedule?: (taskId: string, dayIso: string) => void;
  onOpen?: (taskId: string) => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const [year, monthIdx] = (() => {
    const [y, m] = month.split("-").map(Number);
    if (!y || !m || m < 1 || m > 12) {
      const now = new Date();
      return [now.getUTCFullYear(), now.getUTCMonth() + 1];
    }
    return [y, m];
  })();
  const first = new Date(Date.UTC(year, monthIdx - 1, 1));
  const startOffset = first.getUTCDay(); // Sunday-start grid
  const dayCount = new Date(Date.UTC(year, monthIdx, 0)).getUTCDate();

  const byDay = new Map<string, CalTask[]>();
  for (const task of tasks) {
    // the company's day for this instant (the server already cut the month there too)
    const key = dayOfInstant(task.dueDate, timeZone);
    const arr = byDay.get(key) ?? [];
    arr.push(task);
    byDay.set(key, arr);
  }

  const weekdayLabels = Array.from({ length: 7 }, (_, i) => weekdayName(i));

  async function handleDrop(taskId: string, dayIso: string) {
    setDragId(null);
    setOverKey(null);
    if (onReschedule) {
      onReschedule(taskId, dayIso);
      return;
    }
    try {
      // the day the card was dropped on, as a day: the server makes it noon in the COMPANY's zone (review B5)
      await apiPatch(`/api/tasks/${taskId}`, { dueDate: dayIso });
      toast(t("task.updated"), "success");
      router.refresh();
    } catch {
      toast(t("common.error"), "error");
    }
  }

  const cells: { iso: string; day: number; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(Date.UTC(year, monthIdx - 1, 1 - startOffset + i));
    cells.push({
      iso: d.toISOString().slice(0, 10),
      day: d.getUTCDate(),
      inMonth: (i - startOffset) >= 0 && d.getUTCMonth() === monthIdx - 1,
    });
    if (i - startOffset >= dayCount) {
      cells.pop();
      break;
    }
  }

  return (
    <div className="flex h-full min-h-0 min-w-[40rem] flex-col">
      <div className="grid grid-cols-7 gap-1.5 pb-1.5 text-center text-[12.5px] font-semibold text-fg-muted">
        {weekdayLabels.map((lbl) => (
          <div key={lbl} className="py-1">
            {lbl}
          </div>
        ))}
      </div>
      <div className="grid flex-1 auto-rows-fr grid-cols-7 gap-1.5 overflow-y-auto">
        {cells.map((cell) => {
          const dayTasks = byDay.get(cell.iso) ?? [];
          const isToday = cell.iso === todayIso;
          return (
            <div
              key={cell.iso}
              onDragOver={(e) => {
                if (!editable || !dragId) return;
                e.preventDefault();
                setOverKey(cell.iso);
              }}
              onDrop={() => {
                if (editable && dragId) handleDrop(dragId, cell.iso);
              }}
              className={cn(
                "flex min-h-24 min-w-0 flex-col gap-1 rounded-xl bg-surface-1 p-2",
                !cell.inMonth && "opacity-40",
                isToday && "ring-2 ring-inset ring-accent",
                overKey === cell.iso && "bg-surface-2",
              )}
            >
              <span className={cn("px-0.5 text-[12.5px] font-semibold text-fg-muted", isToday && "font-bold text-accent")}>
                {cell.day}
              </span>
              <div className="flex-1 space-y-1">
                {dayTasks.slice(0, 3).map((task) => (
                  <div
                    key={task.id}
                    draggable={editable}
                    onDragStart={() => setDragId(task.id)}
                    onDragEnd={() => setDragId(null)}
                    title={task.title}
                    onClick={onOpen ? () => onOpen(task.id) : undefined}
                    className={cn(
                      "cursor-default truncate rounded-[7px] bg-accent/10 px-1.5 py-0.5 text-[12.5px] font-semibold text-accent",
                      onOpen && "cursor-pointer hover:bg-accent/20",
                      editable && "cursor-grab active:cursor-grabbing",
                      dragId === task.id && "opacity-40",
                    )}
                  >
                    <span className="font-mono opacity-70">{task.key}</span> {task.title}
                  </div>
                ))}
                {dayTasks.length > 3 ? (
                  <p className="px-1 text-[12.5px] text-muted">+{dayTasks.length - 3}</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
