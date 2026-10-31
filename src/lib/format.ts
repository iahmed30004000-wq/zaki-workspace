/**
 * Dates, times and numbers as the screens show them: Arabic names, Western digits (0-9).
 *
 * Everything here is hand-written on purpose. `toLocaleDateString`/`Intl` print different digits and
 * different names per device (and Node's ICU differs from the browser's), which makes server and
 * client render different text and the page mismatch while hydrating. Arabic is the only language,
 * so the old per-locale tables (French, English) are gone; the `locale` parameter that many callers
 * still pass is accepted and ignored.
 *
 * The sentences that need Arabic's number forms (قبل يومين / قبل 3 أيام / قبل 11 يومًا) live in the
 * dictionary, not here.
 */
import { AR } from "./i18n/dict";
import { interpolate } from "./i18n/interpolate";

/**
 * The Gregorian months under the names used in Jordan, Syria, Lebanon and Palestine. Replace the
 * array to switch to يناير / فبراير / ... everywhere at once.
 */
const MONTHS: readonly string[] = [
  "كانون الثاني",
  "شباط",
  "آذار",
  "نيسان",
  "أيار",
  "حزيران",
  "تموز",
  "آب",
  "أيلول",
  "تشرين الأول",
  "تشرين الثاني",
  "كانون الأول",
];

/** Sunday first, as the calendar grid and the week of the goals start. */
const WEEKDAYS_SHORT: readonly string[] = ["أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة", "سبت"];
const WEEKDAYS_LONG: readonly string[] = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

const DAY_MS = 86_400_000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toDate(d: Date | string | number | null | undefined): Date | null {
  if (!d) return null;
  const date = d instanceof Date ? new Date(d.getTime()) : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "5 تشرين الأول 2026" - identical output on server and client. The locale is ignored (Arabic only). */
export function fmtDMY(d: Date | string | number | null | undefined, _locale?: string): string {
  const date = toDate(d);
  if (!date) return "";
  return `${date.getDate()} ${MONTHS[date.getMonth()]!} ${date.getFullYear()}`;
}

/** Short "5 تشرين الأول" - identical on both sides. */
export function fmtShort(d: Date | string | number | null | undefined, _locale?: string): string {
  const date = toDate(d);
  if (!date) return "";
  return `${date.getDate()} ${MONTHS[date.getMonth()]!}`;
}

/** "14:05" local time - identical on both sides (24 hours, so nothing needs "ص" or "م"). */
export function fmtTime(d: Date | string | number | null | undefined): string {
  const date = toDate(d);
  if (!date) return "";
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** "5 تشرين الأول 2026، 14:05" - for event tables and logs. */
export function fmtDateTime(d: Date | string | number | null | undefined, _locale?: string): string {
  const date = toDate(d);
  if (!date) return "";
  return `${fmtDMY(date)}، ${fmtTime(date)}`;
}

/** "الخميس 22 تشرين الأول 2026" - for the heading of a day. */
export function fmtLongDate(d: Date | string | number | null | undefined): string {
  const date = toDate(d);
  if (!date) return "";
  return `${WEEKDAYS_LONG[date.getDay()]!} ${fmtDMY(date)}`;
}

/** Grouped number with plain commas and Western digits - no locale separators. */
export function fmtNumber(n: number | null | undefined): string {
  if (n == null) return "";
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A duration in whole minutes as «س:دق» with Western digits («90» → «1:30»); a missing or negative value is empty. */
export function fmtMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return "";
  const whole = Math.round(minutes);
  return `${fmtNumber(Math.floor(whole / 60))}:${String(whole % 60).padStart(2, "0")}`;
}

/** A file size in Arabic units: "512 بايت" / "340 كيلوبايت" / "1.5 ميغابايت". */
export function fmtSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} ${AR["unit.byte"] ?? ""}`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ${AR["unit.kilobyte"] ?? ""}`;
  return `${(bytes / 1024 / 1024).toFixed(1)} ${AR["unit.megabyte"] ?? ""}`;
}

/** Short weekday label for a 0-based index (0 = Sunday): "أحد" ... "سبت". */
export function weekdayName(index: number, _locale?: string): string {
  return WEEKDAYS_SHORT[((index % 7) + 7) % 7]!;
}

/** Full weekday name for a 0-based index (0 = Sunday): "الأحد" ... "السبت". */
export function weekdayLong(index: number): string {
  return WEEKDAYS_LONG[((index % 7) + 7) % 7]!;
}

