import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/my-work",
}));

import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { WorkRow } from "@/components/work/my-tasks/work-row";
import { DueDayChip } from "@/components/work/my-tasks/due-chip";
import { dueDayLabel } from "@/lib/work/due-label";
import type { WorkTaskDto } from "@/lib/work/my-tasks";
import { textOf } from "./ui-render";

/**
 * P2.3 — «مهامي» on a phone (390px). Three complaints of the owner: the quick-add bar is cut at its edges, the date shows the browser's own `mm/dd/yyyy`,
 * and the filter / sort / view rows overflow or wrap badly. Source-text pins for the layout (like tests/phone-squeeze.test.ts) and a render for the date chip.
 */
const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const count = (text: string, needle: string) => text.split(needle).length - 1;

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const render = (element: ReactElement): string =>
  renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Toasts, null, element))));

const WORDS = { today: "اليوم", tomorrow: "بكرا", yesterday: "أمس" };

describe("the date chip's words (dueDayLabel)", () => {
  it("says اليوم, بكرا and أمس for the three days around the company's today", () => {
    expect(dueDayLabel("2026-11-21", "2026-11-21", WORDS)).toBe("اليوم");
    expect(dueDayLabel("2026-11-22", "2026-11-21", WORDS)).toBe("بكرا");
    expect(dueDayLabel("2026-11-20", "2026-11-21", WORDS)).toBe("أمس");
  });

  it("says a farther day as «23 تشرين الثاني» (the year only when it is not this year), across a month and a year end", () => {
    expect(dueDayLabel("2026-11-23", "2026-11-21", WORDS)).toBe("23 تشرين الثاني");
    expect(dueDayLabel("2026-12-01", "2026-11-30", WORDS)).toBe("بكرا");
    expect(dueDayLabel("2027-01-01", "2026-12-31", WORDS)).toBe("بكرا");
    expect(dueDayLabel("2027-02-05", "2026-11-21", WORDS)).toBe("5 شباط 2027");
    expect(dueDayLabel("2026-01-05", "2026-11-21", WORDS)).toBe("5 كانون الثاني");
  });

  it("without a today it is the date alone; with no day or a broken one it is empty", () => {
    expect(dueDayLabel("2026-11-21", undefined, WORDS)).toBe("21 تشرين الثاني");
    expect(dueDayLabel(null, "2026-11-21", WORDS)).toBe("");
    expect(dueDayLabel("", "2026-11-21", WORDS)).toBe("");
    expect(dueDayLabel("not-a-day", "2026-11-21", WORDS)).toBe("");
  });
});

describe("the date chip: a short Arabic label, the native picker only on a tap", () => {
  const chip = (props: Partial<React.ComponentProps<typeof DueDayChip>> = {}) =>
    render(createElement(DueDayChip, { day: "2026-11-23", todayIso: "2026-11-21", onChange: () => {}, ...props }));

  it("shows «23 تشرين الثاني» (not mm/dd/yyyy) and keeps the date input as an invisible layer over the label", () => {
    const markup = chip();
    expect(textOf(markup)).toBe("23 تشرين الثاني");
    expect(markup).not.toMatch(/mm\/dd\/yyyy|\d{2}\/\d{2}\/\d{4}/);
    expect(markup).toMatch(/<label[^>]*class="[^"]*\brelative\b/);
    expect(markup).toMatch(/<input[^>]*type="date"[^>]*class="[^"]*\babsolute\b[^"]*\binset-0\b[^"]*\bopacity-0\b/);
    expect(markup).toContain('value="2026-11-23"');
    expect(markup).toContain('aria-label="تاريخ الاستحقاق"');
  });

  it("says اليوم and بكرا; an empty day says «بدون موعد» (a chip to tap, never an empty native box)", () => {
    expect(textOf(chip({ day: "2026-11-21" }))).toBe("اليوم");
    expect(textOf(chip({ day: "2026-11-22" }))).toBe("بكرا");
    expect(textOf(chip({ day: null }))).toBe("بدون موعد");
  });

  it("an overdue day wears the danger colour on the label, a plain one the quiet colour", () => {
    expect(chip({ overdue: true })).toMatch(/<label[^>]*class="[^"]*\btext-danger\b/);
    expect(chip()).toMatch(/<label[^>]*class="[^"]*\btext-fg-muted\b/);
  });

  it("the tap opens the picker by showPicker (a desktop browser opens it only from its tiny icon otherwise), and a refusal of the browser is not an error", () => {
    const src = read("src/components/work/my-tasks/due-chip.tsx");
    expect(src).toContain("showPicker");
    expect(src).toMatch(/try \{[\s\S]*showPicker\(\)[\s\S]*\} catch/);
  });
});

