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

  it("P2.1: the phone's chrome is brief too — no presence row under the page, no round bubbles, the compass in the drawer (details: tests/phone-chrome.test.ts)", () => {
    const shellSrc = read("src/components/app-shell.tsx");
    expect(shellSrc).toContain("hideOnPhone={navV2}");
    expect(read("src/components/shell/quick-chat.tsx")).toContain("max-md:hidden");
    expect(read("src/components/site-guide/site-guide.tsx")).toContain("max-md:hidden");
    expect(read("src/components/shell/drawer.tsx")).toContain('data-shell="drawer-guide"');
  });

  it("the card under «المساحة» keeps its words wide enough to read next to its button", () => {
    const page = read("src/app/(app)/spaces/current/page.tsx");
    expect(page).not.toContain("min-w-0 flex-1 text-sm");
    expect(page.match(/min-w-\[14rem\] flex-1/g)).toHaveLength(3);
  });
});

describe("batch 0: the small things", () => {
  it("the assignee chip shortens a name at the whitespace (a real \s, not the letter s)", () => {
    const form = read("src/components/today/quick-add.tsx");
    const backslash = String.fromCharCode(92);
    expect(form).toContain(`.split(/${backslash}s+/)[0]`);
    expect(form).not.toContain(".split(/s+/)");
  });

  it("the chat tab that holds a space's topics is called «المواضيع» when the list is of ONE space, «المساحات» otherwise", async () => {
    const { tabsOf } = await import("@/lib/chat/folders");
    const label = (tabs: ReturnType<typeof tabsOf>) => tabs.find((t) => t.key === "spaces")?.labelKey;
    expect(label(tabsOf({ canOversee: false, oneSpace: true }))).toBe("chatui.folder.topics");
    expect(label(tabsOf({ canOversee: false }))).toBe("chatui.folder.spaces");
    // the shared list of tabs is never changed by the first call
    expect(label(tabsOf({ canOversee: false }))).toBe("chatui.folder.spaces");
    expect(AR["chatui.folder.topics"]).toBe("المواضيع");
  });
});
