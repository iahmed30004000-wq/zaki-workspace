import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * W1w — the wiring W1.1 to W1.9 left in files outside their own paths (docs/restructure/pr/W1w.md): the number on «الشغل», the entry for «مهام قديمة»,
 * the toolbar link, the «آلي» mark on «مهامي», the palette's words. The database side is in tests/db/work-wiring.test.ts.
 */
(globalThis as { React?: typeof React }).React = React;

const where = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => where.pathname,
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
}));

import { AppShell } from "@/components/app-shell";
import { PlaceBadge } from "@/components/shell/place-badge";
import type { OrgsResponse } from "@/components/shell/space-switcher";
import { ToastProvider } from "@/components/ui/toast";
import { Toolbar } from "@/components/work/my-tasks/toolbar";
import { WorkRow } from "@/components/work/my-tasks/work-row";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { audienceOf } from "@/lib/guide/audience";
import { buildNav, canOpenTab, locate, offeredToGuests, PLACES_V1, PLACES_V2, WORK_OPTIONAL_TABS, type NavRole, type NavSubject } from "@/lib/nav/places";
import { newActionsFor } from "@/lib/nav/new-actions";
import { DEFAULT_MY_TASKS_PARAMS, type WorkTaskDto, type WorkTasksResult } from "@/lib/work/my-tasks";
import { navExtrasOf } from "@/server/policy/org-settings";
import { effectiveCapabilities } from "@/server/policy/capabilities";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Queries = QueryClientProvider as unknown as FunctionComponent<{ client: QueryClient; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;

const USER = { name: "أحمد الكوري", username: "ahmad", email: "ahmad@example.test", avatarUrl: null };
const SPACES = (waiting?: number): OrgsResponse & { waiting?: number } => ({
  currentSpaceId: "w2",
  organizations: [
    {
      id: "o1",
      name: "زكي",
      keyPrefix: "ZK",
      role: "MEMBER",
      canCreateSpaces: false,
      workspaces: [{ id: "w2", name: "الشحن", slug: "ship", emoji: "🚚", holdsProjects: true, unread: 0, overdue: 0 }],
    },
  ],
  ...(waiting === undefined ? {} : { waiting }),
});

function render(element: ReactElement, data: unknown = SPACES()): string {
  const client = new QueryClient();
  client.setQueryData(["orgs"], data);
  client.setQueryData(["notifications"], { items: [], unreadCount: 0 });
  return renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(Queries, { client }, createElement(Toasts, null, element))));
}

const who = (role: NavRole, extra: Partial<NavSubject> = {}): NavSubject => ({ role, caps: [...effectiveCapabilities({ role })], ...extra });

function shell(navV2: boolean, data: unknown): string {
  where.pathname = "/my-work";
  const subject = who("MEMBER", { navV2 });
  return render(
    createElement(
      AppShell,
      {
        space: { id: "w2", name: "الشحن", emoji: "🚚" },
        user: USER,
        nav: buildNav(subject),
        rank: "MEMBER",
        audience: audienceOf({ isExternal: false, caps: subject.caps }),
        isGuest: false,
        newActions: newActionsFor(subject),
        orgName: "شركة زكي",
        navV2,
      } as unknown as React.ComponentProps<typeof AppShell>,
      createElement("p", null, "محتوى الصفحة"),
    ),
    data,
  );
}

const waitingWords = (n: number) => AR["shell.place_waiting"]!.replace("{count}", String(n));

