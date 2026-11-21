import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * P2.2 — the phone squeeze sweep. Layout only: every file below carried a text block that shrank to a sliver beside its button
 * (`min-w-0 flex-1` inside a row that cannot wrap), a header that does not wrap, a table cut off by `overflow-hidden`, or a strip
 * that drew its scrollbar. Each test reads the source and pins the class pattern that fixes it, like tests/phone-tidy.test.ts.
 */
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const count = (text: string, needle: string) => text.split(needle).length - 1;

describe("space settings: the words keep a readable width next to their button", () => {
  it("«الشغل» has three cards whose text block is min-w-[14rem] flex-1 inside a wrapping row", () => {
    const work = read("src/components/space-settings/work-tab.tsx");
    expect(count(work, '<div className="min-w-[14rem] flex-1">')).toBe(3);
    expect(work).not.toContain('<div className="min-w-0 flex-1">');
    expect(count(work, "flex flex-wrap items-center justify-between gap-3")).toBe(3);
  });

  it("«منطقة الخطر»: the archive card's text block is min-w-[14rem] flex-1 inside a wrapping row", () => {
    const danger = read("src/components/space-settings/danger-tab.tsx");
    expect(danger).toContain('<div className="min-w-[14rem] flex-1">');
    expect(danger).not.toContain('<div className="min-w-0 flex-1">');
    expect(danger).toContain("flex flex-wrap items-center justify-between gap-3");
  });
});

describe("the integration cards: the header wraps, the title keeps min-w-[10rem]", () => {
  for (const file of ["db-backup-card", "mail-to-task-card", "oms-link-card"]) {
    it(`${file}.tsx: icon + title + badge + button wrap onto a second line`, () => {
      const src = read(`src/components/${file}.tsx`);
      expect(src).toContain('<div className="flex flex-wrap items-center gap-2">');
      expect(src).toContain('<div className="min-w-[10rem] flex-1">');
      expect(src).not.toContain('<div className="flex items-center gap-2">\n        <span className="grid size-9');
    });
  }

  it("server-health-card.tsx: the title and the refresh button wrap", () => {
    const src = read("src/components/server-health-card.tsx");
    expect(src).toContain('<div className="flex flex-wrap items-start justify-between gap-3">');
    expect(src).toContain('<div className="min-w-[10rem] flex-1">');
  });
});

describe("device lists: a long device name wraps the button instead of squeezing", () => {
  it("settings-me devices-section.tsx: the browsers row and the sessions row both wrap", () => {
    const src = read("src/components/settings-me/devices-section.tsx");
    expect(src).toContain('<li key={s.id} className="flex flex-wrap items-center justify-between gap-3');
    expect(src).toContain('<div className="flex flex-wrap items-center justify-between gap-3">');
    expect(count(src, '<div className="min-w-[10rem] flex-1">')).toBe(2);
  });

  it("app-link.tsx: the paired devices row wraps", () => {
    const src = read("src/components/app-link/app-link.tsx");
    expect(src).toContain('<li key={d.id} className="flex flex-wrap items-center justify-between gap-3');
    expect(src).toContain('<div className="min-w-[10rem] flex-1">');
  });
});

describe("the two cut tables scroll sideways instead of being cut off", () => {
  it("automation-view.tsx: the event log has a horizontal scroll wrapper and a minimum table width", () => {
    const src = read("src/components/automation-view.tsx");
    expect(src).toContain('<div className="overflow-x-auto rounded-lg border border-border">');
    expect(src).toContain('<table className="w-full min-w-[32rem] text-right text-xs">');
    expect(src).not.toContain('<div className="overflow-hidden rounded-lg border border-border">');
  });

  it("members/section-grid.tsx: the permission grid scrolls sideways and keeps a minimum width", () => {
    const src = read("src/components/members/section-grid.tsx");
    expect(src).toContain('<div className="overflow-x-auto">');
    expect(src).toContain('<table className="w-full min-w-[19rem] table-fixed text-sm">');
  });
});

describe("analytics: the ideas funnel is two columns on a phone", () => {
  it("analytics-report.tsx: no bare grid-cols-4", () => {
    const src = read("src/components/control-panel/sections/analytics-report.tsx");
    expect(src).toContain("grid grid-cols-2 gap-2 sm:grid-cols-4");
    expect(src).not.toMatch(/grid grid-cols-4 /);
  });
});

