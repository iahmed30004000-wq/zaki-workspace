"use client";

import { CalendarGrid, type CalTask } from "@/components/calendar-grid";
import { monthName } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import type { WorkTaskDto } from "@/lib/work/my-tasks";

/** `YYYY-MM` shifted by `delta` months. */
export function shiftYearMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + delta, 1)).toISOString().slice(0, 7);
}

/**
 * «تقويم»: the month the person's tasks are due in (the open ones), on the company's calendar. A task moves to another day by dragging; a click opens the
 * side panel. The month arrows change the month in the address, and the screen fetches that month.
 */
export function TaskCalendar({
  tasks,
  month,
  todayIso,
  timeZone,
  editable,
  onMonth,
  onReschedule,
  onOpen,
}: {
  tasks: readonly WorkTaskDto[];
  month: string;
  todayIso: string;
  timeZone: string;
  editable: boolean;
  onMonth: (month: string) => void;
  onReschedule: (taskId: string, dayIso: string) => void;
  onOpen: (taskId: string) => void;
}) {
  const { t } = useI18n();
  const cells: CalTask[] = tasks.filter((task) => task.dueDate !== null).map((task) => ({ id: task.id, key: task.key, title: task.title, dueDate: task.dueDate! }));
  const title = `${monthName(Number(month.slice(5, 7)) - 1)} ${month.slice(0, 4)}`;
  const arrow = "inline-grid size-9 place-items-center rounded-full text-base text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg";
  return (
    <div aria-label={t("mytasks.cal.aria")}>
      <nav className="mb-3 mt-2 flex items-center justify-center gap-1" aria-label={t("cal.title")}>
        <button type="button" className={arrow} aria-label={t("cal.prev")} onClick={() => onMonth(shiftYearMonth(month, -1))}>
          ›
        </button>
        <span className="min-w-32 px-2 text-center text-[15px] font-bold text-fg">{title}</span>
        <button type="button" className={arrow} aria-label={t("cal.next")} onClick={() => onMonth(shiftYearMonth(month, 1))}>
          ‹
        </button>
      </nav>
      <div className="flex min-h-[32rem] flex-col overflow-x-auto">
        <CalendarGrid month={month} tasks={cells} todayIso={todayIso} editable={editable} timeZone={timeZone} onReschedule={onReschedule} onOpen={onOpen} />
        {cells.length === 0 ? <p className="px-2 pt-3 text-center text-[13px] text-muted">{t("cal.empty")}</p> : null}
      </div>
    </div>
  );
}
