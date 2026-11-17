/**
 * The kinds of problem a ticket can be made for (Q1.5), «حسب أسبوع الشغل الحقيقي». Editable later by the owner (`Organization.settings.ticketKinds`); until
 * somebody edits them these are the kinds. Each kind has the hours before a reminder (counted inside the company's working hours), whether it asks for a
 * follow-up day («حجز موعد») or a screen recording («مشكلة بالموقع»), and may name a default department or person.
 */
export interface ProblemKind {
  key: string;
  label: string;
  /** working hours before the first reminder to whoever holds the ticket */
  reminderHours: number;
  /** «بدها يوم متابعة»: the form asks for the day the customer should be called */
  needsFollowUp?: boolean;
  /** «بدها تسجيل شاشة»: the ticket cannot be sent without a screen recording (a file in the message or ticket) */
  needsRecording?: boolean;
  /** a department that gets this kind when nobody is @-mentioned */
  departmentId?: string | null;
  /** the person who gets it (an «تذكرة فورية») when nobody is @-mentioned and no department is set */
  assigneeId?: string | null;
}

export const DEFAULT_PROBLEM_KINDS: readonly ProblemKind[] = [
  { key: "wrong_number", label: "رقم غلط أو ما في واتساب", reminderHours: 3 },
  { key: "duplicate", label: "مكرر", reminderHours: 3 },
  { key: "cancelled_reorder", label: "ملغي وبدو يرجع يطلب", reminderHours: 3 },
  { key: "postpone", label: "تأجيل أو حجز موعد", reminderHours: 6, needsFollowUp: true },
  { key: "returned", label: "مرتجع", reminderHours: 6 },
  { key: "order_status", label: "شو وضع الطلب", reminderHours: 2 },
  { key: "edit_order", label: "تعديل طلب", reminderHours: 3 },
  { key: "customer_silent", label: "الزبون ما بيرد", reminderHours: 6 },
  { key: "shipping", label: "مشكلة شحن", reminderHours: 4 },
  { key: "website", label: "مشكلة بالموقع", reminderHours: 4, needsRecording: true },
  { key: "product_question", label: "سؤال عن منتج", reminderHours: 2 },
  { key: "other", label: "غير ذلك", reminderHours: 4 },
];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The company's kinds: its own list when it has a valid one, the defaults otherwise (a bad entry is skipped, never trusted). */
export function problemKindsOf(settings: unknown): ProblemKind[] {
  const raw = isObj(settings) ? settings["ticketKinds"] : undefined;
  if (!Array.isArray(raw)) return [...DEFAULT_PROBLEM_KINDS];
  const out: ProblemKind[] = [];
  const seen = new Set<string>();
  for (const k of raw) {
    if (!isObj(k)) continue;
    const key = k["key"];
    const label = k["label"];
    const hours = k["reminderHours"];
    if (typeof key !== "string" || !/^[a-z][a-z0-9_]{1,40}$/.test(key) || seen.has(key)) continue;
    if (typeof label !== "string" || !label.trim() || label.length > 60) continue;
    if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0.5 || hours > 72) continue;
    seen.add(key);
    out.push({
      key,
      label: label.trim(),
      reminderHours: hours,
      ...(k["needsFollowUp"] === true ? { needsFollowUp: true } : {}),
      ...(k["needsRecording"] === true ? { needsRecording: true } : {}),
      ...(typeof k["departmentId"] === "string" ? { departmentId: k["departmentId"] } : {}),
      ...(typeof k["assigneeId"] === "string" ? { assigneeId: k["assigneeId"] } : {}),
    });
  }
  return out.length ? out : [...DEFAULT_PROBLEM_KINDS];
}

/** An own-key lookup («constructor» is no kind). */
export function problemKind(kinds: readonly ProblemKind[], key: unknown): ProblemKind | null {
  return typeof key === "string" ? (kinds.find((k) => k.key === key) ?? null) : null;
}
