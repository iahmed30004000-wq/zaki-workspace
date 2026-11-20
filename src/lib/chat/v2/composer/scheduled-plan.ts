/**
 * C3c.3 / C3w.2 — what the composer asks of «جدول الإرسال». The HEADER carries the person's own number of waiting scheduled messages here (`header.scheduled`): ABSENT
 * means the company's switch is off or the person may not write here, so the composer shows no entry and asks nobody; a number (even 0) means the entry is on offer.
 * The list itself (the rows, the company's zone) is asked only when there is something to show (the number is above 0) or when the person opens the dialog or the
 * list — never on every conversation that is opened.
 */
export interface ScheduledPlan {
  /** «جدول الإرسال» is on offer in the send button's menu */
  entry: boolean;
  /** the waiting rows the header counted (0 when it says nothing) */
  count: number;
  /** read the list as soon as the conversation opens: only when the header says some are waiting */
  loadOnOpen: boolean;
}

export function scheduledPlanOf(i: { scheduled: number | undefined; oversight: boolean; meId: string }): ScheduledPlan {
  const entry = i.scheduled !== undefined && !i.oversight && i.meId !== "";
  const count = entry ? Math.max(0, Math.floor(i.scheduled ?? 0)) : 0;
  return { entry, count, loadOnOpen: entry && count > 0 };
}
