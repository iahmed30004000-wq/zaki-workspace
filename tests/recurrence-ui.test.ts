import { createElement } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/tasks/t1",
}));

import { AR } from "@/lib/i18n/dict";
import { RecurringBadge } from "@/components/recurrence/recurring-badge";
import { RecurrenceControl } from "@/components/recurrence/recurrence-control";
import { RecurrenceForm, WEEK_ORDER, nextLine, recurrenceSummary } from "@/components/recurrence/recurrence-form";
import type { RecurrenceDto } from "@/server/services/task-recurrence";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, render, textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const weekly: RecurrenceDto = {
  id: "r1",
  rule: { kind: "WEEKLY", days: [0, 2], time: "12:00" },
  mode: "SCHEDULE",
  active: true,
  stoppedReason: null,
  nextDueAt: "2031-03-11T09:00:00.000Z",
  endsOn: "2031-12-31",
  isTemplate: true,
};

/** The two rules every screen of this feature keeps: theme tokens only, and logical (RTL-safe) directions. */
function expectClean(markup: string) {
  const tokens = classTokens(markup);
  expect(tokens.filter((t) => PALETTE_COLOUR.test(t)), "palette colours").toEqual([]);
  expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t)), "physical directions").toEqual([]);
  expect(markup).not.toMatch(/style="[^"]*#[0-9a-f]{3,8}/i);
}

describe("«🔁 متكررة»: the badge on a card and a row", () => {
  it("says «متكررة» for a task of a running series, and nothing for any other", () => {
    const markup = render(createElement(RecurringBadge, { recurring: true }));
    expect(textOf(markup)).toBe("🔁 متكررة");
    expect(markup).toContain("data-recurring-badge");
    expect(markup).toContain('aria-label="مهمة متكررة"');
    expectClean(markup);
    expect(render(createElement(RecurringBadge, { recurring: false }))).toBe("");
    expect(render(createElement(RecurringBadge, { recurring: undefined }))).toBe("");
  });

  it("the board card and the list row both draw it, and the pages hand it over only while the company's switch is on", () => {
    expect(read("src/components/board-view.tsx")).toContain("<RecurringBadge recurring={task.recurring} />");
    expect(read("src/components/task-row.tsx")).toContain("<RecurringBadge recurring={task.recurring} />");
    // M2 N3: the board page reads its cards through `boardScreenFor` (shared with the phone's door), so the rule lives there
    expect(read("src/app/(app)/boards/[id]/page.tsx")).toContain("boardScreenFor(");
    expect(read("src/server/services/work-app.ts")).toMatch(/actorFeatureOn\(actor, "recurringTasks"\)/);
    expect(read("src/app/(app)/list/page.tsx")).toMatch(/actorFeatureOn\(actor, "recurringTasks"\)/);
    expect(read("src/app/(app)/tasks/[id]/page.tsx")).toMatch(/actorFeatureOn\(actor, "recurringTasks"\)/);
  });
});

