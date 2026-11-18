import { afterEach, describe, expect, it, vi } from "vitest";

// The pages call redirect()/notFound() and their client rows call useRouter(); no running Next app is needed here.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

import HomePage from "@/app/(app)/page";
import IdeasPage from "@/app/(app)/ideas/page";
import ProjectPage from "@/app/(app)/projects/[id]/page";
import ProjectsPage from "@/app/(app)/projects/page";
import TimelinePage from "@/app/(app)/projects/[id]/timeline/page";
import TaskPage from "@/app/(app)/tasks/[id]/page";
import BoardPage from "@/app/(app)/boards/[id]/page";
import * as projectsRoute from "@/app/api/projects/route";
import * as boardRoute from "@/app/api/boards/[id]/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as searchRoute from "@/app/api/search/route";
import * as orgRoute from "@/app/api/organizations/[id]/route";
import * as deptMembersRoute from "@/app/api/departments/[id]/members/route";
import * as ideasRoute from "@/app/api/ideas/route";
import * as goalsRoute from "@/app/api/goals/route";
import * as customersRoute from "@/app/api/crm/customers/route";
import * as chatDirectoryRoute from "@/app/api/chat/directory/route";
import * as productionRoute from "@/app/api/production/route";
import * as notificationsRoute from "@/app/api/notifications/route";
import * as startRoute from "@/app/api/integrations/google/start/route";
import * as callbackRoute from "@/app/api/integrations/google/callback/route";
import { signState } from "@/server/services/google";
import { getServerT } from "@/lib/i18n/server";
import { call, db, loginAs, logout, makeOrg, makeProject, makeTask, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";
import { makeDepartment } from "./guest-helpers";
import { html, makePending, suspendMember, type PageElement } from "./pages-access-helpers";

const { t } = getServerT();

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * One company with two spaces:
 *  - `wsIn`  : the member and the admin work in it (a project, a board, a task, one team)
 *  - `wsOut` : nobody works in it, so only the OWNER can open it (a project, a board, a task, two teams)
 */
async function spaceWorld() {
  const team = await makeTeam();
  const token = `zs${uid()}`;
  const wsIn = await makeWorkspace(team.org.id, [{ userId: team.member.id }, { userId: team.admin.id }], `In ${token}`);
  const wsOut = await makeWorkspace(team.org.id, [], `Out ${token}`);
  const inside = await makeProject(wsIn.id, `${token} project in`);
  const outside = await makeProject(wsOut.id, `${token} project out`);
  const taskIn = await makeTask({
    orgId: team.org.id,
    workspaceId: wsIn.id,
    projectId: inside.project.id,
    boardId: inside.board.id,
    columnId: inside.todo.id,
    creatorId: team.owner.id,
    title: `${token} task in`,
  });
  const taskOut = await makeTask({
    orgId: team.org.id,
    workspaceId: wsOut.id,
    projectId: outside.project.id,
    boardId: outside.board.id,
    columnId: outside.todo.id,
    creatorId: team.owner.id,
    title: `${token} task out`,
  });
  await db.team.create({ data: { workspaceId: wsIn.id, name: "Team in" } });
  await db.team.createMany({ data: [{ workspaceId: wsOut.id, name: "Team out 1" }, { workspaceId: wsOut.id, name: "Team out 2" }] });
  return { ...team, token, wsIn, wsOut, inside, outside, taskIn, taskOut };
}

describe("nobody inherits a space they are not in: the ADMIN is a guest of the doorway like everybody else", () => {

  it("an ADMIN who is not in a space is refused its routes (403) and its pages (not found); the OWNER opens everything", async () => {
    const w = await spaceWorld();
    await loginAs(w.admin.id);
    expect((await call(projectsRoute.GET, { url: `http://localhost/api/projects?workspaceId=${w.wsOut.id}` })).status).toBe(403);
    expect((await call(boardRoute.GET, { params: { id: w.outside.board.id } })).status).toBe(403);
    expect((await call(taskRoute.GET, { params: { id: w.taskOut.id } })).status).toBe(403);
    await expect(ProjectPage({ params: { id: w.outside.project.id } })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(TaskPage({ params: { id: w.taskOut.id } })).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(BoardPage({ params: { id: w.outside.board.id } })).rejects.toThrow("NEXT_NOT_FOUND");
    // the project list (even when asked for the other space by id) and the timeline stay inside their spaces
    const list = await html(ProjectsPage({ searchParams: { workspace: w.wsOut.id } }));
    expect(list).toContain(`${w.token} project in`);
    expect(list).not.toContain(`${w.token} project out`);
    expect(await html(TimelinePage({ params: { id: w.outside.project.id } }))).toContain(t("timeline.not_found"));

    // search stays inside the spaces the admin was put in
    const found = await call(searchRoute.GET, { url: `http://localhost/api/search?q=${w.token}` });
    expect(found.status).toBe(200);
    const titles = (found.json?.["tasks"] as { title: string }[]).map((x) => x.title);
    expect(titles).toEqual([`${w.token} task in`]);

    await loginAs(w.owner.id);
    expect((await call(projectsRoute.GET, { url: `http://localhost/api/projects?workspaceId=${w.wsOut.id}` })).status).toBe(200);
    expect((await call(boardRoute.GET, { params: { id: w.outside.board.id } })).status).toBe(200);
    expect((await call(taskRoute.GET, { params: { id: w.taskOut.id } })).status).toBe(200);
  });
});

describe("the task page offers only ACTIVE people as assignees", () => {
  it("leaves out a suspended or offboarded colleague who still has a row in the space", async () => {
    const team = await makeTeam();
    const colleague = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Active colleague" });
    const suspended = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Suspended colleague" });
    const gone = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Offboarded colleague" });
    const ws = await makeWorkspace(team.org.id, [
      { userId: team.member.id },
      { userId: colleague.id },
      { userId: suspended.id },
      { userId: gone.id },
    ]);
    const { project, board, todo } = await makeProject(ws.id);
    const task = await makeTask({
      orgId: team.org.id,
      workspaceId: ws.id,
      projectId: project.id,
      boardId: board.id,
      columnId: todo.id,
      creatorId: team.member.id,
    });
    await suspendMember(team.org.id, suspended.id);
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: team.org.id, userId: gone.id } },
      data: { status: "OFFBOARDED" },
    });

    await loginAs(team.member.id);
    const element = (await TaskPage({ params: { id: task.id } })) as PageElement;
    const names = (element.props["members"] as { name: string }[]).map((m) => m.name).sort();
    expect(names).toEqual(["Active colleague", "Member"]);
  });
});

