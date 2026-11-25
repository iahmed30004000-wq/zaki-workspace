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

import { FieldChipPicker, FieldChips } from "@/components/custom-fields/field-chips";
import { FieldListControls } from "@/components/custom-fields/list-controls";
import { ManageFields } from "@/components/custom-fields/manage-fields";
import { FieldEditor, TaskFieldsCard } from "@/components/custom-fields/task-fields-card";
import { completeTask } from "@/components/today/complete-task";
import { ApiError } from "@/lib/api-client";
import { MAX_CHIP_FIELDS, type FieldDefDto } from "@/lib/custom-fields";
import { CHOSEN_KEY, movedAfter, parseChosen, toggleChosen } from "@/lib/custom-fields-ui";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, render, textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

function expectClean(markup: string) {
  const tokens = classTokens(markup);
  expect(tokens.filter((t) => PALETTE_COLOUR.test(t)), "palette colours").toEqual([]);
  expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t)), "physical directions").toEqual([]);
  expect(markup).not.toMatch(/style="[^"]*#[0-9a-f]{3,8}/i);
}

const def = (over: Partial<FieldDefDto> & Pick<FieldDefDto, "id" | "label" | "type">): FieldDefDto => ({
  required: false,
  archived: false,
  unit: null,
  currency: null,
  options: [],
  ...over,
});

const OPTS = [
  { id: "o1", label: "عالي", color: "danger" as const },
  { id: "o2", label: "منخفض", color: "ok" as const },
  { id: "o3", label: "قديم", color: "muted" as const, deleted: true },
];

const fields: FieldDefDto[] = [
  def({ id: "f1", label: "ملاحظة", type: "TEXT", required: true }),
  def({ id: "f2", label: "التفاصيل", type: "LONG_TEXT" }),
  def({ id: "f3", label: "الوزن", type: "NUMBER", unit: "كغ" }),
  def({ id: "f4", label: "الموعد", type: "DATE" }),
  def({ id: "f5", label: "الأولوية", type: "SINGLE_CHOICE", options: OPTS }),
  def({ id: "f6", label: "الوسوم", type: "MULTI_CHOICE", options: OPTS }),
  def({ id: "f7", label: "عاجل", type: "BOOLEAN" }),
  def({ id: "f8", label: "المسؤول", type: "PERSON" }),
  def({ id: "f9", label: "الرابط", type: "LINK" }),
  def({ id: "f10", label: "الميزانية", type: "MONEY", currency: "JOD" }),
];
const people = [
  { id: "u1", name: "سارة" },
  { id: "u2", name: "خالد" },
];

