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