describe("a LEAD is a member of the company like any other", () => {
  it("can read the organization summary (it used to list the ranks one by one and leave the lead out)", async () => {
    const team = await makeTeam();
    const lead = await makeUser({ orgId: team.org.id, role: "LEAD", name: "Team lead" });
    await loginAs(lead.id);
    const res = await call(orgRoute.GET, { params: { id: team.org.id } });
    expect(res.status).toBe(200);
    expect((res.json?.["org"] as { id: string }).id).toBe(team.org.id);
    // every other rank still can, and a stranger from another company still cannot
    for (const user of [team.owner, team.admin, team.member, team.guest]) {
      await loginAs(user.id);
      expect((await call(orgRoute.GET, { params: { id: team.org.id } })).status, user.name).toBe(200);
    }
    const stranger = await makeUser({ orgId: (await makeOrg()).id, role: "OWNER" });
    await loginAs(stranger.id);
    expect((await call(orgRoute.GET, { params: { id: team.org.id } })).status).toBe(403);
  });
});

describe("adding people to a department notifies only the people who can be added", () => {
  it("skips a suspended colleague and a stranger from another company", async () => {
    const team = await makeTeam();
    const active = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Active" });
    const suspended = await makeUser({ orgId: team.org.id, role: "MEMBER", name: "Suspended" });
    await suspendMember(team.org.id, suspended.id);
    const stranger = await makeUser({ orgId: (await makeOrg()).id, role: "MEMBER", name: "Stranger" });
    const dept = await makeDepartment(team.org.id, { name: `Secret department ${uid()}` });

    await loginAs(team.admin.id);
    const res = await call(deptMembersRoute.POST, {
      params: { id: dept.id },
      body: { addUserIds: [active.id, suspended.id, stranger.id] },
    });
    expect(res.status).toBe(200);
    const notified = await db.notification.findMany({
      where: { type: "dept_member_added", title: dept.name },
      select: { userId: true },
    });
    expect(notified.map((n) => n.userId)).toEqual([active.id]);
  });
});

describe("a person who has not finished onboarding is refused everywhere, and no screen hides why", () => {
  it("routes answer 403 auth.onboarding_required (not 401, not 500)", async () => {
    const team = await makeTeam();
    const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
    await makePending(team.member.id);
    await loginAs(team.member.id);

    const answers = [
      await call(ideasRoute.GET, { url: "http://localhost/api/ideas" }),
      await call(goalsRoute.GET),
      await call(customersRoute.GET),
      await call(chatDirectoryRoute.GET),
      await call(productionRoute.GET),
      await call(notificationsRoute.GET),
      await call(searchRoute.GET, { url: "http://localhost/api/search?q=ab" }),
      await call(projectsRoute.GET, { url: `http://localhost/api/projects?workspaceId=${ws.id}` }),
      await call(orgRoute.GET, { params: { id: team.org.id } }),
    ];
    for (const res of answers) {
      expect(res.status).toBe(403);
      expect(res.json?.["message"]).toBe("auth.onboarding_required");
    }
  });

  it("the Google start and callback routes do not turn it into a redirect to the login screen", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
    vi.stubEnv("APP_URL", "https://workspace.example.com");
    const team = await makeTeam();
    await makePending(team.admin.id);
    await loginAs(team.admin.id);

    const start = await call(startRoute.GET, { url: "http://localhost/api/integrations/google/start" });
    expect(start.status).toBe(403);
    expect(start.headers.get("location")).toBeNull();
    expect(start.json?.["message"]).toBe("auth.onboarding_required");

    const state = encodeURIComponent(signState(team.org.id, team.admin.id));
    const callback = await call(callbackRoute.GET, {
      url: `http://localhost/api/integrations/google/callback?code=abc&state=${state}`,
    });
    expect(callback.status).toBe(403);
    expect(callback.headers.get("location")).toBeNull();
    expect(callback.json?.["message"]).toBe("auth.onboarding_required");
  });

  it("pages never render for them: they are sent to /onboarding before anything is read (a page runs even when its layout redirects)", async () => {
    const team = await makeTeam();
    await makePending(team.member.id);
    await loginAs(team.member.id);
    await expect(IdeasPage()).rejects.toThrow(/NEXT_REDIRECT.*\/onboarding|auth\.onboarding_required/);
    await expect(HomePage({})).rejects.toThrow(/NEXT_REDIRECT.*\/onboarding|auth\.onboarding_required/);
  });
});

describe("the sign-in redirect of the Google routes is unchanged for somebody who is signed out", () => {
  it("start sends an anonymous caller to /login?next=/automation", async () => {
    vi.stubEnv("APP_URL", "https://workspace.example.com");
    logout();
    const res = await call(startRoute.GET, { url: "http://localhost/api/integrations/google/start" });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://workspace.example.com/login?next=%2Fautomation");
  });
});
