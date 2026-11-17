import { nextZonedDayStart, zonedParts, zonedWallTime } from "@/lib/zoned-time";

/**
 * The minutes between two instants that fall inside the company's working hours (Q1.5: a ticket's «hours before a reminder» are working hours, not
 * clock hours). The window is `from`–`to` (`HH:MM`) in the company's time zone, every day except the days off (0 = Sunday … 6 = Saturday). Pure.
 */
export interface WorkWindow {
  from: string;
  to: string;
  daysOff: readonly number[];
}

const MAX_DAYS = 62;

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function workedMinutes(start: Date, end: Date, window: WorkWindow, timeZone: string): number {
  if (end.getTime() <= start.getTime()) return 0;
  const open = minutesOf(window.from);
  const close = minutesOf(window.to);
  if (close <= open) return 0;
  let total = 0;
  let cursor = start;
  for (let i = 0; i < MAX_DAYS && cursor.getTime() < end.getTime(); i++) {
    const p = zonedParts(cursor, timeZone);
    const dayEnd = nextZonedDayStart(cursor, timeZone);
    if (!window.daysOff.includes(p.weekday)) {
      const opens = zonedWallTime({ year: p.year, month: p.month, day: p.day, hour: Math.floor(open / 60), minute: open % 60 }, timeZone).getTime();
      const closes = zonedWallTime({ year: p.year, month: p.month, day: p.day, hour: Math.floor(close / 60), minute: close % 60 }, timeZone).getTime();
      const from = Math.max(start.getTime(), opens);
      const to = Math.min(end.getTime(), closes);
      if (to > from) total += Math.round((to - from) / 60_000);
    }
    cursor = dayEnd;
  }
  return total;
}
