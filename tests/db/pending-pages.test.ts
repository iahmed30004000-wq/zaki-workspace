import "./scoping-react";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The onboarding gate on PAGES (found by independent review A).
 *
 * For pages the gate is (1) the middleware, which only sees the cookie's `mcp`/`tp` hints, and
 * (2) the (app) layout, which redirects to /onboarding from the database. (2) alone does not protect
 * a page: in Next 14.2 the page segment is rendered beside the layout, not inside it, so a page runs
 * (and its output is streamed) even when its layout throws redirect(). Every page therefore refuses a
 * pending person itself (`pageUser()` / `pageActor()`), which matters whenever the cookie carries no
 * hint: after the owner raises the notice version (every existing cookie), for instance.
 */

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import AppLayout from "@/app/(app)/layout";
import HomePage from "@/app/(app)/page";
import TaskPage from "@/app/(app)/tasks/[id]/page";
import MyWorkPage from "@/app/(app)/my-work/page";
import ProjectsPage from "@/app/(app)/projects/page";
import ListPage from "@/app/(app)/list/page";
import BoardPage from "@/app/(app)/boards/[id]/page";
import { middleware } from "@/middleware";
import { db, loginAs, logout, makeProject, makeTask, makeTeam, makeWorkspace, uid } from "./helpers";
import { sessionCookie } from "./login-helpers";

beforeEach(() => logout());

type Outcome = { kind: "rendered"; text: string } | { kind: "refused"; reason: string };

/** Every string inside a rendered element tree (props of server and client components alike). */
function textOf(value: unknown): string {
  const seen = new WeakSet<object>();
  return (
    JSON.stringify(value, (_key, v: unknown) => {
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return undefined;
        seen.add(v);
      }
      return typeof v === "function" || typeof v === "symbol" ? undefined : v;
    }) ?? ""
  );
}

async function outcome(render: () => Promise<unknown>): Promise<Outcome> {
  let element: unknown;
  try {
    element = await render();
  } catch (err) {
    return { kind: "refused", reason: err instanceof Error ? err.message : String(err) };
  }
  return { kind: "rendered", text: textOf(element) };
}

/** A member with work, signed in while nothing was owed; then the owner raises the notice version. */
async function pendingAfterNoticeBump() {
  const team = await makeTeam();
  const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }], `space-${uid()}`);
  const { project, board, todo } = await makeProject(ws.id, `project-${uid()}`);
  const secret = `confidential-${uid()}`;
  const task = await makeTask({
    orgId: team.org.id,
    workspaceId: ws.id,
    projectId: project.id,
    boardId: board.id,
    columnId: todo.id,
    creatorId: team.owner.id,
    assigneeId: team.member.id,
    title: secret,
    dueDate: new Date(),
  });
  await loginAs(team.member.id); // cookie without mcp/tp: nothing was owed when it was issued
  await db.organization.update({ where: { id: team.org.id }, data: { settings: { transparencyVersion: 2 } } });
  return { ...team, ws, project, task, secret };
}

describe("a pending person gets no page data (the layout redirect alone does not stop a page)", () => {
  it("the request reaches the page: the middleware only sees the cookie, which carries no hint", async () => {
    const { task } = await pendingAfterNoticeBump();
    const headers = new Headers({ host: "localhost:3000", cookie: `zaki_session=${sessionCookie()}`, rsc: "1" });
    const res = await middleware(new NextRequest(`http://localhost:3000/tasks/${task.id}`, { headers }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("the layout redirects, and the home page refuses", async () => {
    await pendingAfterNoticeBump();
    expect((await outcome(() => AppLayout({ children: null }))).kind).toBe("refused");
    const home = await outcome(() => HomePage({}));
    expect(home.kind).toBe("refused");
    if (home.kind === "refused") expect(["auth.onboarding_required", "NEXT_REDIRECT:/onboarding"]).toContain(home.reason);
  });

  it("the list page refuses a pending person", async () => {
    const { secret } = await pendingAfterNoticeBump();
    const res = await outcome(() => ListPage({ searchParams: {} }));
    expect(res.kind, `rendered for a pending person; contains the task title: ${res.kind === "rendered" && res.text.includes(secret)}`).toBe("refused");
  });

  it("the board page refuses a pending person", async () => {
    const { task, secret } = await pendingAfterNoticeBump();
    const res = await outcome(() => BoardPage({ params: { id: task.boardId } }));
    expect(res.kind, `rendered for a pending person; contains the task title: ${res.kind === "rendered" && res.text.includes(secret)}`).toBe("refused");
  });

  it("the task page refuses a pending person", async () => {
    const { task, secret } = await pendingAfterNoticeBump();
    const res = await outcome(() => TaskPage({ params: { id: task.id } }));
    expect(res.kind, `rendered for a pending person; contains the task title: ${res.kind === "rendered" && res.text.includes(secret)}`).toBe("refused");
  });

  it("the my-work page refuses a pending person", async () => {
    const { secret } = await pendingAfterNoticeBump();
    const res = await outcome(() => MyWorkPage({ searchParams: { tab: "mine" } }));
    expect(res.kind, `rendered for a pending person; contains the task title: ${res.kind === "rendered" && res.text.includes(secret)}`).toBe("refused");
  });

  it("the projects page refuses a pending person", async () => {
    const { project } = await pendingAfterNoticeBump();
    const res = await outcome(() => ProjectsPage({ searchParams: {} }));
    expect(res.kind, `rendered for a pending person; contains the project name: ${res.kind === "rendered" && res.text.includes(project.name)}`).toBe("refused");
  });
});