/** Month label for a 0-based index - deterministic. */
export function monthName(index: number, _locale?: string): string {
  return MONTHS[((index % 12) + 12) % 12]!;
}

/** The Arabic number form: one, two, 3-10 (plural), 11+ (singular again). */
export function arabicPlural(n: number): "one" | "two" | "few" | "many" {
  if (n === 1) return "one";
  if (n === 2) return "two";
  const m = n % 100;
  if (m >= 3 && m <= 10) return "few";
  return "many";
}

/**
 * How many calendar days from today a date is (negative = in the past), counted in the device's own
 * days: 23:59 and 00:01 of the same date are the same day. `null` for no date.
 */
export function dayDiff(d: Date | string | number | null | undefined, now: Date = new Date()): number | null {
  const date = toDate(d);
  if (!date) return null;
  return Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
}

/**
 * A day, said the way people say it: «اليوم» «أمس» «بكرا» «قبل يومين» «بعد 3 أيام» «قبل 11 يومًا»;
 * a month or more away it is the date itself (with the year only when it is not this year).
 */
export function fmtRelative(d: Date | string | number | null | undefined, now: Date = new Date()): string {
  const date = toDate(d);
  if (!date) return "";
  const diff = Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
  if (diff === 0) return AR["time.today"] ?? "";
  if (diff === -1) return AR["time.yesterday"] ?? "";
  if (diff === 1) return AR["time.tomorrow"] ?? "";
  const n = Math.abs(diff);
  if (n < 30) {
    const form = arabicPlural(n);
    const key = diff < 0 ? `members.ago.day.${form}` : `time.in.day.${form}`;
    return interpolate(AR[key] ?? "", { n });
  }
  return date.getFullYear() === now.getFullYear() ? fmtShort(date) : fmtDMY(date);
}

/**
 * A moment, counted back from now: «الآن» «قبل 5 دقائق» «قبل ساعتين» «قبل يومين» «قبل شهر». The same
 * phrases as the team screen (`members.ago.*`); a moment in the future (a clock that runs ahead) is «الآن».
 */
export function fmtAgo(d: Date | string | number | null | undefined, now: Date = new Date()): string {
  const date = toDate(d);
  if (!date) return "";
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 45) return AR["members.ago.now"] ?? "";
  let unit: "minute" | "hour" | "day" | "month" | "year";
  let n: number;
  if (seconds < 3600) {
    unit = "minute";
    n = Math.max(1, Math.floor(seconds / 60));
  } else if (seconds < 86_400) {
    unit = "hour";
    n = Math.floor(seconds / 3600);
  } else {
    const days = Math.floor(seconds / 86_400);
    if (days < 30) {
      unit = "day";
      n = days;
    } else if (days < 365) {
      unit = "month";
      n = Math.floor(days / 30);
    } else {
      unit = "year";
      n = Math.floor(days / 365);
    }
  }
  return interpolate(AR[`members.ago.${unit}.${arabicPlural(n)}`] ?? "", { n });
}

/**
 * Task priority presentation tokens shared by views (no business logic): the Arabic label and the
 * dot colour. The words come from the dictionary (`priority.*`), the same ones `enumLabel` returns.
 */
export const PRIORITY_STYLES: Record<string, { label: string; color: string }> = {
  URGENT: { label: AR["priority.URGENT"] ?? "", color: "rgb(var(--danger))" },
  HIGH: { label: AR["priority.HIGH"] ?? "", color: "rgb(var(--warn))" },
  NORMAL: { label: AR["priority.NORMAL"] ?? "", color: "rgb(var(--info))" },
  LOW: { label: AR["priority.LOW"] ?? "", color: "rgb(var(--muted))" },
  NONE: { label: AR["priority.NONE"] ?? "", color: "rgb(var(--border))" },
};

/** The short date a task shows (the locale many callers still pass is ignored: Arabic only). */
export function formatDate(d: Date | string | null | undefined, _locale?: string): string {
  return fmtShort(d);
}

export function isOverdue(d: string | null | undefined): boolean {
  if (!d) return false;
  return new Date(d).getTime() < Date.now();
}

/** Deterministic avatar hue from the name - same on server and client. */
export function avatarHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (h * 31 + name.charCodeAt(i)) % 360;
  }
  return h;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0)).join("") || "?";
}
