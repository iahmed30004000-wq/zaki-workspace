import { dueTimeText, dueWallOfInstant } from "@/lib/due-day";
import { fmtDMY, fmtShort } from "@/lib/format";
import { zonedParts, zonedStandIn } from "@/lib/zoned-time";

/** A moment as «25 تشرين الثاني 14:30», on the COMPANY's clock (with the year only when it is not this one). Shown for «when was this made». */
export function fmtStamp(instant: Date | string, timeZone: string, now: Date = new Date()): string {
  const at = new Date(instant);
  const day = zonedStandIn(at, timeZone);
  const words = zonedParts(at, timeZone).year === zonedParts(now, timeZone).year ? fmtShort(day) : fmtDMY(day);
  return `${words} ${dueWallOfInstant(at, timeZone).slice(11, 16)}`;
}

/** A due date as words: the day, and the hour when one was picked. */
export function fmtDueStamp(instant: Date | string, timeZone: string, now: Date = new Date()): string {
  const at = new Date(instant);
  const day = zonedStandIn(at, timeZone);
  const words = zonedParts(at, timeZone).year === zonedParts(now, timeZone).year ? fmtShort(day) : fmtDMY(day);
  const time = dueTimeText(dueWallOfInstant(at, timeZone));
  return time ? `${words} ${time}` : words;
}
