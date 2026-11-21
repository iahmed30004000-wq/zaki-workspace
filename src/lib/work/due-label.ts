import { parseDayText } from "@/lib/due-day";
import { fmtDMY, fmtShort } from "@/lib/format";
import { addDays } from "@/lib/work/my-tasks";

/**
 * The words of the date chip of a task (P2.3): a short Arabic label for a company day `YYYY-MM-DD`, never the browser's own `mm/dd/yyyy`.
 * The day before, the day itself and the day after are said in words (the three come from the dictionary, so the page and the tests share them);
 * any other day is «23 تشرين الثاني» (with the year only when it is not the year of today). Without a `todayIso` it is always the date. A text that is
 * not a day (or no day) is empty: the caller says «بدون موعد».
 */
export function dueDayLabel(day: string | null | undefined, todayIso: string | undefined, words: { today: string; tomorrow: string; yesterday: string }): string {
  const parts = day ? parseDayText(day) : null;
  if (!day || !parts) return "";
  if (todayIso && parseDayText(todayIso)) {
    if (day === todayIso) return words.today;
    if (day === addDays(todayIso, 1)) return words.tomorrow;
    if (day === addDays(todayIso, -1)) return words.yesterday;
  }
  // the local calendar date of the numbers themselves: no instant, so no clock or zone can move the day
  const date = new Date(parts.year, parts.month - 1, parts.day);
  const thisYear = todayIso ? parseDayText(todayIso)?.year : undefined;
  return thisYear === undefined || thisYear === parts.year ? fmtShort(date) : fmtDMY(date);
}
