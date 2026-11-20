import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/requests",
}));

import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { CalendarGrid } from "@/components/calendar-grid";
import { RequestsView } from "@/components/work/requests/requests-view";
import { RequestRowView } from "@/components/work/requests/request-rows";
import type { AssignRow, TicketRow, WorkRequestsView } from "@/components/work/requests/types";
import { ProjectTabs } from "@/components/work/project/project-tabs";
import { PROJECT_TONE, QuietEmpty, STAGE_TONE, StateChip } from "@/components/work/look";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens } from "./ui-render";

/**
 * The look of «الشغل» (the owner's Telegram-like mock-up): the markup the work screens draw outside «مهامي» (whose own pins live in work-my-tasks-render): the
 * requests inbox, a project's tab strip, the month grid and the shared pieces in `src/components/work/look.tsx`.
 */
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const render = (element: ReactElement): string =>
  renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client: new QueryClient() }, createElement(Toasts, null, element))));

const ticket: TicketRow = { kind: "ticket", id: "t1", title: "الزبون ما استلم", at: "2026-11-19T09:00:00.000Z", href: "/tickets", place: "الدعم", key: "T-1", status: "OPEN", priority: "NORMAL", assignee: null, canTake: true, canResolve: false };
const assign: AssignRow = { kind: "assign", id: "a1", title: "تسليم تقرير", at: "2026-11-19T09:00:00.000Z", href: "/tasks/x", place: "الإدارة", taskId: "x", requestId: "r1", key: "ZK-4", fromName: "سارة", toName: "عمر", asCo: false, canAnswer: true };

const view = (over: Partial<WorkRequestsView> = {}): WorkRequestsView => ({ tab: "waiting", viewerId: "u1", builtAt: 1, total: 0, sections: [], ...over }) as WorkRequestsView;

describe("the requests inbox", () => {
  it("a row is one line of a rounded white list: the kind's round icon, the title with its meta, the actions at the end — not a bordered box of its own", () => {
    const markup = render(createElement("ul", null, createElement(RequestRowView, { row: ticket, viewerId: "u1" })));
    expect(markup).toContain('data-request-row="ticket"');
    expect(markup).toMatch(/<li[^>]*class="[^"]*border-b[^"]*last:border-b-0/);
    expect(markup).not.toMatch(/<li[^>]*class="[^"]*rounded-xl border border-border/);
    expect(markup).toMatch(/<span aria-hidden="true" class="[^"]*rounded-full bg-accent\/10 text-accent/);
    expect(markup).toContain("استلمها");
  });

  it("a wide answer (the assignment banner) goes under the line instead of squeezing it", () => {
    const markup = render(createElement("ul", null, createElement(RequestRowView, { row: assign, viewerId: "u1" })));
    expect(markup).toMatch(/<div class="mt-2">/);
    expect(markup).not.toContain("shrink-0 max-md:w-full");
  });

  it("the two tabs are a segmented control (the current one raised), the empty inbox says so quietly with no dashed frame", () => {
    const markup = render(createElement(RequestsView, { initial: view() }));
    expect(markup).toMatch(/<nav[^>]*class="[^"]*bg-surface-2[^"]*p-\[3px\]/);
    expect(markup).toMatch(/aria-current="page"[^>]*class="[^"]*bg-surface-1[^"]*shadow-card/);
    expect(markup).not.toContain("border-dashed");
  });

  it("a section is a heading «اسم · عدد» over one rounded card", () => {
    const markup = render(
      createElement(RequestsView, { initial: view({ total: 1, sections: [{ key: "tickets", total: 1, rows: [ticket], allHref: null }] as unknown as WorkRequestsView["sections"] }) }),
    );
    expect(markup).toMatch(/<h2[^>]*font-bold[^>]*>[^<]*<span aria-hidden="true">·<\/span>/);
    expect(markup).toMatch(/<ul class="overflow-hidden rounded-2xl bg-surface-1">/);
  });
});

describe("a project's tab strip", () => {
  const tabs = [
    { tab: "board", href: "/projects/p", labelKey: "projpage.tab.board" },
    { tab: "list", href: "/projects/p?tab=list", labelKey: "projpage.tab.list" },
  ] as const;
  it("the current tab is the soft accent pill (the same as the place's own tabs), not an underline", () => {
    const markup = render(createElement(ProjectTabs, { tabs: [...tabs], current: "board" }));
    expect(markup).toMatch(/aria-current="page"[^>]*class="[^"]*bg-accent\/10 text-accent/);
    expect(markup).not.toContain("border-b-2");
    // a phone keeps its 44px target
    expect(markup).toContain("min-h-11");
  });
});

describe("the month grid", () => {
  it("each day is a white rounded tile with a gap between, today wears the accent ring, a task is a soft accent chip", () => {
    const markup = render(
      createElement(CalendarGrid, {
        month: "2026-11",
        todayIso: "2026-11-20",
        editable: false,
        timeZone: "Asia/Damascus",
        tasks: [{ id: "1", key: "ZK-1", title: "اتصال", dueDate: "2026-11-20T09:00:00.000Z" }],
      }),
    );
    expect(markup).toMatch(/class="[^"]*rounded-xl bg-surface-1[^"]*ring-2[^"]*ring-accent/);
    expect(markup).toMatch(/class="[^"]*bg-accent\/10[^"]*text-accent[^"]*"[^>]*title="اتصال"|title="اتصال"[^>]*class="[^"]*bg-accent\/10/);
    expect(markup).not.toContain("gap-px");
  });
});

describe("the shared pieces", () => {
  it("a state is a soft chip in the tone of its status; a stage and a project status have a tone each", () => {
    expect(render(createElement(StateChip, { tone: "ok", children: "تمّت" }))).toMatch(/rounded-full[^>]*bg-ok\/10 text-ok/);
    expect(render(createElement(QuietEmpty, { title: "ما في شي", hint: "جرّب" }))).not.toMatch(/border|bg-/);
    expect(STAGE_TONE).toEqual({ TODO: "neutral", DOING: "accent", REVIEW: "warn", DONE: "ok" });
    expect(PROJECT_TONE["COMPLETED"]).toBe("ok");
  });

  it("everything above uses theme tokens and logical properties only", () => {
    const markup = [
      render(createElement("ul", null, createElement(RequestRowView, { row: ticket, viewerId: "u1" }))),
      render(createElement(RequestsView, { initial: view() })),
      render(createElement(CalendarGrid, { month: "2026-11", todayIso: "2026-11-20", editable: false, timeZone: "Asia/Damascus", tasks: [] })),
      render(createElement(StateChip, { tone: "warn", children: "x" })),
    ].join("");
    const tokens = classTokens(markup);
    expect(tokens.filter((t) => PALETTE_COLOUR.test(t))).toEqual([]);
    expect(tokens.filter((t) => PHYSICAL_UTILITY.test(t.replace(/^(?:(?:\[[^\]]*\]|[a-z-]+):)+/, "")))).toEqual([]);
  });
});