describe("the row and the panel use the chip", () => {
  const task = (over: Partial<WorkTaskDto>): WorkTaskDto => ({
    id: "1",
    key: "ZK-1",
    title: "مهمة",
    priority: "NORMAL",
    dueDate: null,
    dueDay: null,
    completedAt: null,
    columnId: "c1",
    columnName: "todo",
    columnStage: "TODO",
    columnDone: false,
    workspaceId: "w1",
    spaceName: "ألفا",
    projectId: "p1",
    projectName: "مشروع أ",
    assigneeId: "u1",
    assigneeName: "سارة",
    assigneeIds: ["u1"],
    assigneeNames: ["سارة"],
    creatorId: "u1",
    visibility: "SPACE",
    updatedAt: "2026-11-01T00:00:00.000Z",
    editable: true,
    ...over,
  });
  const row = (t: WorkTaskDto, todayIso?: string) => render(createElement(WorkRow, { task: t, showSpace: false, todayIso, onOpen: () => {}, onToggle: () => {}, onDue: () => {} }));

  it("a row says بكرا in words and has no bare date box", () => {
    const markup = row(task({ dueDay: "2026-11-22", dueDate: "2026-11-22T09:00:00.000Z" }), "2026-11-21");
    expect(textOf(markup)).toContain("بكرا");
    expect(markup).not.toMatch(/<input[^>]*type="date"[^>]*class="[^"]*\bw-(24|28)\b/);
    expect(markup).toMatch(/<input[^>]*type="date"[^>]*\bopacity-0\b/);
  });

  it("a row with no day says «بدون موعد»; a read-only one has no date input at all", () => {
    expect(textOf(row(task({}), "2026-11-21"))).toContain("بدون موعد");
    expect(row(task({ editable: false, dueDate: "2026-11-22T09:00:00.000Z" }), "2026-11-21")).not.toContain('type="date"');
  });

  it("the row and the side panel both draw the chip, neither a raw date input", () => {
    for (const file of ["work-row", "task-panel"]) {
      const src = read(`src/components/work/my-tasks/${file}.tsx`);
      expect(src, file).toContain("<DueDayChip");
      expect(src, file).not.toContain('type="date"');
    }
  });
});

describe("the quick-add bar is not cut at its edges", () => {
  const src = read("src/components/work/my-tasks/quick-add.tsx");
  it("the bar is the full width and may shrink; the title box shrinks and ends its placeholder with …; the button never shrinks", () => {
    expect(src).toContain('className="mt-2 flex w-full min-w-0 items-center gap-2');
    expect(src).toMatch(/<input[\s\S]*?className="[^"]*\bmin-w-0 flex-1\b[^"]*\btext-ellipsis\b/);
    expect(src).toMatch(/type="submit"[\s\S]*?className="[^"]*\bshrink-0\b/);
    expect(src).toMatch(/<Plus className="size-4 shrink-0"/);
  });
});

describe("the toolbar: single rows that slide sideways, with no scrollbar and no cut", () => {
  const src = read("src/components/work/my-tasks/toolbar.tsx");
  it("the views+scopes, the chips and the sort/stage/group selects are each ONE strip: strip-scroll, overflow-x-auto, bleeding to the screen's edge on a phone", () => {
    expect(count(src, "strip-scroll flex")).toBe(3);
    expect(count(src, "max-md:-mx-4 max-md:px-4")).toBe(3);
    expect(count(src, "overflow-x-auto")).toBe(3);
    expect(src).not.toContain("max-md:[scrollbar-width:none]");
  });

  it("nothing inside a strip shrinks (so nothing is squeezed to a sliver), and a desktop strip wraps as before", () => {
    expect(count(src, "[&>*]:shrink-0")).toBe(3);
    expect(count(src, "md:flex-wrap")).toBeGreaterThanOrEqual(3);
  });

  it("the search and «مهام قديمة» get their own full-width line on a phone (md:contents keeps the desktop row as it was)", () => {
    expect(src).toContain("md:contents");
    expect(src).toContain("max-md:w-full");
    expect(src).toContain("min-w-0 flex-1");
  });
});
