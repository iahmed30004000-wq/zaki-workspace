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
import { StepProgressChip } from "@/components/task-steps/step-progress";
import { TaskSteps } from "@/components/task-steps/task-steps";
import { MyRemindersCard, RemindersList } from "@/components/reminders/my-reminders-card";
import { ReminderForm } from "@/components/reminders/reminder-form";
import { RemindDialog, RemindTaskButton } from "@/components/reminders/remind-dialog";
import { defaultWhenText, errorKeyOf, whenLabel } from "@/lib/reminders/client";
import { MAX_STEPS, crowded, positionBetween, progressOf, reorder } from "@/lib/task-steps";
import type { ReminderDto } from "@/server/services/reminders";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, render, textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const steps = [
  { id: "s1", title: "اكتب العرض", done: true, doneAt: "2031-03-10T06:00:00.000Z" },
  { id: "s2", title: "راجعه مع الفريق", done: false, doneAt: null },
  { id: "s3", title: "أرسله للعميل", done: false, doneAt: null },
];

/** The two rules every screen of this feature keeps: theme tokens only, and logical (RTL-safe) directions. */
function expectClean(markup: string) {
  const tokens = classTokens(markup);
  expect(tokens.filter((t) => PALETTE_COLOUR.test(t)), "palette colours").toEqual([]);
  expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t)), "physical directions").toEqual([]);
  expect(markup).not.toMatch(/style="[^"]*#[0-9a-f]{3,8}/i);
}

describe("«الخطوات»: the little progress", () => {
  it("says «3 من 5» for a task with steps, and nothing for a task without", () => {
    const markup = render(createElement(StepProgressChip, { progress: { done: 3, total: 5 } }));
    expect(textOf(markup)).toBe("3 من 5");
    expect(markup).toContain("data-step-progress");
    expect(markup).toContain('aria-label="تقدّم الخطوات: 3 من 5"');
    expectClean(markup);
    expect(render(createElement(StepProgressChip, { progress: null }))).toBe("");
    expect(render(createElement(StepProgressChip, { progress: { done: 0, total: 0 } }))).toBe("");
  });

  it("is the ok colour once every step is done, and the muted one before", () => {
    expect(classTokens(render(createElement(StepProgressChip, { progress: { done: 5, total: 5 } })))).toContain("text-ok");
    expect(classTokens(render(createElement(StepProgressChip, { progress: { done: 2, total: 5 } })))).toContain("text-muted");
  });

  it("the board card and the list row both draw it", () => {
    expect(read("src/components/board-view.tsx")).toContain("<StepProgressChip progress={task.steps} />");
    expect(read("src/components/task-row.tsx")).toContain("<StepProgressChip progress={task.steps} />");
    // and the pages hand it over only while the company's switch is on
    // M2 N3: the board page reads its cards through `boardScreenFor` (shared with the phone's door), so the rule lives there
    expect(read("src/app/(app)/boards/[id]/page.tsx")).toContain("boardScreenFor(");
    expect(read("src/server/services/work-app.ts")).toMatch(/actorFeatureOn\(actor, "taskSteps"\)/);
    expect(read("src/app/(app)/list/page.tsx")).toMatch(/actorFeatureOn\(actor, "taskSteps"\)/);
  });
});

