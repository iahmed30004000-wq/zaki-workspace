import "./scoping-react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The pages call redirect() and their client rows call useRouter(); neither needs a running Next app here.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

import MyWorkPage from "@/app/(app)/my-work/page";
import ListPage from "@/app/(app)/list/page";
import CalendarPage from "@/app/(app)/calendar/page";
import AnalyticsPage from "@/app/(app)/analytics/page";
import { I18nProvider } from "@/lib/i18n";
import { getServerT } from "@/lib/i18n/server";
import { ToastProvider } from "@/components/ui/toast";
import type { Prisma } from "@prisma/client";
import { withFeature } from "@/lib/features";
import { db, loginAs, logout, makeUser } from "./helpers";
import { SPACE_COOKIE } from "@/server/services/current-space";
import { joinWorkspace, makeScopedOrg, seedWork, todayNoon } from "./scoping-helpers";

// the providers' `children` is typed as required, which createElement(type, props, child) cannot express
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Toasts = ToastProvider as unknown as FunctionComponent<{ children?: ReactNode }>;

/** Renders a server page (with the client providers its rows need) to HTML. */
async function html(page: Promise<ReactElement> | ReactElement): Promise<string> {
  const element = await page;
  return renderToStaticMarkup(
    createElement(Translations, { initial: "ar" }, createElement(Toasts, null, element)),
  );
}

const { t } = getServerT();

/** Enter a space (src/server/services/current-space.ts): the pages show the space the person is in. */
const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);