describe("«تكرار»: the control on the task page", () => {
  it("draws the «تكرار» button for whoever may edit, and says what is set under it", () => {
    const markup = render(createElement(RecurrenceControl, { taskId: "t1", initial: weekly, timeZone: "Asia/Damascus", canEdit: true }));
    const text = textOf(markup);
    expect(text).toContain("تكرار");
    expect(text).toContain("تتكرر كل أسبوع: الأحد، الثلاثاء");
    expect(text).toContain("تنتهي في 2031-12-31");
    expect(text).toContain("حسب الجدول");
    expect(text).toContain("المهمة التالية:");
    expect(markup).toContain("data-recurrence-summary");
    expect(markup).toContain('aria-haspopup="dialog"');
    expectClean(markup);
  });

  it("for a person who may not edit: the summary and no button; with nothing set, nothing at all", () => {
    const readOnly = render(createElement(RecurrenceControl, { taskId: "t1", initial: weekly, timeZone: "Asia/Damascus", canEdit: false }));
    expect(readOnly).toContain("data-recurrence-summary");
    expect(readOnly).not.toContain("aria-haspopup");
    expect(readOnly).not.toContain("<button");
    expect(render(createElement(RecurrenceControl, { taskId: "t1", initial: null, timeZone: "Asia/Damascus", canEdit: false }))).toBe("");
    // with nothing set, the person who may edit still sees the button and no summary
    const empty = render(createElement(RecurrenceControl, { taskId: "t1", initial: null, timeZone: "Asia/Damascus", canEdit: true }));
    expect(empty).toContain("aria-haspopup");
    expect(empty).not.toContain("data-recurrence-summary");
  });

  it("«عند الإنجاز» says the next one comes when this one is finished; a copy says the series is shared", () => {
    const onComplete: RecurrenceDto = { ...weekly, mode: "ON_COMPLETE", nextDueAt: null, endsOn: null, isTemplate: false };
    expect(nextLine(onComplete, "Asia/Damascus")).toBe(AR["recurring.next_on_complete"]);
    const text = textOf(render(createElement(RecurrenceControl, { taskId: "t2", initial: onComplete, timeZone: "Asia/Damascus", canEdit: true })));
    expect(text).toContain("عند الإنجاز");
    expect(text).toContain(AR["recurring.is_copy"]);
    expect(nextLine({ ...onComplete, active: false }, "Asia/Damascus")).toBeNull();
  });

  it("a series that stopped on its own shows the warning ⚠️ and the fix 🔧 together, for every reason", () => {
    for (const reason of ["ENDED", "ARCHIVED", "CREATOR_INACTIVE", "FAILED"] as const) {
      const markup = render(createElement(RecurrenceControl, { taskId: "t1", initial: { ...weekly, active: false, stoppedReason: reason }, timeZone: "Asia/Damascus", canEdit: true }));
      expect(markup, reason).toContain(`data-recurrence-stopped="${reason}"`);
      const text = textOf(markup);
      expect(text, reason).toContain(`⚠️ ${AR[`recurring.stopped.${reason}`]}`);
      expect(text, reason).toContain(`🔧 ${AR[`recurring.fix.${reason}`]}`);
      expect(markup).not.toContain("data-recurrence-summary");
      expectClean(markup);
    }
    // a person's own stop has no warning
    const manual = render(createElement(RecurrenceControl, { taskId: "t1", initial: { ...weekly, active: false }, timeZone: "Asia/Damascus", canEdit: true }));
    expect(manual).not.toContain("data-recurrence-stopped");
  });
});