describe("«حقول مخصصة»: an editor per type", () => {
  const editor = (f: FieldDefDto, value: unknown, disabled = false) => render(createElement(FieldEditor, { field: f, value, people, disabled, onCommit: () => {} }));
  const of = (id: string) => fields.find((f) => f.id === id) as FieldDefDto;

  it("text, long text, number and money are boxes with the value in them, the unit and the currency beside them", () => {
    const text = editor(of("f1"), "مرحبا");
    expect(text).toContain('value="مرحبا"');
    expect(text).toContain('aria-label="ملاحظة"');
    expect(text).toContain('aria-required="true"');
    expect(text).toContain('maxLength="200"');
    expect(editor(of("f2"), "سطر")).toMatch(/<textarea[^>]*maxLength="2000"/);
    const num = editor(of("f3"), "12.5");
    expect(num).toContain('value="12.5"');
    expect(num).toContain('inputMode="decimal"');
    expect(textOf(num)).toContain("كغ");
    const money = editor(of("f10"), 15050);
    expect(money).toContain('value="150.5"');
    expect(textOf(money)).toContain("دينار");
  });

  it("a date is a date box; a link is a url box left-to-right with a link to open it", () => {
    expect(editor(of("f4"), "2026-03-05")).toMatch(/type="date"[^>]*value="2026-03-05"|value="2026-03-05"[^>]*type="date"/);
    const link = editor(of("f9"), "https://www.example.com/x");
    expect(link).toContain('type="url"');
    expect(link).toContain('dir="ltr"');
    expect(link).toContain('rel="noopener noreferrer"');
    expect(link).toContain('href="https://www.example.com/x"');
    expect(textOf(link)).toContain("example.com");
  });

  it("a choice lists only the live options; a value that holds a deleted one still shows «محذوف»", () => {
    const one = editor(of("f5"), "o2");
    expect(textOf(one)).toContain("عالي");
    expect(textOf(one)).toContain("منخفض");
    expect(textOf(one)).not.toContain("قديم");
    expect(one).toMatch(/<option value="o2" selected/);
    const orphan = editor(of("f5"), "o3");
    expect(textOf(orphan)).toContain("محذوف");
    expect(textOf(orphan)).not.toContain("قديم");
    // multiple: a pressed pill per chosen option, a struck-through «محذوف» for a deleted one
    const many = editor(of("f6"), ["o1", "o3"]);
    expect(many.match(/aria-pressed="true"/g)?.length).toBe(2);
    expect(textOf(many)).toContain("محذوف");
  });

  it("yes/no shows the answer pressed, «no» included; a person picks among the people of the space and a leaver reads «شخص سابق»", () => {
    expect(editor(of("f7"), true)).toMatch(/aria-pressed="true"[^>]*>نعم/);
    expect(editor(of("f7"), false)).toMatch(/aria-pressed="true"[^>]*>لا/);
    expect(editor(of("f7"), undefined).match(/aria-pressed="true"/)).toBeNull();
    const who = editor(of("f8"), "u2");
    expect(who).toMatch(/<option value="u2" selected/);
    expect(textOf(who)).toContain("سارة");
    expect(textOf(editor(of("f8"), "gone"))).toContain("شخص سابق");
  });

  it("disabled editors cannot be touched", () => {
    for (const f of fields) expect(editor(f, undefined, true), f.id).toMatch(/disabled/);
  });

  it("uses the theme tokens and logical directions only", () => {
    for (const f of fields) expectClean(editor(f, undefined));
  });
});

describe("«حقول مخصصة»: the card on the task page", () => {
  const card = (props: Partial<Parameters<typeof TaskFieldsCard>[0]> = {}) =>
    render(createElement(TaskFieldsCard, { taskId: "t1", fields, initialValues: { f1: "مرحبا", f7: true, f5: "o1" }, people, canEdit: true, ...props }));

  it("shows the title, one row per field, the required mark and every editor", () => {
    const markup = card();
    const text = textOf(markup);
    expect(text).toContain("حقول مخصصة");
    for (const f of fields) expect(markup, f.id).toContain(`data-field="${f.id}"`);
    expect(text).toContain("مطلوب");
    expect(markup).toContain('id="custom-fields"');
    expect(markup).toContain('data-field-input="f1"');
    expectClean(markup);
  });

  it("is plain text for a person who may only read: no box, the answers as words, «لم يُحدَّد» for the rest", () => {
    const markup = card({ canEdit: false });
    expect(markup).not.toContain("data-field-input");
    const text = textOf(markup);
    expect(text).toContain("بتقدر تقرا الحقول بس");
    expect(text).toContain("مرحبا");
    expect(text).toContain("نعم");
    expect(text).toContain("عالي");
    expect(text).toContain("لم يُحدَّد");
  });

  it("is not drawn at all when the project has no field", () => {
    expect(card({ fields: [] })).toBe("");
  });

  it("saves one value at a time through PUT, and says the refusal in Arabic with the old value put back", () => {
    const src = read("src/components/custom-fields/task-fields-card.tsx");
    expect(src).toContain('method: "PUT"');
    expect(src).toContain("/fields/${encodeURIComponent(field.id)}");
    expect(src).toMatch(/toast\?\.toast\(rt\(errorKeyOf\(body, "fields\.save_failed"\)\), "error"\)/);
    expect(src).toContain("onBlur");
    // the optimistic update is undone on failure
    expect(src).toMatch(/if \(before === undefined\) delete copy\[field\.id\]/);
  });
});

