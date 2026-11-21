"use client";

import { fmtDMY } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { dueDayLabel } from "@/lib/work/due-label";

/**
 * The due day of a task as a CHIP (P2.3): a short Arabic label («اليوم» «بكرا» «23 تشرين الثاني», or «بدون موعد») and, laid over it and invisible, the real
 * `<input type="date">`. On a phone a tap lands on the input, so the phone's own picker opens (the browser's `mm/dd/yyyy` text is never drawn); on a desktop the
 * tap calls `showPicker()`, because a desktop browser opens its picker only from the tiny calendar icon of the box. The day is still the COMPANY's
 * `YYYY-MM-DD` that the box shows and sends back. A refused change puts the old day back: the new value is a new element (`key`).
 */
export function DueDayChip({
  day,
  todayIso,
  overdue = false,
  onChange,
  className,
}: {
  /** The day now (`YYYY-MM-DD`), or null for «بدون موعد». */
  day: string | null;
  /** The company's today: it is what makes «اليوم» and «بكرا» words; without it the chip always says the date. */
  todayIso?: string;
  /** An open task due before today wears its day in the danger colour. */
  overdue?: boolean;
  /** The picked day, or null when the box was cleared. */
  onChange: (day: string | null) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const label = dueDayLabel(day, todayIso, { today: t("mytasks.due.today"), tomorrow: t("mytasks.due.tomorrow"), yesterday: t("time.yesterday") }) || t("mytasks.due.none");
  return (
    <label
      title={day ? fmtDMY(new Date(`${day}T12:00:00`)) : undefined}
      className={cn(
        "relative inline-flex min-h-9 min-w-11 shrink-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-lg px-2 text-[13px] font-medium transition-colors hover:bg-surface-2 focus-within:bg-surface-2 md:min-h-8",
        overdue ? "text-danger" : "text-fg-muted",
        className,
      )}
    >
      <span suppressHydrationWarning>{label}</span>
      <input
        key={day ?? "none"}
        type="date"
        aria-label={t("task.due")}
        defaultValue={day ?? ""}
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