describe("My Work page: renders only what getMyWork returns", () => {
  it("shows my assigned tasks and none of a colleague's or of a workspace I am not in", async () => {
    const f = await makeScopedOrg();
    const mk = (label: string, workspaceId: string, extra: Partial<Parameters<typeof seedWork>[0]> = {}) =>
      seedWork({ orgId: f.org.id, workspaceId, token: f.token, label, creatorId: f.owner.id, ...extra });
    await mk("mine-visible", f.wsIn.id, { assigneeId: f.member.id });
    await mk("theirs-visible", f.wsIn.id, { assigneeId: f.admin.id });
    await mk("mine-hidden", f.wsOut.id, { assigneeId: f.member.id });
    await mk("owner-anywhere", f.wsOut.id, { assigneeId: f.owner.id });

    await loginAs(f.member.id);
    const page = await html(MyWorkPage({ searchParams: { tab: "mine" } }));
    expect(page).toContain(`${f.token} task mine-visible`);
    expect(page).not.toContain(`${f.token} task theirs-visible`);
    expect(page).not.toContain(`${f.token} task mine-hidden`);

    // an ADMIN is not in the workspace by rank: work assigned to them there stays hidden until they are put in it
    await loginAs(f.admin.id);
    expect(await html(MyWorkPage({ searchParams: { tab: "mine" } }))).not.toContain(`${f.token} task theirs-visible`);
    await joinWorkspace(f.admin.id, f.wsIn.id);
    const adminPage = await html(MyWorkPage({ searchParams: { tab: "mine" } }));
    expect(adminPage).toContain(`${f.token} task theirs-visible`);
    expect(adminPage).not.toContain(`${f.token} task mine-visible`);
    expect(adminPage).not.toContain(`${f.token} task mine-hidden`);

    // the OWNER sees every workspace without a row (inside the one he entered), and still only their own work
    await loginAs(f.owner.id);
    enter(f.wsOut.id);
    const ownerPage = await html(MyWorkPage({ searchParams: { tab: "mine" } }));
    expect(ownerPage).toContain(`${f.token} task owner-anywhere`);
    expect(ownerPage).not.toContain(`${f.token} task mine-hidden`);
    expect(ownerPage).not.toContain(`${f.token} task theirs-visible`);
  });

  it("an unknown tab falls back to today, and the empty state shows when there is nothing", async () => {
    const f = await makeScopedOrg();
    const loner = await makeUser({ orgId: f.org.id, role: "MEMBER" });
    await loginAs(loner.id);
    const page = await html(MyWorkPage({ searchParams: { tab: "nope" } }));
    expect(page).toContain(t("mywork.empty"));
    expect(page).toContain(t("mywork.tab.today"));
  });

  it("sends an anonymous visitor to login", async () => {
    logout();
    await expect(MyWorkPage({ searchParams: {} })).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("List page: only workspaces the user can open", () => {
  it("a MEMBER's selector and rows never include a workspace they are not in, even when asked by id", async () => {
    const f = await makeScopedOrg();
    await loginAs(f.member.id);
    const page = await html(ListPage({ searchParams: { workspace: f.wsOut.id } }));
    expect(page).toContain(`${f.token} task in`);
    expect(page).not.toContain(`${f.token} task out`);
    expect(page).toContain(f.wsIn.name);
    expect(page).not.toContain(f.wsOut.name);
  });

  it("the OWNER can open any workspace of the org, without being in it (the one he entered, and that one only)", async () => {
    const f = await makeScopedOrg();
    await loginAs(f.owner.id);
    enter(f.wsOut.id);
    const page = await html(ListPage({ searchParams: {} }));
    expect(page).toContain(`${f.token} task out`);
    expect(page).not.toContain(`${f.token} task in`);
    expect(page).toContain(f.wsOut.name);
    expect(page).not.toContain(f.wsIn.name);
  });

  it("an ADMIN opens only the workspaces they are in: none by rank, then just the one they were put in", async () => {
    const f = await makeScopedOrg();
    await loginAs(f.admin.id);
    const none = await html(ListPage({ searchParams: { workspace: f.wsOut.id } }));
    expect(none).toContain(t("list.noWorkspace"));
    expect(none).not.toContain(f.token);

    await joinWorkspace(f.admin.id, f.wsIn.id);
    const page = await html(ListPage({ searchParams: { workspace: f.wsOut.id } })); // asks for the one they are not in
    expect(page).toContain(`${f.token} task in`);
    expect(page).not.toContain(`${f.token} task out`);
    expect(page).toContain(f.wsIn.name);
    expect(page).not.toContain(f.wsOut.name);
  });

  it("a member of no workspace gets the 'no workspace' state, not someone else's tasks", async () => {
    const f = await makeScopedOrg();
    const loner = await makeUser({ orgId: f.org.id, role: "MEMBER" });
    await loginAs(loner.id);
    const page = await html(ListPage({ searchParams: {} }));
    expect(page).toContain(t("list.noWorkspace"));
    expect(page).not.toContain(f.token);
  });

  it("a GUEST's assignee choices stay inside their workspace", async () => {
    const f = await makeScopedOrg();
    await joinWorkspace(f.guest.id, f.wsIn.id, "GUEST");
    await loginAs(f.guest.id);
    const page = await html(ListPage({ searchParams: {} }));
    expect(page).toContain(`${f.token} task in`);
    expect(page).toContain(">Member<"); // shares the workspace
    expect(page).not.toContain(">Owner<");
    expect(page).not.toContain(">Admin<");
  });
});

describe("Calendar page: only workspaces the user can open", () => {
  it("a MEMBER asking for another workspace gets their own workspace's calendar", async () => {
    const f = await makeScopedOrg();
    const now = new Date();
    const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15, 12));
    const month = due.toISOString().slice(0, 7);
    await seedWork({ orgId: f.org.id, workspaceId: f.wsIn.id, token: f.token, label: "cal-in", creatorId: f.owner.id, dueDate: due });
    await seedWork({ orgId: f.org.id, workspaceId: f.wsOut.id, token: f.token, label: "cal-out", creatorId: f.owner.id, dueDate: due });

    await loginAs(f.member.id);
    const page = await html(CalendarPage({ searchParams: { workspace: f.wsOut.id, month } }));
    expect(page).toContain(`${f.token} task cal-in`);
    expect(page).not.toContain(`${f.token} task cal-out`);

    // the OWNER can open every workspace without a row (the one he entered)
    await loginAs(f.owner.id);
    enter(f.wsOut.id);
    const ownerPage = await html(CalendarPage({ searchParams: { workspace: f.wsOut.id, month } }));
    expect(ownerPage).toContain(`${f.token} task cal-out`);
    expect(ownerPage).not.toContain(`${f.token} task cal-in`);

    // an ADMIN gets no workspace by rank: nothing until put in one, and then asking for another one falls back
    await loginAs(f.admin.id);
    expect(await html(CalendarPage({ searchParams: { workspace: f.wsOut.id, month } }))).toContain(t("list.noWorkspace"));
    await joinWorkspace(f.admin.id, f.wsIn.id);
    const adminPage = await html(CalendarPage({ searchParams: { workspace: f.wsOut.id, month } }));
    expect(adminPage).toContain(`${f.token} task cal-in`);
    expect(adminPage).not.toContain(`${f.token} task cal-out`);
  });

  it("a member of no workspace sees the 'no workspace' state", async () => {
    const f = await makeScopedOrg();
    const loner = await makeUser({ orgId: f.org.id, role: "MEMBER" });
    await loginAs(loner.id);
    expect(await html(CalendarPage({ searchParams: {} }))).toContain(t("list.noWorkspace"));
  });
});

describe("Analytics page: this organization and the workspaces the user can open", () => {
  it("counts the user's own workspaces and the ideas of the space they are in, never another org's", async () => {
    const f = await makeScopedOrg();
    const other = await makeScopedOrg();
    // each space has its own ideas (2026-10-25): two of wsIn, one of wsOut; five in the other company
    const idea = (orgId: string, creatorId: string, workspaceId: string) => db.idea.create({ data: { orgId, creatorId, workspaceId, title: "An idea" } });
    for (let i = 0; i < 2; i += 1) await idea(f.org.id, f.owner.id, f.wsIn.id);
    await idea(f.org.id, f.owner.id, f.wsOut.id);
    for (let i = 0; i < 5; i += 1) await idea(other.org.id, other.owner.id, other.wsIn.id);
    // the reports box of the grid is a lead's and up by the template: the owner ticks it for this member
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: f.org.id, userId: f.member.id } },
      data: { capabilities: ["reports.view"] },
    });
    await loginAs(f.member.id);
    const page = await html(AnalyticsPage());
    expect(page).toContain(t("analytics.statWorkspaces", { n: 1 }));
    expect(page).toContain(t("analytics.statProjects", { n: 1 }));
    expect(page).toContain(t("analytics.ideasTotal", { total: 2 }));
    expect(page).not.toContain(t("analytics.ideasTotal", { total: 5 }));

    // the OWNER may enter every workspace of the org; the reports count the one he is in (each space is its own
    // site: «كل المساحات» is where he looks over all of them)
    // («لوحة التحكم», 2026-11-02: while it is on, the owner's «التقارير» is a section of the panel and this page sends him there; with that switch
    // off the page is exactly what it was, and this is what is pinned below)
    await loginAs(f.owner.id);
    await expect(AnalyticsPage()).rejects.toThrow("NEXT_REDIRECT:/owner?v=reports");
    const row = await db.organization.findUniqueOrThrow({ where: { id: f.org.id }, select: { settings: true } });
    await db.organization.update({ where: { id: f.org.id }, data: { settings: withFeature(row.settings, "controlPanel", false) as Prisma.InputJsonValue } });
    enter(f.wsOut.id);
    const ownerPage = await html(AnalyticsPage());
    expect(ownerPage).toContain(t("analytics.statWorkspaces", { n: 1 }));
    expect(ownerPage).toContain(t("analytics.ideasTotal", { total: 1 }));

    // an ADMIN counts only the spaces they are in (none yet: no space, no ideas); then the one they were put in
    await loginAs(f.admin.id);
    const adminPage = await html(AnalyticsPage());
    expect(adminPage).toContain(t("analytics.statWorkspaces", { n: 0 }));
    expect(adminPage).toContain(t("analytics.ideasTotal", { total: 0 }));
    await joinWorkspace(f.admin.id, f.wsOut.id);
    const joined = await html(AnalyticsPage());
    expect(joined).toContain(t("analytics.statWorkspaces", { n: 1 }));
    expect(joined).toContain(t("analytics.ideasTotal", { total: 1 }));
  });
});