describe("strips draw no scrollbar; pages keep theirs", () => {
  it("globals.css has the strip rule and still draws the 8px bar on pages", () => {
    const css = read("src/app/globals.css");
    expect(css).toMatch(/\.strip-scroll\s*\{\s*scrollbar-width:\s*none;/);
    expect(css).toMatch(/\.strip-scroll::-webkit-scrollbar\s*\{\s*display:\s*none;/);
    expect(css).toMatch(/::-webkit-scrollbar\s*\{\s*width:\s*8px;/);
    // the strip rule is never a bare `*` or `::-webkit-scrollbar` that would also hide the page's bar
    expect(css).not.toMatch(/\n\*\s*\{[^}]*scrollbar-width:\s*none/);
  });

  it("the panel's section strip and «شغلي»'s tab strip use it", () => {
    expect(read("src/components/control-panel/frame.tsx")).toContain('<ul className="strip-scroll flex gap-2 overflow-x-auto');
    expect(read("src/app/(app)/my-work/legacy-page.tsx")).toContain('<nav className="strip-scroll flex gap-1 overflow-x-auto');
  });
});

describe("the button never breaks a short label into two lines", () => {
  it("ui/button.tsx: whitespace-nowrap in the base, a link (inline text) may still wrap, an icon button is unaffected", () => {
    const src = read("src/components/ui/button.tsx");
    const base = src.match(/const button = cva\(\s*"([^"]+)"/)?.[1] ?? "";
    expect(base).toContain("whitespace-nowrap");
    expect(src).toMatch(/link: "h-auto whitespace-normal /);
    expect(src).toContain('icon: "size-11 md:size-8 rounded-full"');
  });
});

describe("the 360px sweep: tickets, CRM, goals, approvals, documents, files", () => {
  it("forms with two fields in a row stack below sm (a date or a long address needs the width)", () => {
    expect(count(read("src/components/crm-view.tsx"), "grid grid-cols-1 gap-3 sm:grid-cols-2")).toBe(2);
    expect(count(read("src/components/department-tickets.tsx"), "grid grid-cols-1 gap-2 sm:grid-cols-2")).toBe(2);
    expect(read("src/components/goals-view.tsx")).toContain("grid grid-cols-1 gap-2 sm:grid-cols-2");
    expect(read("src/components/okr/okr-parts.tsx")).toContain("grid grid-cols-1 gap-2 sm:grid-cols-3");
    for (const file of ["crm-view", "department-tickets", "goals-view", "okr/okr-parts"]) {
      expect(read(`src/components/${file}.tsx`), file).not.toMatch(/"grid grid-cols-[23] gap-[23]"/);
    }
  });

  it("CRM: a long customer or opportunity name wraps inside its card instead of pushing the buttons out", () => {
    const src = read("src/components/crm-view.tsx");
    expect(count(src, '<div className="flex min-w-0 items-center gap-2">')).toBe(2);
    expect(count(src, '<p className="break-words font-medium text-fg">')).toBe(2);
    expect(src).toContain('<div className="flex shrink-0 gap-1">');
  });

  it("files: the header wraps and the row actions never shrink", () => {
    const src = read("src/components/files-view.tsx");
    expect(src).toContain('<header className="flex flex-wrap items-center justify-between gap-3">');
    expect(src).toContain('<div className="min-w-[12rem] flex-1">');
    expect(src).toContain('<div className="flex shrink-0 items-center gap-1">');
  });

  it("documents: the new-document form keeps its title field min-w-[12rem] so the button wraps under it", () => {
    expect(read("src/components/documents/documents-view.tsx")).toContain('<label className="min-w-[12rem] flex-1 text-xs text-fg-muted">');
  });

  it("goals: the header and the key-results header wrap", () => {
    const src = read("src/components/goals-view.tsx");
    expect(src).toContain('<div className="min-w-[12rem] flex-1">');
    expect(src).toContain('<div className="flex flex-wrap items-center justify-between gap-2">');
  });

  it("tickets: the row title keeps min-w-[8rem]; the comment and activity rows wrap", () => {
    expect(read("src/components/department-tickets.tsx")).toContain('<div className="min-w-[8rem] flex-1">');
    const modal = read("src/components/ticket-detail-modal.tsx");
    expect(modal).toContain('<div className="flex flex-wrap items-center justify-between gap-2">');
    expect(modal).toContain('<li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">');
  });

  it("approvals: the approver picker's select can shrink so «إضافة» stays on the screen", () => {
    expect(read("src/components/approvals/approver-picker.tsx")).toContain('className="min-w-0 flex-1" aria-label={t("approvals.picker.choose")}');
  });
});
