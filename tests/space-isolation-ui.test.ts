import "./ui-render";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { textOf } from "./ui-render";

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import { readFileSync } from "node:fs";
import path from "node:path";
import { QuickAddForm } from "@/components/today/quick-add";
import { TodayHqSummary } from "@/components/today/hq-summary";
import { mustChooseSpace, quickInboxBody, type TodayQuickAddData, type WorkInboxInfo } from "@/lib/today";
import { TodayWaitingCard } from "@/components/today/waiting-card";
import { I18nProvider } from "@/lib/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { STALE_ALL_SPACES, parseStaleParams, staleApiQuery, staleParamsOf } from "@/lib/work/stale";

/**
 * B4 — each space is its own account: the parts of the screens that draw the per-space groups of «الشركة» (the view over all the spaces) and the
 * names of the space a number belongs to. The rules behind them (what is counted where) are in tests/db/*.
 */

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;
const html = (element: ReactElement): string => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Toasts, null, element)));

describe("Today «بانتظار قرارك»", () => {
  const row = { id: "r1", kind: "approval" as const, title: "شراء شاشة", href: "/approvals/r1", place: "المبيعات", at: "2026-11-20T09:00:00.000Z" };

  it("inside a space it lists the newest rows, each a link to the thing itself", () => {
    const markup = html(createElement(TodayWaitingCard, { waiting: { total: 1, rows: [row] } }));
    expect(markup).toContain('href="/approvals/r1"');
    expect(markup).not.toContain("data-waiting-groups");
  });

  it("inside «الشركة» it lists what waits space by space, each with «انتقل» through /go (the company-wide one has none)", () => {
    const markup = html(
      createElement(TodayWaitingCard, {
        waiting: {
          total: 5,
          rows: [row],
          groups: [
            { spaceId: "w1", name: "المبيعات", total: 3 },
            { spaceId: "w2", name: "الدعم", total: 1 },
            { spaceId: null, name: null, total: 1 },
          ],
        },
      }),
    );
    expect(markup).toContain("data-waiting-groups");
    expect(textOf(markup)).toContain("المبيعات");
    expect(textOf(markup)).toContain("على مستوى الشركة");
    expect(markup).toContain('href="/go?space=w1&amp;next=%2Frequests"');
    expect(markup).toContain('href="/go?space=w2&amp;next=%2Frequests"');
    expect(markup.match(/انتقل/g)).toHaveLength(2);
    // the rows are replaced by the groups: nothing is listed twice
    expect(markup).not.toContain('href="/approvals/r1"');
  });
});

describe("«مهام قديمة»: asking for the same answer again", () => {
  const base = { days: 14, auto: "all" as const };

  it("the space I am in is the default and is left out of the address; «كل المساحات» is written as `all` (left out it would mean the space I am in); another space is written by id", () => {
    expect(staleParamsOf({ ...base, space: "a", here: "a" }).space).toBeNull();
    expect(staleParamsOf({ ...base, space: null, here: "a" }).space).toBe(STALE_ALL_SPACES);
    expect(staleParamsOf({ ...base, space: "b", here: "a" }).space).toBe("b");
    // inside «الشركة» (no space «here») all the spaces ARE the default
    expect(staleParamsOf({ ...base, space: null, here: null }).space).toBeNull();
    expect(staleApiQuery(staleParamsOf({ ...base, space: null, here: "a" }))).toBe("space=all");
    expect(parseStaleParams(new URLSearchParams("space=all")).space).toBe(STALE_ALL_SPACES);
  });
});

describe("B4.5 the quick add sheet inside «الشركة»", () => {
  const QUICK: TodayQuickAddData = { assigneeId: "u1", dueToday: "2026-10-22T09:00:00.000Z", dueTomorrow: "2026-10-23T09:00:00.000Z", targets: [] };
  const form = (inbox: WorkInboxInfo) => html(createElement(QuickAddForm, { quickAdd: QUICK, timeZone: "Asia/Damascus", onDone: () => {}, inbox }));
  const two = [
    { id: "w1", name: "ألفا" },
    { id: "w2", name: "بيتا" },
  ];

  it("asks which space (a required choice, none picked for the person) when the person is in «الشركة» with several spaces", () => {
    const markup = form({ space: two[0]!, projectId: null, choose: true, spaces: two });
    expect(markup).toMatch(/<select[^>]*name="spaceId"[^>]*required/);
    expect(markup).toContain("اختر المساحة");
    expect(markup).toContain(">ألفا<");
    expect(markup).toContain(">بيتا<");
    expect(mustChooseSpace({ space: null, projectId: null, choose: true, spaces: two })).toBe(true);
  });

  it("does not ask inside a space, nor when there is only one space to choose from (that one is used, and named by the toast)", () => {
    expect(form({ space: two[0]!, projectId: null, choose: false, spaces: two })).not.toContain('name="spaceId"');
    expect(form({ space: two[0]!, projectId: null, choose: true, spaces: [two[0]!] })).not.toContain('name="spaceId"');
    expect(mustChooseSpace({ space: two[0]!, projectId: null, choose: true, spaces: [two[0]!] })).toBe(false);
    expect(mustChooseSpace(null)).toBe(false);
  });

  it("the body carries the space the person chose, and only then", () => {
    const base = { title: "مهمة", due: "none" as const, timeZone: "UTC" };
    expect(quickInboxBody(QUICK, { ...base, spaceId: "w2" })?.spaceId).toBe("w2");
    expect(quickInboxBody(QUICK, base)).not.toHaveProperty("spaceId");
    expect(quickInboxBody(QUICK, { ...base, spaceId: null })).not.toHaveProperty("spaceId");
  });

  it("the first-name chip shortens an assignee by whitespace (a person «سارة خالد» is «سارة»)", () => {
    const source = readFileSync(path.resolve(__dirname, "../src/components/today/quick-add.tsx"), "utf8");
    expect(source).toContain(`split(/${String.fromCharCode(92)}s+/)[0]`);
    expect("سارة خالد".trim().split(/\s+/)[0]).toBe("سارة");
  });
});

describe("B4.6 «اليوم» inside «الشركة»: the per-space summary", () => {
  const rows = [
    { id: "w1", name: "ألفا", emoji: "🅰️", open: 5, overdue: 2, unread: 0 },
    { id: "w2", name: "بيتا", emoji: null, open: 0, overdue: 0, unread: 3 },
  ];

  it("a line per space with its name, its open and late numbers, the unread only when there is some, and «انتقل» through /go", () => {
    const markup = html(createElement(TodayHqSummary, { rows }));
    expect(markup).toContain("data-today-hq");
    expect(textOf(markup)).toContain("ألفا");
    expect(textOf(markup)).toContain("5 مفتوحة");
    expect(textOf(markup)).toContain("2 متأخرة");
    expect(textOf(markup)).toContain("3 رسالة جديدة");
    expect(markup.match(/رسالة جديدة/g)).toHaveLength(1);
    expect(markup).toContain('href="/go?space=w1"');
    expect(markup).toContain('href="/go?space=w2"');
    expect(markup).toMatch(/text-danger[^>]*>2 متأخرة/);
  });

  it("says so when the person has no space", () => {
    expect(textOf(html(createElement(TodayHqSummary, { rows: [] })))).toContain("ما إلك مساحة شغل لسا");
  });
});
