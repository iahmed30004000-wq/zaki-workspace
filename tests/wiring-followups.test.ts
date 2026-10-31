import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/tasks/t1",
}));

import { LinkedApprovals } from "@/components/approvals/linked-approvals";
import type { ListItem } from "@/lib/approvals/view";
import { summarizeDays, type PersonDayCount } from "@/lib/checkins";
import { exportCell, exportHeader, fieldsCsv, type ExportRow } from "@/lib/custom-fields-csv";
import type { FieldDefDto } from "@/lib/custom-fields";
import { fmtMinutes } from "@/lib/format";
import { sectionText } from "@/lib/owner-board";
import { loadSections, BOARD_SECTIONS, type BoardSection, type SectionContext } from "@/server/services/owner-board-sections";
import { SCORE_SECTIONS } from "@/server/services/team-score-sections";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, render, textOf } from "./ui-render";

/**
 * «ربط الأجزاء» — the pure parts of the four follow-ups: the approvals block on a task / card, the check-in days beside the score,
 * the time column on the owner board, and the CSV of a project's custom-field values. The rules that need a database (who may read
 * what) are pinned in tests/db/wiring-followups.test.ts.
 */

// ───────────────────────────────────────── 1. the approvals block ─────────────────────────────────────────

const item = (over: Partial<ListItem> = {}): ListItem => ({
  id: "r1",
  workspaceId: "w1",
  workspaceName: "مساحة المبيعات",
  title: "شراء جهاز",
  status: "PENDING",
  version: 1,
  currentStep: 1,
  requester: { id: "u1", name: "سارة" },
  amount: null,
  createdAt: "2031-03-20T09:00:00.000Z",
  updatedAt: "2031-03-20T09:00:00.000Z",
  decidedAt: null,
  steps: [{ position: 1, approver: { id: "u2", name: "خالد" }, status: "PENDING" }],
  waitingOn: { id: "u2", name: "خالد" },
  fromForm: false,
  ...over,
});

describe("the approvals block on a task or a card", () => {
  it("the button enters the thing's own space first and opens the new-request form linked to it", () => {
    const markup = render(createElement(LinkedApprovals, { kind: "TASK", id: "t1", workspaceId: "w1", canAsk: true, items: [] }));
    const href = /href="([^"]*go[^"]*)"/.exec(markup)?.[1]?.replace(/&amp;/g, "&");
    expect(href).toBeTruthy();
    const url = new URL(href!, "http://x.invalid");
    expect(url.pathname).toBe("/go");
    expect(url.searchParams.get("space")).toBe("w1");
    expect(url.searchParams.get("next")).toBe("/approvals?new=1&link=TASK:t1");
    expect(markup).toContain("data-linked-approvals-ask");
    expect(textOf(markup)).toContain("طلب موافقة");
  });

  it("a card links with CARD, and a person who may not ask is shown no button at all", () => {
    const withButton = render(createElement(LinkedApprovals, { kind: "CARD", id: "c9", workspaceId: "w2", canAsk: true, items: [] }));
    expect(decodeURIComponent(withButton)).toContain("link=CARD:c9");
    const without = render(createElement(LinkedApprovals, { kind: "CARD", id: "c9", workspaceId: "w2", canAsk: false, items: [] }));
    expect(without).not.toContain("data-linked-approvals-ask");
    expect(without).not.toContain("/go?");
  });

  it("lists the linked requests with their state and who they wait on, and says so when there are none", () => {
    const markup = render(createElement(LinkedApprovals, { kind: "TASK", id: "t1", workspaceId: "w1", canAsk: true, items: [item(), item({ id: "r2", status: "APPROVED", waitingOn: null })] }));
    expect(markup).toContain('href="/approvals/r1"');
    expect(markup).toContain('href="/approvals/r2"');
    const text = textOf(markup);
    expect(text).toContain("بانتظار القرار");
    expect(text).toContain("تمت الموافقة");
    expect(text).toContain("بانتظار خالد");
    expect(markup).not.toContain("data-linked-approvals-empty");
    const empty = render(createElement(LinkedApprovals, { kind: "TASK", id: "t1", workspaceId: "w1", canAsk: true, items: [] }));
    expect(empty).toContain("data-linked-approvals-empty");
  });

  it("keeps the screen rules: theme tokens only, logical directions, no Latin word", () => {
    const markup = render(createElement(LinkedApprovals, { kind: "TASK", id: "t1", workspaceId: "w1", canAsk: true, items: [item()] }));
    const tokens = classTokens(markup);
    expect(tokens.filter((t) => PALETTE_COLOUR.test(t))).toEqual([]);
    expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t))).toEqual([]);
    expect(textOf(markup)).not.toMatch(/[A-Za-z]{2,}/);
  });
});

