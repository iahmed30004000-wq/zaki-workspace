import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/projects/p1",
}));

import { I18nProvider } from "@/lib/i18n";
import { Breadcrumbs } from "@/components/shell/breadcrumbs";
import { boardTrail, finishTrail, projectTrail, taskTrail, type Crumb } from "@/components/work/project/crumbs";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, textOf } from "./ui-render";

/**
 * N1.5 (folded into W1.5) - the trail «المساحة › المشروع › اللوحة › المهمة»: the pure builders (what each page's trail is) and the component (every crumb but the
 * last is the way back, the last is the page, the arrow turns with the right-to-left page, nothing is drawn for an empty trail).
 */
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const render = (items: readonly Crumb[]): string => renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Breadcrumbs, { items })));
const read = (file: string): string => readFileSync(path.join(process.cwd(), file), "utf8");

const places = { spaceName: "ألفا", projectId: "p1", projectName: "مشروع الموقع" };

describe("the trails", () => {
  it("a project: space › project (the space leads to «المشاريع»); a tab adds its own name as the page", () => {
    expect(projectTrail(places)).toEqual([{ label: "ألفا", href: "/projects" }, { label: "مشروع الموقع" }]);
    expect(projectTrail(places, "القائمة")).toEqual([{ label: "ألفا", href: "/projects" }, { label: "مشروع الموقع", href: "/projects/p1" }, { label: "القائمة" }]);
  });

  it("a board: space › project › board, the project is the way back", () => {
    expect(boardTrail(places, "لوحة التصميم")).toEqual([{ label: "ألفا", href: "/projects" }, { label: "مشروع الموقع", href: "/projects/p1" }, { label: "لوحة التصميم" }]);
  });

  it("a task: space › project › board › task - the board crumb leads back to the board the task lives on", () => {
    expect(taskTrail(places, { id: "b9", name: "لوحة التصميم" }, "ZK-12")).toEqual([
      { label: "ألفا", href: "/projects" },
      { label: "مشروع الموقع", href: "/projects/p1" },
      { label: "لوحة التصميم", href: "/boards/b9" },
      { label: "ZK-12" },
    ]);
  });

  it("the last crumb is never a link, and a crumb with no name is dropped (never drawn empty)", () => {
    expect(finishTrail([{ label: "أ", href: "/a" }, { label: "ب", href: "/b" }])).toEqual([{ label: "أ", href: "/a" }, { label: "ب" }]);
    expect(finishTrail([{ label: "أ", href: "/a" }, { label: "  ", href: "/x" }, { label: "ب", href: "/b" }])).toEqual([{ label: "أ", href: "/a" }, { label: "ب" }]);
    expect(projectTrail({ ...places, spaceName: "" })).toEqual([{ label: "مشروع الموقع" }]);
  });
});

describe("the component", () => {
  const markup = render(taskTrail(places, { id: "b9", name: "لوحة التصميم" }, "ZK-12"));

  it("a labelled navigation with an ordered list: links for the way back, the page itself marked current", () => {
    expect(markup).toContain('aria-label="مسار الصفحة"');
    expect(markup).toContain("<ol");
    expect((markup.match(/<li/g) ?? []).length).toBe(4);
    expect(markup).toContain('href="/projects"');
    expect(markup).toContain('href="/projects/p1"');
    expect(markup).toContain('href="/boards/b9"');
    expect(markup).toMatch(/<span[^>]*aria-current="page"[^>]*>ZK-12</);
    expect((markup.match(/aria-current="page"/g) ?? []).length).toBe(1);
    // the last crumb is text, not a link
    expect(markup).not.toMatch(/<a[^>]*>ZK-12</);
  });

  it("the trail reads in order and says nothing in Latin letters but the task's own key", () => {
    const text = textOf(markup);
    expect(text.indexOf("ألفا")).toBeLessThan(text.indexOf("مشروع الموقع"));
    expect(text.indexOf("مشروع الموقع")).toBeLessThan(text.indexOf("لوحة التصميم"));
    expect(text.indexOf("لوحة التصميم")).toBeLessThan(text.indexOf("ZK-12"));
    expect(text.replace(/ZK-\d+/g, "")).not.toMatch(/[A-Za-z]/);
  });

  it("logical properties and theme tokens only; the arrows turn with the page and are hidden from a screen reader", () => {
    const tokens = classTokens(markup);
    expect(tokens.filter((c) => PHYSICAL_UTILITY.test(c))).toEqual([]);
    expect(PALETTE_COLOUR.test(tokens.join(" "))).toBe(false);
    expect(markup).toMatch(/<svg[^>]*class="[^"]*rtl:rotate-180[^"]*"[^>]*aria-hidden="true"/);
    expect((markup.match(/rtl:rotate-180/g) ?? []).length).toBe(3);
  });

  it("an empty trail draws nothing at all", () => {
    expect(render([])).toBe("");
  });

  it("a single crumb is just the page (no arrow, no link)", () => {
    const one = render([{ label: "مشروع" }]);
    expect(one).not.toContain("<svg");
    expect(one).not.toContain("<a ");
    expect(one).toContain('aria-current="page"');
  });
});

describe("the trail is on every view below a place (N1.5)", () => {
  it("the project page, its timeline, the board and the task draw it", () => {
    expect(read("src/app/(app)/projects/[id]/project-page.tsx")).toContain("<Breadcrumbs items={projectTrail(places, leaf)} />");
    expect(read("src/app/(app)/projects/[id]/timeline/page.tsx")).toContain("<Breadcrumbs items={projectTrail(");
    expect(read("src/components/board-view.tsx")).toContain("<Breadcrumbs items={view.crumbs}");
    expect(read("src/app/(app)/boards/[id]/page.tsx")).toContain("boardTrail(");
    expect(read("src/components/task-detail.tsx")).toContain("<Breadcrumbs items={trail} />");
    expect(read("src/components/task-detail.tsx")).toContain("useTaskTrail(task.boardId, task.key, crumbs === undefined)");
    expect(read("src/app/(app)/boards/[id]/trail/route.ts")).toContain("projectVisibleWhere(scope)");
  });

  it("the list and the calendar are tabs of the project page, so they wear the project page's trail (the leaf is the tab's name)", () => {
    const source = read("src/app/(app)/projects/[id]/project-page.tsx");
    expect(source).toContain("projectTabLabelKey(tab)");
  });

  it("the component is a client file with no colour, no pixel text size and no physical direction of its own", () => {
    const source = read("src/components/shell/breadcrumbs.tsx");
    expect(source.startsWith('"use client";')).toBe(true);
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/text-\[(?:10|11)px\]/);
    expect(source).not.toMatch(/\b(?:bg|text)-(?:black|white)\b/);
  });
});