describe("«الخطوات»: the list on the task page", () => {
  it("shows the progress, a bar, the rows and the add box for whoever may edit", () => {
    const markup = render(createElement(TaskSteps, { taskId: "t1", initial: steps, canEdit: true }));
    const text = textOf(markup);
    expect(text).toContain("الخطوات");
    expect(text).toContain("1 من 3");
    expect(markup).toContain("data-step=\"s1\"");
    expect(markup.match(/role="checkbox"/g)).toHaveLength(3);
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('aria-label="انقل الخطوة لفوق"');
    expect(markup).toContain('aria-label="احذف الخطوة"');
    expect(markup).toContain('placeholder="أضف خطوة…"');
    expect(markup).toContain('style="width:33%"');
    expectClean(markup);
  });

  it("is read-only for anybody else: the rows, the progress, and no control at all", () => {
    const markup = render(createElement(TaskSteps, { taskId: "t1", initial: steps, canEdit: false }));
    expect(textOf(markup)).toContain("اكتب العرض");
    expect(textOf(markup)).toContain(AR["steps.readonly"]!);
    expect(markup).not.toContain('placeholder="أضف خطوة…"');
    expect(markup).not.toContain("انقل الخطوة");
    expect(markup).not.toContain("احذف الخطوة");
    expect(markup).not.toContain("<input");
    expect(markup).toMatch(/<button[^>]*role="checkbox"[^>]*disabled/);
  });

  it("an empty list says so and offers the add box (no bar, no progress)", () => {
    const markup = render(createElement(TaskSteps, { taskId: "t1", initial: [], canEdit: true }));
    expect(textOf(markup)).toContain(AR["steps.empty"]!);
    expect(markup).not.toContain("data-step-progress");
    expect(markup).toContain('placeholder="أضف خطوة…"');
  });

  it("the task page draws it only while the switch is on, and the owner reading silently gets it read-only", () => {
    // the page and the phone draw the steps from one sheet (src/server/services/task-sheet.ts)
    expect(read("src/app/(app)/tasks/[id]/page.tsx")).toContain("steps={sheet.steps ? { initial: sheet.steps.steps, canEdit: sheet.steps.canEdit } : null}");
    const sheet = read("src/server/services/task-sheet.ts");
    expect(sheet).toMatch(/actorFeatureOn\(actor, "taskSteps"\)/);
    expect(sheet).toMatch(/canEdit: canEdit && !ownerOutsideSpace/);
  });
});

describe("the step helpers", () => {
  it("progress, positions and reordering", () => {
    expect(progressOf(steps)).toEqual({ done: 1, total: 3 });
    expect(progressOf([])).toEqual({ done: 0, total: 0 });
    expect(positionBetween(null, null)).toBe(1000);
    expect(positionBetween(1000, null)).toBe(2000);
    expect(positionBetween(null, 1000)).toBe(500);
    expect(positionBetween(1000, 2000)).toBe(1500);
    expect(crowded(1500, 1000, 2000)).toBe(false);
    expect(crowded(1000.0000001, 1000, 1000.0000002)).toBe(true);
    expect(crowded(0, null, 1)).toBe(true);
    expect(reorder(["a", "b", "c"], "c", null)).toEqual(["c", "a", "b"]);
    expect(reorder(["a", "b", "c"], "a", "b")).toEqual(["b", "a", "c"]);
    expect(reorder(["a", "b", "c"], "a", "a")).toBeNull();
    expect(reorder(["a", "b", "c"], "z", null)).toBeNull();
    expect(reorder(["a", "b", "c"], "a", "z")).toBeNull();
    expect(MAX_STEPS).toBe(100);
  });
});

const reminder = (over: Partial<ReminderDto> = {}): ReminderDto => ({
  id: "r1",
  title: "اتصل بالمورّد",
  dueAt: "2031-03-10T06:00:00.000Z",
  repeat: "NONE",
  status: "PENDING",
  fired: false,
  taskId: null,
  messageId: null,
  href: null,
  ...over,
});

