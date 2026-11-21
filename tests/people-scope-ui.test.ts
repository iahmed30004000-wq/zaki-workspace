import "./ui-render";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
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

import { ScopeChip, scopeInfoLabel } from "@/components/today/scope-chip";
import { TodayTeamCard, scopeLabel } from "@/components/today/team-card";
import { TeamPulse } from "@/components/today/team-pulse";
import { TodayDashboard } from "@/components/today/today-dashboard";
import { I18nProvider } from "@/lib/i18n";
import { getServerT } from "@/lib/i18n/server";
import type { TodayTeamData } from "@/lib/today";

/**
 * A2.3 — every team KPI says what it counted. The numbers are proved in tests/db/today-team-scope.test.ts; here: the words, the chip on each of
 * the three places a team number is drawn (the old pulse, the old strip, the one team card), and that the old general sentences stay for a
 * caller that gives no scope.
 */

const { t } = getServerT();
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const html = (element: ReactElement): string => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, element));

const MINE = { who: "reports", spaceName: null } as const;
const COMPANY = { who: "company", spaceName: null } as const;

describe("the words of the chip", () => {
  it("the company, my team, and either of them narrowed to the space the person is in", () => {
    expect(scopeInfoLabel(COMPANY)).toBe("كل الشركة");
    expect(scopeInfoLabel(MINE)).toBe("فريقي");
    expect(scopeInfoLabel({ who: "company", spaceName: "مساحة أ" })).toBe("المساحة: مساحة أ");
    expect(scopeInfoLabel({ who: "reports", spaceName: "مساحة أ" })).toBe("فريقي في المساحة: مساحة أ");
  });

  it("the chip carries its kind and nothing else a person reads", () => {
    const markup = html(createElement(ScopeChip, { info: MINE }));
    expect(markup).toContain('data-today-scope="reports"');
    expect(textOf(markup)).toBe("فريقي");
  });

  it("the page's own guess for a person outside a space is «فريقي», no longer «the spaces available to you» (that meant three things)", () => {
    expect(scopeLabel({ kind: "spaces", name: null })).toBe("فريقي");
    expect(scopeLabel({ kind: "company", name: null })).toBe("كل الشركة");
    expect(scopeLabel({ kind: "space", name: "س" })).toBe("المساحة: س");
  });
});

describe("a chip on every place a team number is drawn", () => {
  const pulse = { open: 7, overdue: 2, worst: [] };
  const team = { doneWeek: 5, dueToday: 1, peopleLate: 2 };

  it("the old pulse names its scope when the service gave one, and keeps its general sentence otherwise", () => {
    const withScope = html(createElement(TeamPulse, { pulse: { ...pulse, scope: MINE } }));
    expect(withScope).toContain('data-today-scope="reports"');
    expect(withScope).not.toContain(t("today.pulse.scope"));
    const without = html(createElement(TeamPulse, { pulse }));
    expect(without).toContain(t("today.pulse.scope"));
    expect(without).not.toContain("data-today-scope");
  });

  it("the old strip names its scope when the service gave one, and keeps its general sentence otherwise", () => {
    const withScope = html(createElement(TodayDashboard, { data: { mine: null, unreadChat: 0, team: { ...team, scope: COMPANY } } as never }));
    expect(withScope).toContain('data-today-scope="company"');
    expect(withScope).not.toContain(t("today.dash.team_scope"));
    const without = html(createElement(TodayDashboard, { data: { mine: null, unreadChat: 0, team } }));
    expect(without).toContain(t("today.dash.team_scope"));
  });

  const card: TodayTeamData = { scope: { kind: "space", name: "مساحة أ" }, open: 3, overdue: 1, doneWeek: 2, dueToday: 0, peopleLate: 1, worst: [] };

  it("the one team card: the service's scope wins over the page's guess, and without one the page's chip is drawn", () => {
    const told = html(createElement(TodayTeamCard, { team: card, panelHref: null, scopeInfo: COMPANY }));
    expect(told).toContain('data-today-scope="company"');
    expect(told).not.toContain("المساحة: مساحة أ");
    const guessed = html(createElement(TodayTeamCard, { team: card, panelHref: null }));
    expect(guessed).toContain('data-today-scope="space"');
    expect(guessed).toContain("المساحة: مساحة أ");
  });

  it("exactly one chip per card", () => {
    for (const markup of [
      html(createElement(TodayTeamCard, { team: card, panelHref: null, scopeInfo: MINE })),
      html(createElement(TodayTeamCard, { team: card, panelHref: null })),
      html(createElement(TeamPulse, { pulse: { ...pulse, scope: MINE } })),
    ]) {
      expect([...markup.matchAll(/data-today-scope=/g)]).toHaveLength(1);
    }
  });
});

describe("the new strings", () => {
  const registry = JSON.parse(readFileSync(path.join(process.cwd(), "src/lib/i18n/ar.work-v2.json"), "utf8")) as Record<string, string>;
  it("are Arabic only: no Latin letter, no «ـاً»", () => {
    for (const key of ["today.team.scope_mine", "today.team.scope_mine_space"]) {
      const text = registry[key] as string;
      expect(text, key).toBeTruthy();
      expect(text.replace(/\{[a-z]+\}/g, ""), key).not.toMatch(/[A-Za-z]/);
      expect(text, key).not.toContain("ـاً");
    }
  });
});