// ───────────────────────────────────────── 2. check-in days beside the score ─────────────────────────────────────────

const day = (userId: string, d: string, state: "answered" | "missed" | "excused" | "pending"): PersonDayCount => ({
  userId,
  day: d,
  answered: state === "answered" ? 1 : 0,
  missed: state === "missed" ? 1 : 0,
  excused: state === "excused" ? 1 : 0,
  pending: state === "pending" ? 1 : 0,
});

describe("the answered days and the run of them (numbers only)", () => {
  it("counts answered, missed and excused days and the run of answered days back from the newest", () => {
    const s = summarizeDays([
      day("a", "2026-10-01", "answered"),
      day("a", "2026-10-02", "missed"),
      day("a", "2026-10-05", "answered"),
      day("a", "2026-10-06", "excused"),
      day("a", "2026-10-07", "answered"),
    ]).get("a")!;
    expect(s).toEqual({ answered: 3, missed: 1, excused: 1, streak: 2 }); // 07 and 05: the excused day is skipped, the missed one ends the run
  });

  it("a round still open neither counts nor breaks the run; a run of nothing is zero", () => {
    expect(summarizeDays([day("a", "2026-10-05", "answered"), day("a", "2026-10-06", "pending")]).get("a")).toMatchObject({ answered: 1, streak: 1 });
    expect(summarizeDays([day("a", "2026-10-05", "missed")]).get("a")).toMatchObject({ answered: 0, streak: 0 });
    expect(summarizeDays([]).size).toBe(0);
  });

  it("a day answered in ANY space is an answered day, and a day missed in one space and answered in another is counted once", () => {
    const s = summarizeDays([day("a", "2026-10-05", "missed"), day("a", "2026-10-05", "answered"), day("a", "2026-10-06", "answered"), day("a", "2026-10-06", "excused")]).get("a")!;
    expect(s).toEqual({ answered: 2, missed: 0, excused: 0, streak: 2 });
  });

  it("people are counted apart", () => {
    const s = summarizeDays([day("a", "2026-10-05", "answered"), day("b", "2026-10-05", "missed")]);
    expect(s.get("a")).toMatchObject({ answered: 1, streak: 1 });
    expect(s.get("b")).toMatchObject({ answered: 0, missed: 1, streak: 0 });
  });
});

describe("the sections registered on the score and on the board", () => {
  it("the score carries the time and the check-ins, the board carries the time", () => {
    expect(SCORE_SECTIONS.map((s) => s.id)).toEqual(["time", "checkins"]);
    expect(BOARD_SECTIONS.map((s) => s.id)).toEqual(["time"]);
    const columns = SCORE_SECTIONS.flatMap((s) => s.columns.map((c) => c.key));
    expect(columns).toEqual(["time.minutes", "checkins.answered", "checkins.streak"]);
    // both are counts of days, never a text
    for (const c of SCORE_SECTIONS.find((s) => s.id === "checkins")!.columns) expect(c.kind).toBe("count");
  });

  it("a section whose switch is off is skipped altogether: no column of dashes", async () => {
    const ctx = { orgId: "o", timeZone: "UTC", window: { from: "2026-10-01", to: "2026-10-31", days: [], start: new Date(0), end: new Date(1), preset: "custom", today: "2026-10-31" }, scope: { restricted: false, workspaceIds: [], teamIds: [] }, userIds: ["u"] } as SectionContext;
    const make = (id: string, enabled: boolean): BoardSection => ({
      id,
      columns: [{ key: `${id}.n`, labelKey: "a", formulaKey: "b", kind: "count" }],
      enabled: async () => enabled,
      load: async () => new Map([["u", { [`${id}.n`]: 5 }]]),
    });
    const loaded = await loadSections(ctx, [make("on", true), make("off", false)]);
    expect(loaded.columns.map((c) => c.key)).toEqual(["on.n"]);
    expect(loaded.values.get("u")).toEqual({ "on.n": 5 });
  });

  it("minutes are written as hours:minutes with Western digits, a count with commas, nothing as a dash", () => {
    expect(fmtMinutes(90)).toBe("1:30");
    expect(fmtMinutes(0)).toBe("0:00");
    expect(fmtMinutes(61 * 60 + 5)).toBe("61:05");
    expect(fmtMinutes(null)).toBe("");
    expect(sectionText("minutes", 125)).toBe("2:05");
    expect(sectionText("count", 12345)).toBe("12,345");
    expect(sectionText("count", null)).toBe("—");
    expect(sectionText("text", "x")).toBe("x");
  });
});

