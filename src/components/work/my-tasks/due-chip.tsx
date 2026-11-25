"use client";

import { dueTimeText } from "@/lib/due-day";
import { fmtDMY } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { dueDayLabel } from "@/lib/work/due-label";

/**
 * The due day of a task as a CHIP (P2.3): a short Arabic label («اليوم» «بكرا» «23 تشرين الثاني», or «بدون موعد», with the hour when one was picked) and, laid
 * over it and invisible, the real `<input type="datetime-local">`. On a phone a tap lands on the input, so the phone's own picker opens (the browser's `mm/dd/yyyy` text is never drawn); on a desktop the
 * tap calls `showPicker()`, because a desktop browser opens its picker only from the tiny calendar icon of the box. The box shows and sends back the COMPANY's wall
 * clock (`YYYY-MM-DDTHH:mm`). A refused change puts the old day back: the new value is a new element (`key`).
 */
export function DueDayChip({
  day,
  wall = null,
  todayIso,
  overdue = false,
  dueToday = false,
  onChange,
  className,
}: {
  /** The day now (`YYYY-MM-DD`), or null for «بدون موعد». */
  day: string | null;
  /** The same due date as the company's wall clock (`YYYY-MM-DDTHH:mm`); absent: the day, the whole of it. */
  wall?: string | null;
  /** The company's today: it is what makes «اليوم» and «بكرا» words; without it the chip always says the date. */
  todayIso?: string;
  /** An open task that is late wears its day in the danger colour. */
  overdue?: boolean;
  /** An open task due today and not late yet wears it in amber. */
  dueToday?: boolean;
  /** The picked wall clock (`YYYY-MM-DDTHH:mm`), or null when the box was cleared. */
  onChange: (wall: string | null) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const value = wall ?? (day ? `${day}T12:00` : "");
  const words = dueDayLabel(day, todayIso, { today: t("mytasks.due.today"), tomorrow: t("mytasks.due.tomorrow"), yesterday: t("time.yesterday") });
  const time = words ? dueTimeText(value) : "";
  const label = words || t("mytasks.due.none");
  return (
    <label
      title={day ? fmtDMY(new Date(`${day}T12:00:00`)) : undefined}
      className={cn(
        "relative inline-flex min-h-9 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-1 whitespace-nowrap max-md:flex-col max-md:gap-0 max-md:leading-5 rounded-lg px-2 text-[13px] font-medium transition-colors hover:bg-surface-2 focus-within:bg-surface-2 md:min-h-8",
        overdue ? "text-danger" : dueToday ? "text-warn" : "text-fg-muted",
        className,
      )}
    >
      <span suppressHydrationWarning>{label}</span>
      {time ? <bdi className="tabular-nums">{time}</bdi> : null}
      <input
        key={value || "none"}
        type="datetime-local"
        aria-label={t("task.due")}
        defaultValue={value}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        onClick={(e) => {
          // a desktop browser opens its picker only from the box's tiny icon: ask for it (a browser that refuses, or one that already opened it, is fine)
          try {
            e.currentTarget.showPicker();
          } catch {
            // the native tap already opens it on a phone
          }
        }}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </label>
  );
}