describe("W1.4: the number on «الشغل»", () => {
  it("with the new menu, the shell draws what /api/workspaces says is waiting, in words for a screen reader", () => {
    const markup = shell(true, SPACES(3));
    expect(markup).toContain(waitingWords(3));
    expect(markup).toContain(">3</span>");
  });

  it("nothing waiting, or no `waiting` in the answer: no number and no words", () => {
    expect(shell(true, SPACES(0))).not.toContain("بانتظارك");
    expect(shell(true, SPACES())).not.toContain("بانتظارك");
  });

  it("the old menu (navV2 OFF) renders as before: «الطلبات» is a page of the new map only, so no number there", () => {
    expect(shell(false, SPACES(4))).not.toContain("بانتظارك");
  });

  it("the shell passes it as `work` beside `chat`, and every one of the four menus gives the badge its place", () => {
    const shellSource = read("src/components/app-shell.tsx");
    expect(shellSource).toMatch(/useWorkWaiting\(\)/);
    expect(shellSource).toMatch(/badges = \{[^}]*chat: chatUnread[^}]*work:/);
    for (const file of ["rail", "drawer", "bottom-nav", "sidebar"]) {
      const source = read(`src/components/shell/${file}.tsx`);
      const calls = source.match(/<PlaceBadge\b[^>]*>/g) ?? [];
      expect(calls.length, file).toBeGreaterThan(0);
      for (const call of calls) expect(call, `${file}: ${call}`).toContain("place={place.key}");
    }
  });

  it("a badge on «الدردشة» still says unread messages; on «الشغل» it says a request waits", () => {
    const chat = render(createElement(PlaceBadge, { count: 2, place: "chat" }));
    const work = render(createElement(PlaceBadge, { count: 2, place: "work" }));
    expect(chat).toContain(AR["shell.place_unread"]!.replace("{count}", "2"));
    expect(work).toContain(waitingWords(2));
    // left out: the old words (what every caller wrote before)
    expect(render(createElement(PlaceBadge, { count: 2 }))).toContain(AR["shell.place_unread"]!.replace("{count}", "2"));
  });
});

describe("W1.1: navExtrasOf hands `workMyTasks` to the map", () => {
  it("is false by default and follows the company's switch", () => {
    expect(navExtrasOf({})).toEqual({ navV2: false, workMyTasks: false, workTabs: [] });
    expect(navExtrasOf({ features: { workMyTasks: true } })).toMatchObject({ workMyTasks: true, navV2: false });
    expect(navExtrasOf(null)).toEqual({ navV2: false, workMyTasks: false, workTabs: [] });
  });

  it("with it on, the OLD map stops drawing «القائمة» and «التقويم»; with it off they stay", () => {
    const tabsOf = (extra: Partial<NavSubject>) => buildNav({ ...who("OWNER"), ...extra }).places.find((p) => p.key === "work")!.tabs.map((t) => t.key);
    expect(tabsOf(navExtrasOf({}))).toContain("list");
    expect(tabsOf(navExtrasOf({}))).toContain("calendar");
    const on = tabsOf(navExtrasOf({ features: { workMyTasks: true } }));
    expect(on).not.toContain("list");
    expect(on).not.toContain("calendar");
    expect(on).toContain("my-work");
  });
});

describe("W1.9: «مهام قديمة» has an entry on the new map, under «المزيد»", () => {
  const moreOf = (subject: NavSubject) => (buildNav(subject).places.find((p) => p.key === "work")?.more ?? []).map((t) => t.key);

  it("WORK_OPTIONAL_TABS ends with `stale`, and the tab is a page of the work place at /my-work/stale", () => {
    expect([...WORK_OPTIONAL_TABS].at(-1)).toBe("stale");
    const work = PLACES_V2.find((p) => p.key === "work")!;
    const tab = work.more!.find((t) => t.key === "stale")!;
    expect(tab).toMatchObject({ href: "/my-work/stale", labelKey: "nav.tab.stale", feature: "workStaleSweep" });
    expect(AR["nav.tab.stale"]).toBe("مهام قديمة");
  });

  it("the owner is offered it, a manager of the current space too; a plain member and a lead are not", () => {
    expect(moreOf(who("OWNER", { navV2: true }))).toContain("stale");
    expect(moreOf(who("MEMBER", { navV2: true, spaceManager: true }))).toContain("stale");
    expect(moreOf(who("ADMIN", { navV2: true, spaceManager: true }))).toContain("stale");
    expect(moreOf(who("MEMBER", { navV2: true }))).not.toContain("stale");
    expect(moreOf(who("LEAD", { navV2: true }))).not.toContain("stale");
  });

  it("while the switch `workStaleSweep` is OFF (its default) nobody is offered it, so no tab leads to a page that is not found", () => {
    expect(moreOf(who("OWNER", { navV2: true, off: ["workStaleSweep"] }))).not.toContain("stale");
    expect(canOpenTab(who("OWNER", { navV2: true, off: ["workStaleSweep"] }), "stale")).toBe(false);
    expect(canOpenTab(who("OWNER", { navV2: true }), "stale")).toBe(true);
  });

  it("a guest is never offered it, whatever was passed for them", () => {
    expect(moreOf(who("GUEST", { navV2: true, spaceManager: true }))).not.toContain("stale");
    expect(offeredToGuests("stale")).toBe(false);
  });

  it("the old map is untouched: no such tab, and the address stays a page of «مهامي» there", () => {
    expect(PLACES_V1.flatMap((p) => [...p.tabs, ...(p.more ?? [])]).some((t) => t.key === "stale")).toBe(false);
    expect(buildNav(who("OWNER", { spaceManager: true })).places.flatMap((p) => p.tabs.map((t) => t.key))).not.toContain("stale");
    expect(locate("/my-work/stale", "v1")).toEqual({ place: "work", tab: "my-work" });
  });

  it("on the new map the address marks its own tab, not «مهامي»", () => {
    expect(locate("/my-work/stale", "v2")).toEqual({ place: "work", tab: "stale" });
    expect(locate("/my-work", "v2")).toEqual({ place: "work", tab: "my-work" });
  });

  it("the owner can pin it as a tab (it is one of the optional tools), and it never pushes a core tab out", () => {
    const nav = buildNav(who("OWNER", { navV2: true, workTabs: ["stale"] }));
    const work = nav.places.find((p) => p.key === "work")!;
    expect(work.tabs.map((t) => t.key)).toEqual(["my-work", "projects", "requests", "stale"]);
    expect(work.more!.map((t) => t.key)).not.toContain("stale");
  });
});

