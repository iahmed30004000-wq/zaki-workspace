/**
 * S5.7 (c) — the calendar of the date jump, pure. A tap on the floating date chip opens a small month sheet; a day that holds no message the person can see is closed
 * (the server lists them: `GET …/messages?days=YYYY-MM&tz=`), and a day that does jumps to its first message through the history's own `jumpTo`.
 */

/** The Arabic week starts on the day numbered 6 in the Date's own numbering. */
export const WEEK_START = 6;

const pad = (n: number): string => String(n).padStart(2, "0");

/** `2026-03`: the month's key, as the server takes it. */
export const monthKeyOf = (year: number, month: number): string => `${year}-${pad(month)}`;
/** `2026-03-09`: a day's key. */
export const dayKeyOf = (year: number, month: number, day: number): string => `${year}-${pad(month)}-${pad(day)}`;

/** The month before (`-1`) or after (`1`), across the year. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12 + 12) % 12 + 1 };
}

/** The weeks of a month (1–12), each of 7 cells: a day number, or null before the 1st and after the last. */
export function monthGrid(year: number, month: number): (number | null)[][] {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = (first - WEEK_START + 7) % 7;
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The weekday of each column, as the Date's own number, the week's first day first. */
export const WEEKDAY_ORDER = [6, 0, 1, 2, 3, 4, 5] as const;

const base = (conversationId: string): string => `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`;
/** `tz` is optional: absent, the server cuts the days in the company's own clock (the one «اليوم» is counted in). */
const zoneQuery = (tz: string | undefined): string => (tz ? `&tz=${encodeURIComponent(tz)}` : "");
export const daysUrl = (conversationId: string, year: number, month: number, tz?: string): string => `${base(conversationId)}?days=${monthKeyOf(year, month)}${zoneQuery(tz)}`;
export const onDateUrl = (conversationId: string, day: string, tz?: string): string => `${base(conversationId)}?onDate=${day}${zoneQuery(tz)}`;