describe("«حقول مخصصة»: «إدارة الحقول» on the project page", () => {
  const manage = (canEdit: boolean, initial: FieldDefDto[] = fields) => render(createElement(ManageFields, { projectId: "p1", initial, canEdit }));

  it("lists the live fields with their type, the counter «n من 15», and the drag grips, edit and archive for the person who may", () => {
    const markup = manage(true);
    const text = textOf(markup);
    expect(text).toContain("إدارة الحقول");
    expect(markup).toContain("data-fields-counter");
    expect(text).toContain("10 من 15");
    expect(markup.match(/data-field-row=/g)).toHaveLength(10);
    // a grip per row (the side menu's own: its name is «…» plus the field's label)
    expect(markup.match(/<button[^>]*aria-label="[^"]*ملاحظة"[^>]*touch-none|<button[^>]*touch-none[^>]*aria-label="[^"]*ملاحظة"/g)?.length).toBeGreaterThan(0);
    expect(markup).toContain('aria-label="تعديل: ملاحظة"');
    expect(markup).toContain('aria-label="أرشفة: ملاحظة"');
    expect(text).toContain("حقل جديد");
    expect(text).toContain("نص قصير");
    expect(text).toContain("مبلغ مالي");
    expectClean(markup);
  });

  it("is read-only for everybody else: the list and the type, no grip, no button, a sentence saying who edits", () => {
    const markup = manage(false);
    expect(markup.match(/data-field-row=/g)).toHaveLength(10);
    expect(markup).not.toContain('aria-label="تعديل');
    expect(markup).not.toContain('aria-label="أرشفة');
    expect(textOf(markup)).toContain("تعديل الحقول لمدير المساحة والمالك فقط");
    expect(markup).not.toContain("حقل جديد");
  });

  it("shows the archived fields to the editor, with a restore button, and not in the live count", () => {
    const withArchived = [...fields.slice(0, 2), def({ id: "fa", label: "قديم جدًا", type: "TEXT", archived: true })];
    const markup = manage(true, withArchived);
    expect(textOf(markup)).toContain("2 من 15");
    expect(markup).toContain('data-field-archived="fa"');
    expect(markup).toContain('aria-label="استرجاع: قديم جدًا"');
    expect(manage(false, withArchived)).not.toContain("data-field-archived");
  });

  it("disables «حقل جديد» at 15 live fields", () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => def({ id: `x${i}`, label: `حقل ${i}`, type: "TEXT" }));
    const markup = manage(true, fifteen);
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*حقل جديد/);
  });

  it("the reorder is the side menu's own sortable (grip, keyboard, announcements) and sends one `afterId`", () => {
    const src = read("src/components/custom-fields/manage-fields.tsx");
    expect(src).toContain('from "@/components/shell/nav-sort"');
    expect(src).toContain("SortableList");
    expect(src).toContain("movedAfter");
    expect(src).toMatch(/patch\(moved\.id, \{ afterId: moved\.afterId \}\)/);
  });
});

describe("«حقول مخصصة»: where a drag landed", () => {
  it("names the field that moved and the one it now sits after (null: first)", () => {
    expect(movedAfter(["a", "b", "c"], ["c", "a", "b"])).toEqual({ id: "c", afterId: null });
    expect(movedAfter(["a", "b", "c"], ["b", "c", "a"])).toEqual({ id: "a", afterId: "c" });
    expect(movedAfter(["a", "b", "c"], ["a", "c", "b"])).toMatchObject({ afterId: expect.any(String) });
    expect(movedAfter(["a", "b", "c", "d"], ["a", "d", "b", "c"])).toEqual({ id: "d", afterId: "a" });
    expect(movedAfter(["a", "b"], ["a", "b"])).toBeNull();
    expect(movedAfter(["a", "b"], ["a", "x"])).toBeNull();
    expect(movedAfter(["a"], ["a"])).toBeNull();
  });
});