describe("«تكرار»: the form", () => {
  it("starts on «بدون تكرار» for a task with no series, offering the five choices", () => {
    const markup = render(createElement(RecurrenceForm, { taskId: "t1", initial: null, timeZone: "Asia/Damascus", onSaved: () => {}, onCancel: () => {} }));
    for (const key of ["NONE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"]) expect(markup).toContain(`<option value="${key}"`);
    for (const key of ["NONE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"]) expect(textOf(markup)).toContain(AR[`recurring.kind.${key}`]);
    expect(markup).not.toContain("data-weekday");
    expect(markup).not.toContain("data-recurrence-warning");
    expectClean(markup);
  });

  it("weekly: seven weekday buttons, Saturday first, the chosen ones pressed; end date, mode, and the warning with its fix", () => {
    const markup = render(createElement(RecurrenceForm, { taskId: "t1", initial: weekly, timeZone: "Asia/Damascus", onSaved: () => {}, onCancel: () => {} }));
    const days = [...markup.matchAll(/data-weekday="(\d)"/g)].map((m) => Number(m[1]));
    expect(days).toEqual([...WEEK_ORDER]);
    expect(markup).toMatch(/aria-pressed="true"[^>]*data-weekday="0"/);
    expect(markup).toMatch(/aria-pressed="true"[^>]*data-weekday="2"/);
    expect(markup).toMatch(/aria-pressed="false"[^>]*data-weekday="6"/);
    expect(markup).toContain('type="date"');
    expect(textOf(markup)).toContain(AR["recurring.field.end"]);
    expect(textOf(markup)).toContain(AR["recurring.field.mode"]);
    expect(markup).toContain('<option value="ON_COMPLETE"');
    expect(markup).toContain('<option value="SCHEDULE"');
    // the risk and its fix, together
    const text = textOf(markup);
    expect(text).toContain(`⚠️ ${AR["recurring.warn_auto"]}`);
    expect(text).toContain(`🔧 ${AR["recurring.fix_auto"]}`);
    expect(text).toContain(`⚠️ ${AR["recurring.warn_assign"]}`);
    expect(text).toContain(`🔧 ${AR["recurring.fix_assign"]}`);
    expect(text).toContain("بتوقيت الشركة: Asia/Damascus");
    expectClean(markup);
  });

  it("a weekly pick with no day cannot be saved: the message says so and the save button is off", () => {
    const empty: RecurrenceDto = { ...weekly, rule: { kind: "WEEKLY", days: [], time: "12:00" } };
    const markup = render(createElement(RecurrenceForm, { taskId: "t1", initial: empty, timeZone: "Asia/Damascus", onSaved: () => {}, onCancel: () => {} }));
    expect(textOf(markup)).toContain(AR["recurrence.days_required"]);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*type="submit"|<button[^>]*type="submit"[^>]*disabled=""/);
  });

  it("monthly: the day box with its «31» hint; a running series turns «بدون تكرار» into «إيقاف التكرار»", () => {
    const monthly: RecurrenceDto = { ...weekly, rule: { kind: "MONTHLY", day: 31, time: "12:00" } };
    const markup = render(createElement(RecurrenceForm, { taskId: "t1", initial: monthly, timeZone: "Asia/Damascus", onSaved: () => {}, onCancel: () => {} }));
    expect(markup).toContain('type="number"');
    expect(markup).toContain('value="31"');
    expect(textOf(markup)).toContain(AR["recurring.last_day_hint"]);
    expect(textOf(markup)).toContain(AR["recurring.save"]);
    expect(recurrenceSummary(monthly)).toBe("تتكرر كل شهر في اليوم 31");
    expect(recurrenceSummary({ ...weekly, rule: { kind: "DAILY", time: "12:00" } })).toBe("تتكرر كل يوم");
    expect(recurrenceSummary({ ...weekly, rule: { kind: "YEARLY", month: 2, day: 29, time: "12:00" } })).toBe("تتكرر كل سنة");
  });
});

describe("«تكرار»: the screen is Arabic and the pages wire it", () => {
  it("every string the screens read exists in the dictionary", () => {
    const sources = ["src/components/recurrence/recurrence-form.tsx", "src/components/recurrence/recurrence-control.tsx", "src/components/recurrence/recurring-badge.tsx"].map(read).join("\n");
    for (const m of sources.matchAll(/rt\("([a-z_.]+)"/g)) expect(AR[m[1] as string], m[1]).toBeTruthy();
    for (const kind of ["NONE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"]) expect(AR[`recurring.kind.${kind}`]).toMatch(/[؀-ۿ]/);
    for (const d of [0, 1, 2, 3, 4, 5, 6]) expect(AR[`recurring.day.${d}`]).toMatch(/[؀-ۿ]/);
    for (const mode of ["ON_COMPLETE", "SCHEDULE"]) {
      expect(AR[`enum.RecurrenceMode.${mode}`]).toMatch(/[؀-ۿ]/);
      expect(AR[`recurring.mode_hint.${mode}`]).toMatch(/[؀-ۿ]/);
    }
    // every error key the service and the zod rule can throw
    for (const key of ["rule_invalid", "days_required", "end_invalid", "end_past", "end_before_first", "oversight_readonly", "not_found"]) {
      expect(AR[`recurrence.${key}`], key).toMatch(/[؀-ۿ]/);
    }
    expect(AR["features.recurringTasks.name"]).toBe("مهمة متكررة");
  });

  it("the task page draws the control from the series, only while the switch is on, and never for the owner reading silently", () => {
    const page = read("src/app/(app)/tasks/[id]/page.tsx");
    expect(page).toContain("recurrenceOfTask(task.id, orgId)");
    // the owner reading a space he is not in (`ownerOutsideSpace`, the shared sheet's rule) never changes a series
    expect(page).toMatch(/canEdit: sheet\.canEdit && !ownerOutsideSpace/);
    expect(read("src/server/services/task-sheet.ts")).toContain('const ownerOutsideSpace = membership?.role === "OWNER" && !spaceRow;');
    expect(read("src/components/task-detail.tsx")).toContain("<RecurrenceControl");
  });
});