describe("W1.9: the «مهامي» bar links to the review list for a manager", () => {
  const params = DEFAULT_MY_TASKS_PARAMS;
  const data = {
    params,
    tasks: [],
    truncated: false,
    counts: { today: 0, overdue: 0, week: 0, nodate: 0, done: 0, created: 0 },
    spaces: [],
    projects: [],
    current: { id: "w1", hq: false },
    scopeFellBack: false,
    timeZone: "Asia/Damascus",
    todayIso: "2026-11-20",
    month: null,
    canAdd: true,
  } as unknown as WorkTasksResult;
  const bar = (extra: Record<string, unknown>) => render(createElement(Toolbar, { params, data, onChange: () => {}, ...extra } as unknown as React.ComponentProps<typeof Toolbar>));

  it("a link «مهام قديمة» to /my-work/stale when the page hands it over", () => {
    const markup = bar({ staleHref: "/my-work/stale" });
    expect(markup).toContain('href="/my-work/stale"');
    expect(markup).toContain("مهام قديمة");
  });

  it("no link without it (a person who manages no space, or the switch off)", () => {
    expect(bar({})).not.toContain("/my-work/stale");
    expect(bar({ staleHref: null })).not.toContain("/my-work/stale");
  });

  it("the page decides: only with the switch ON and only for somebody who manages a space", () => {
    const page = read("src/app/(app)/my-work/page.tsx");
    expect(page).toContain("workStaleSweep");
    expect(page).toContain("managedSpacesOf");
    expect(page).toContain("staleHref");
  });
});

describe("W1.9: the «آلي» mark on the unified «مهامي»", () => {
  const dto = (over: Partial<WorkTaskDto> = {}): WorkTaskDto =>
    ({
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
      projectName: "مشروع",
      assigneeId: "u1",
      assigneeName: "سارة",
      assigneeIds: ["u1"],
      assigneeNames: ["سارة"],
      creatorId: "u1",
      visibility: "SPACE",
      updatedAt: "2026-11-01T00:00:00.000Z",
      editable: true,
      ...over,
    }) as WorkTaskDto;
  const row = (t: WorkTaskDto) => render(createElement(WorkRow, { task: t, showSpace: true, onOpen: () => {}, onToggle: () => {}, onDue: () => {} }));

  it("a task that came through the door carries the mark; any other row is byte for byte what it was", () => {
    const plain = row(dto());
    const auto = row(dto({ automated: true }));
    expect(auto).toContain("data-auto-mark");
    expect(plain).not.toContain("data-auto-mark");
    expect(auto).not.toBe(plain);
    expect(row(dto({ automated: false }))).toBe(plain);
  });
});

describe("W1.8: the palette names what it finds", () => {
  it("the placeholder and the hint name boards, ideas, tickets and customers beside the tasks", () => {
    for (const key of ["pal.placeholder", "pal.hint"]) {
      const words = AR[key]!;
      for (const word of ["المهام", "اللوحات", "الأفكار", "التذاكر", "العملاء"]) expect(words, `${key} · ${word}`).toContain(word);
    }
  });
});

describe("W1.6: the quick-task seam is shared", () => {
  it("instant-work.ts exports instantBoard", () => {
    expect(read("src/server/services/instant-work.ts")).toMatch(/export async function instantBoard\(/);
  });
});