// ───────────────────────────────────────── 4. the CSV of custom-field values ─────────────────────────────────────────

const def = (over: Partial<FieldDefDto> & { id: string; type: FieldDefDto["type"]; label: string }): FieldDefDto => ({ required: false, archived: false, unit: null, currency: null, options: [], ...over });

describe("the CSV of a project's custom-field values", () => {
  const defs: FieldDefDto[] = [
    def({ id: "f1", type: "TEXT", label: "ملاحظة" }),
    def({ id: "f2", type: "NUMBER", label: "الكمية", unit: "قطعة" }),
    def({ id: "f3", type: "MONEY", label: "التكلفة", currency: "USD" }),
    def({ id: "f4", type: "SINGLE_CHOICE", label: "النوع", options: [{ id: "o1", label: "عاجل", color: "danger" }, { id: "o2", label: "قديم", color: "muted", deleted: true }] }),
    def({ id: "f5", type: "MULTI_CHOICE", label: "وسوم", options: [{ id: "o1", label: "أ", color: "muted" }, { id: "o2", label: "ب", color: "muted" }] }),
    def({ id: "f6", type: "BOOLEAN", label: "جاهز" }),
    def({ id: "f7", type: "PERSON", label: "المسؤول عنه" }),
    def({ id: "f8", type: "DATE", label: "الموعد" }),
  ];
  const names = new Map([["p1", "ليلى"]]);

  it("writes each type the way a person reads it", () => {
    expect(exportCell(defs[0]!, "نص", names)).toBe("نص");
    expect(exportCell(defs[1]!, "12.5", names)).toBe(12.5);
    expect(exportCell(defs[1]!, "-3", names)).toBe(-3); // a negative number stays a number, not an apostrophe
    expect(exportCell(defs[1]!, "12345678901234567.5", names)).toBe("12345678901234567.5"); // too long to be a float: the exact text
    expect(exportCell(defs[2]!, 250, names)).toBe(250);
    expect(exportCell(defs[3]!, "o1", names)).toBe("عاجل");
    expect(exportCell(defs[3]!, "o2", names)).toBe("محذوف");
    expect(exportCell(defs[3]!, "gone", names)).toBe("محذوف");
    expect(exportCell(defs[4]!, ["o1", "o2"], names)).toBe("أ، ب");
    expect(exportCell(defs[5]!, true, names)).toBe("نعم");
    expect(exportCell(defs[5]!, false, names)).toBe("لا");
    expect(exportCell(defs[6]!, "p1", names)).toBe("ليلى");
    expect(exportCell(defs[6]!, "p2", names)).toBe("شخص سابق");
    expect(exportCell(defs[7]!, "2026-10-05", names)).toBe("2026-10-05");
    expect(exportCell(defs[0]!, undefined, names)).toBeNull();
  });

  it("the header carries the unit or the currency", () => {
    expect(exportHeader(defs[1]!)).toBe("الكمية (قطعة)");
    expect(exportHeader(defs[2]!)).toBe("التكلفة (USD)");
    expect(exportHeader(defs[0]!)).toBe("ملاحظة");
  });

  it("the file has a byte order mark, CRLF rows, the fixed columns first, and no cell that a spreadsheet would run as a formula", () => {
    const rows: ExportRow[] = [
      { key: "MAIN-1", title: "=HYPERLINK(\"http://x\")", status: "قيد التنفيذ", assignee: "+سارة", values: { f1: "@SUM(A1)", f2: "-3", f3: 250, f6: true } },
      { key: "MAIN-2", title: "عادية, فيها فاصلة", status: "جديدة", assignee: null, values: {} },
    ];
    const csv = fieldsCsv([defs[0]!, defs[1]!, defs[2]!, defs[5]!], rows, names);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(4); // head, two rows, and the closing break
    expect(lines[0]).toBe("﻿الرقم,العنوان,الحالة,المسؤول,ملاحظة,الكمية (قطعة),التكلفة (USD),جاهز");
    expect(lines[1]).toContain("'=HYPERLINK(\"\"http://x\"\")");
    expect(lines[1]).toContain("'+سارة");
    expect(lines[1]).toContain("'@SUM(A1)");
    expect(lines[1]).toContain(",-3,250,نعم");
    expect(lines[2]).toContain('"عادية, فيها فاصلة"');
    for (const line of lines.slice(1, 3)) for (const cell of line.split(",")) expect(cell).not.toMatch(/^[=+@]/);
  });

  it("a label typed by the project's admin that starts with = is made safe in the header too", () => {
    const csv = fieldsCsv([def({ id: "x", type: "TEXT", label: "=cmd" })], [], names);
    expect(csv).toContain("'=cmd");
  });
});