describe("«تذكيراتي»: the card", () => {
  const list = (reminders: ReminderDto[]) => render(createElement(RemindersList, { data: { reminders, timeZone: "Asia/Damascus" }, onSnooze: () => {}, onDone: () => {} }));

  it("lists each reminder with the time in the company's zone and the three actions", () => {
    const markup = list([reminder(), reminder({ id: "r2", title: "راجع المهمة", taskId: "t1", href: "/tasks/t1", repeat: "WEEKLY" })]);
    const text = textOf(markup);
    expect(text).toContain("اتصل بالمورّد");
    expect(text).toContain("10 آذار · 09:00"); // 06:00Z is 09:00 in Damascus
    expect(text).toContain("كل أسبوع");
    expect(text).toContain("على مهمة");
    expect(markup).toContain('href="/tasks/t1"');
    expect(markup.match(/بعد ساعة/g)).toHaveLength(2);
    expect(markup.match(/بكرا الصبح/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="انتهى التذكير: اتصل بالمورّد"');
    expectClean(markup);
  });

  it("marks one that fired and waits for «تمّ», and says so when there is nothing", () => {
    expect(textOf(list([reminder({ fired: true, status: "FIRED" })]))).toContain("وصل وقته");
    expect(textOf(list([]))).toContain(AR["reminder.empty"]!);
  });

  it("the whole card carries its warning with the way out beside it (⚠️ and 🔧 together), and never raw English", () => {
    const markup = render(createElement(MyRemindersCard));
    const text = textOf(markup);
    expect(text).toContain("⚠️");
    expect(text).toContain("🔧");
    expect(text).toContain(AR["reminder.warn"]!);
    expect(text).toContain(AR["reminder.fix"]!);
    expect(text).toContain("تذكيراتي");
    expect(text).not.toMatch(/\b(PENDING|FIRED|DISMISSED|NONE|DAILY|WEEKLY|MONTHLY)\b/);
    expectClean(markup);
  });

  it("the Today page mounts it in one line, behind the switch", () => {
    const page = read("src/app/(app)/page.tsx");
    expect(page).toContain("{remindersOn ? <MyRemindersCard /> : null}");
    expect(page).toMatch(/actorFeatureOn\(actor, "reminders"\)/);
  });
});

describe("«ذكّرني»: the form and the buttons", () => {
  it("asks what, when (on the company's clock, said in words) and how often, with the repeats in Arabic", () => {
    const markup = render(createElement(ReminderForm, { defaultTitle: "راجع المهمة", timeZone: "Asia/Damascus", onSaved: () => {}, onCancel: () => {} }));
    const text = textOf(markup);
    expect(text).toContain("شو بدك نذكّرك؟");
    expect(text).toContain("بتوقيت الشركة: Asia/Damascus");
    for (const label of ["مرة وحدة", "كل يوم", "كل أسبوع", "كل شهر"]) expect(text).toContain(label);
    expect(markup).toContain('value="راجع المهمة"');
    expect(markup).toContain('type="datetime-local"');
    expect(markup).toMatch(/<input[^>]*type="datetime-local"[^>]*value="\d{4}-\d{2}-\d{2}T\d{2}:00"/);
    expect(markup).toContain(">احفظ التذكير<");
    expectClean(markup);
  });

  it("the button on a task, and the dialog (closed it draws nothing, and needs no provider)", () => {
    const button = render(createElement(RemindTaskButton, { taskId: "t1", taskTitle: "مهمة" }));
    expect(textOf(button)).toContain("ذكّرني");
    const closed = render(createElement(RemindDialog, { open: false, onClose: () => {}, onSaved: () => {} }));
    expect(closed).toBe("");
    expect(read("src/components/task-detail.tsx")).toMatch(/<RemindTaskButton taskId=\{task\.id\}/);
    expect(read("src/components/chat/conversation/conversation-screen.tsx")).toContain('id==="remind"');
  });

  it("the clock helpers read the company's zone, never the machine's", () => {
    expect(defaultWhenText(new Date("2031-03-10T05:20:00Z"), "Asia/Damascus")).toBe("2031-03-10T09:00");
    expect(defaultWhenText(new Date("2031-03-10T05:20:00Z"), "Europe/Berlin")).toBe("2031-03-10T07:00");
    expect(whenLabel("2031-03-10T21:30:00.000Z", "Asia/Damascus")).toBe("11 آذار · 00:30");
  });

  it("a refusal is shown by its own key when the dictionary has it, and by the general one otherwise", () => {
    expect(errorKeyOf({ message: "reminder.past" })).toBe("reminder.past");
    expect(errorKeyOf({ message: "validation.failed", details: [{ path: "dueAt", message: "reminder.bad_time" }] })).toBe("reminder.bad_time");
    expect(errorKeyOf({ message: "something else" })).toBe("reminder.failed");
    expect(errorKeyOf(null, "steps.failed")).toBe("steps.failed");
    for (const key of ["reminder.past", "reminder.bad_time", "reminder.title_empty", "reminder.too_many", "step.too_many", "step.oversight_readonly", "step.title_long"]) {
      expect(AR[key], key).toMatch(/[؀-ۿ]/);
    }
  });
});
