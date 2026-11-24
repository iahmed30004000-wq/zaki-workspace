import { z } from "zod";
import { DEFAULT_TIME_ZONE, isValidTimeZone, zonedParts } from "@/lib/zoned-time";

/**
 * «ساعات الدوام» and «أتمتة المحادثة» — the pure half. A person says on which days and between which times they work (in their own time zone), and may switch on an AWAY LINE: a
 * short text of their own that a person who writes to them in a private chat outside those hours sees as a labelled line of the conversation (never as a message in their name;
 * docs/contracts/telegram-look.md). Nothing here reads the database.
 */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

export const AWAY_TEXT_MAX = 300;
/** the zone the hours are counted in when the person has not chosen one: the company's default */
export const DEFAULT_WORK_TZ = DEFAULT_TIME_ZONE;

export const workHoursSchema = z
  .object({
    /** 0 = Sunday … 6 = Saturday, at least one */
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    from: z.string().regex(HHMM),
    to: z.string().regex(HHMM),
    tz: z.string().min(1).max(64).refine(isValidTimeZone),
  })
  .refine((h) => minutes(h.from) < minutes(h.to));
export type WorkHours = z.infer<typeof workHoursSchema>;

export const chatAutomationSchema = z
  .object({ on: z.boolean(), text: z.string().trim().max(AWAY_TEXT_MAX) })
  .refine((a) => !a.on || a.text.length > 0);
export type ChatAutomation = z.infer<typeof chatAutomationSchema>;

/** Is this moment inside the hours? The day and the time of day are read in the hours' own zone, the start is inside and the end is already out. */
export function withinWorkHours(hours: WorkHours, now: Date): boolean {
  const wall = zonedParts(now, hours.tz);
  if (!hours.days.includes(wall.weekday)) return false;
  const at = wall.hour * 60 + wall.minute;
  return at >= minutes(hours.from) && at < minutes(hours.to);
}