describe("«حقول مخصصة»: the fields a person chose to show (this browser only)", () => {
  it("reads at most three string ids from the stored text and treats anything broken as none", () => {
    expect(parseChosen('["a","b","c","d"]')).toEqual(["a", "b", "c"]);
    expect(parseChosen('["a","a","b"]')).toEqual(["a", "b"]);
    for (const bad of [null, undefined, "", "nope", "{}", "[1,2]", '"x"']) expect(parseChosen(bad as never), String(bad)).toEqual([]);
    expect(parseChosen('["a",5,"b"]')).toEqual(["a", "b"]);
  });

  it("a fourth tick is refused, a second tick clears", () => {
    expect(MAX_CHIP_FIELDS).toBe(3);
    expect(toggleChosen(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleChosen(["a", "b", "c"], "d")).toEqual(["a", "b", "c"]);
    expect(toggleChosen(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("the store guards every storage call with try/catch and renders without it", () => {
    const src = read("src/components/custom-fields/chosen-store.ts");
    expect(CHOSEN_KEY).toMatch(/^zk\./);
    expect((src.match(/localStorage/g) ?? []).length).toBe(2);
    expect((src.match(/try \{/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/catch \{/);
  });
});

describe("«حقول مخصصة»: chips on the rows and the picker", () => {
  const cells = {
    f1: { label: "الأولوية", text: "عالي", color: "danger" as const },
    f2: { label: "الوزن", text: "12.5 كغ" },
  };

  it("draws nothing before a choice is made (the server and the first frame agree), and nothing for a task with no answers", () => {
    expect(render(createElement(FieldChips, { cells }))).toBe("");
    expect(render(createElement(FieldChips, { cells: undefined }))).toBe("");
  });

  it("the picker lists the fields, groups by project when there are several, and is absent when there is nothing to pick", () => {
    expect(render(createElement(FieldChipPicker, { defs: [] }))).toBe("");
    const one = render(createElement(FieldChipPicker, { defs: [{ id: "f1", projectId: "p1", projectName: "مشروع", label: "الأولوية" }] }));
    expect(one).toContain("data-field-picker");
    expect(textOf(one)).toContain("حقول للعرض");
    expect(textOf(one)).toContain("الأولوية");
    expect(textOf(one)).not.toContain("مشروع ›");
    const many = render(createElement(FieldChipPicker, { defs: [{ id: "f1", projectId: "p1", projectName: "مشروع أ", label: "الأولوية" }, { id: "f2", projectId: "p2", projectName: "مشروع ب", label: "الوزن" }] }));
    expect(textOf(many)).toContain("مشروع أ › الأولوية");
    expectClean(one);
    expectClean(many);
  });

  it("the rows and the cards draw the chips, and the pages hand the cells over only through the server's own gate", () => {
    expect(read("src/components/task-row.tsx")).toContain("<FieldChips cells={task.fields} />");
    expect(read("src/components/board-view.tsx")).toContain("<FieldChips cells={task.fields} block />");
    expect(read("src/components/board-view.tsx")).toContain("<FieldChipPicker defs={fieldDefs} />");
    expect(read("src/app/(app)/boards/[id]/page.tsx")).toContain("fieldCellsFor(");
    expect(read("src/app/(app)/list/page.tsx")).toContain("fieldCellsFor(");
  });
});

describe("«حقول مخصصة»: the list's field bar", () => {
  const props = {
    params: { workspace: "w1", group: "status", priority: "", assignee: "", q: "" },
    projects: [{ id: "p1", name: "مشروع" }],
    projectId: "p1",
    filterFields: [
      { id: "f5", label: "الأولوية", type: "SINGLE_CHOICE" as const, options: [{ id: "o1", label: "عالي" }] },
      { id: "f7", label: "عاجل", type: "BOOLEAN" as const, options: [] },
    ],
    sortFields: [{ id: "f3", label: "الوزن" }],
    people,
    pickerDefs: [],
  };

  it("offers the project, the field to filter by, the field to sort by, and the exact total", () => {
    const markup = render(createElement(FieldListControls, { ...props, total: { label: "المجموع: 10.3", text: "10.3" } }));
    const text = textOf(markup);
    expect(markup).toContain("data-field-controls");
    expect(text).toContain("كل المشاريع");
    expect(text).toContain("فلتر بحقل");
    expect(markup).toContain('aria-label="ترتيب بحقل"');
    expect(text).toContain("الترتيب الافتراضي");
    expect(text).toContain("الوزن");
    expect(text).toContain("المجموع: 10.3");
    expectClean(markup);
  });

  it("shows the values of the chosen filter field (yes/no, the options, the people) and the direction once a sort is chosen", () => {
    const yesNo = textOf(render(createElement(FieldListControls, { ...props, params: { ...props.params, ff: "f7" } })));
    expect(yesNo).toContain("نعم");
    expect(yesNo).toContain("لا");
    const choice = textOf(render(createElement(FieldListControls, { ...props, params: { ...props.params, ff: "f5" } })));
    expect(choice).toContain("عالي");
    const sorted = textOf(render(createElement(FieldListControls, { ...props, params: { ...props.params, fs: "f3", fd: "desc" } })));
    expect(sorted).toContain("تصاعدي");
    expect(sorted).toContain("تنازلي");
    // no project, no field controls
    const none = textOf(render(createElement(FieldListControls, { ...props, projectId: "", params: props.params })));
    expect(none).not.toContain("فلتر بحقل");
    expect(none).not.toContain("الترتيب الافتراضي");
  });

  it("the list keeps these parameters when another filter changes", () => {
    expect(read("src/components/list-filters.tsx")).toMatch(/Object\.entries\(extraParams \?\? \{\}\)/);
    expect(read("src/app/(app)/list/page.tsx")).toContain("extraParams={fieldList?.params}");
  });
});

describe("«حقول مخصصة»: a refused completion says which fields and sends the person to the task", () => {
  const refused = new ApiError("validation.failed", 422, { missing: [{ id: "f1", label: "الميزانية" }] }, "fields.required");

  it("the tick box on a row toasts the labels and opens the task at the fields card", () => {
    const src = read("src/components/task-row.tsx");
    expect(src).toContain('rt("fields.required_toast"');
    expect(src).toContain("router.push(`/tasks/${task.id}#${FIELDS_ANCHOR}`)");
  });

  it("the board drag rolls back, toasts the labels and opens the task at the fields card", () => {
    const src = read("src/components/board-view.tsx");
    expect(src).toContain('rt("fields.required_toast"');
    expect(src).toContain("window.location.assign(`/tasks/${activeTaskId}#${FIELDS_ANCHOR}`)");
    expect(src.indexOf("setItems(previous)")).toBeLessThan(src.indexOf("requiredFieldsOf(err)"));
  });

  it("Today's tick says «يجب تعبئة الحقول المطلوبة…» instead of a vague failure", async () => {
    const result = await completeTask("t1", async () => {
      throw refused;
    });
    expect(result).toEqual({ ok: false, messageKey: "fields.required" });
    const other = await completeTask("t1", async () => {
      throw new ApiError("forbidden", 403);
    });
    expect(other).toEqual({ ok: false, messageKey: "forbidden" });
  });
});

describe("«حقول مخصصة»: the pages are wired behind the switch and the partner rule", () => {
  it("the task page asks the service, which answers null for a switched-off company and an empty card for a partner", () => {
    const page = read("src/app/(app)/tasks/[id]/page.tsx");
    expect(page).toContain("taskFieldsCard(");
    expect(page).toContain("customFieldsSlot=");
    expect(page).toMatch(/canEdit=\{sheet\.canEdit && !sheet\.lockedFields && !ownerOutsideSpace\}/);
    // the sheet's rule (src/server/services/task-sheet.ts, shared with the phone): the owner reading a space he is not in never writes
    expect(read("src/server/services/task-sheet.ts")).toContain('const ownerOutsideSpace = membership?.role === "OWNER" && !spaceRow;');
    expect(read("src/server/services/custom-fields.ts")).toMatch(/if \(!\(await isFeatureOn\(ctx\.orgId, FEATURE\)\)\) return null;\s+if \(await isPartnerIn\(ctx, task\.workspaceId\)\) return EMPTY_CARD;/);
  });

  it("the project page draws «إدارة الحقول» only while the switch is on and never for a partner; the controls are the ADMIN's and the owner's", () => {
    const page = read("src/app/(app)/projects/[id]/page.tsx");
    expect(page).toContain('actorFeatureOn(actor, "customFields")');
    expect(page).toContain("isPartnerIn(");
    expect(page).toContain("<ManageFields");
    expect(page).toMatch(/canManageFields[\s\S]{0,400}spaceRow\?\.role === "ADMIN"/);
  });

  it("every colour on these screens is a theme token (no palette, no hex), every direction logical", () => {
    for (const file of ["task-fields-card.tsx", "manage-fields.tsx", "field-chips.tsx", "list-controls.tsx"]) {
      const src = read(`src/components/custom-fields/${file}`);
      expect(src, file).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      expect(src, file).not.toMatch(/\b(?:bg|text|border|ring)-(?:red|green|blue|yellow|gray|slate|zinc|neutral|amber|emerald|sky|indigo|violet|rose|pink|teal|lime)-\d{2,3}\b/);
      expect(src, file).not.toMatch(/\b(?:ml|mr|pl|pr|text-left|text-right|left|right)-\d/);
    }
  });
});
