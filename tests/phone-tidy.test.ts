import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { quickInboxBody, quickTaskBody, QUICK_DESCRIPTION_MAX, type TodayQuickAddData } from "@/lib/today";
import { AR } from "@/lib/i18n/dict";

const read = (path: string) => readFileSync(path, "utf8");

const quickAdd: TodayQuickAddData = {
  assigneeId: "me",
  targets: [{ projectId: "p1", workspaceId: "w1", boardId: "b1", projectName: "مشروع", workspaceName: "مساحة" }],
  dueToday: "2026-11-21T10:00:00.000Z",
  dueTomorrow: "2026-11-22T10:00:00.000Z",
} as TodayQuickAddData;

describe("the new-task sheet: one tap to give it to somebody, and what it needs", () => {
  it("the task is the person's own with no specification until they choose otherwise (as before)", () => {
    const task = quickTaskBody(quickAdd, { projectId: "p1", title: "اتصل", due: "none", timeZone: "Asia/Amman" });
    expect(task).toMatchObject({ assigneeId: "me" });
    expect(task).not.toHaveProperty("description");
    const inbox = quickInboxBody(quickAdd, { title: "اتصل", due: "none", timeZone: "Asia/Amman" });
    expect(inbox).toMatchObject({ assigneeId: "me" });
    expect(inbox).not.toHaveProperty("description");
  });

  it("the person tapped, and the specification written, go in both bodies (trimmed, cut, never empty)", () => {
    const task = quickTaskBody(quickAdd, { projectId: "p1", title: "اتصل", due: "none", timeZone: "Asia/Amman", assigneeId: "u2", description: "  بالمورّد قبل الظهر  " });
    expect(task).toMatchObject({ assigneeId: "u2", description: "بالمورّد قبل الظهر" });
    const inbox = quickInboxBody(quickAdd, { title: "اتصل", due: "none", timeZone: "Asia/Amman", assigneeId: "u2", description: "x".repeat(QUICK_DESCRIPTION_MAX + 50) });
    expect(inbox?.assigneeId).toBe("u2");
    expect(inbox?.description).toHaveLength(QUICK_DESCRIPTION_MAX);
    expect(quickInboxBody(quickAdd, { title: "اتصل", due: "none", timeZone: "Asia/Amman", description: "   " })).not.toHaveProperty("description");
  });

  it("the form shows the people of the space as one-tap chips and a field for what the task needs; the inbox route takes the text", () => {
    const form = read("src/components/today/quick-add.tsx");
    expect(form).toContain('data-quick="assignees"');
    expect(form).toContain('name="description"');
    expect(form).toMatch(/\/api\/workspaces\/\$\{workspaceId\}\/members/);
    expect(read("src/app/api/instant/inbox/route.ts")).toMatch(/description: z\.string\(\)\.max\(10_000\)/);
    for (const key of ["today.quick.assignee", "today.quick.me", "today.quick.description", "today.quick.description_placeholder"]) expect(AR[key]).toBeTruthy();
  });
});

describe("the phone is brief and in order", () => {
  it("«مهامي»: the spaces are one dropdown and the chips and the selects run on one line each, instead of wrapping into rows", () => {
    const bar = read("src/components/work/my-tasks/toolbar.tsx");
    expect(bar).toMatch(/<select aria-label=\{t\("mytasks\.space\.label"\)\}/);
    expect(bar).toContain("overflow-x-auto");
  });

  it("«القائمة» in the settings is dragged by its grip (the arrows stay for the keyboard)", () => {
    const menu = read("src/components/settings-me/menu-section.tsx");
    expect(menu).toContain("<SortableList");
    expect(menu).toContain("<Grip");
    expect(menu).toContain("settingsMe.m.up");
  });

  it("the card under «المساحة» keeps its words wide enough to read next to its button", () => {
    const page = read("src/app/(app)/spaces/current/page.tsx");
    expect(page).not.toContain("min-w-0 flex-1 text-sm");
    expect(page.match(/min-w-\[14rem\] flex-1/g)).toHaveLength(3);
  });
});
