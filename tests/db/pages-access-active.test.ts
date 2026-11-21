import { describe, expect, it, vi } from "vitest";

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
import ChatPage from "@/app/(app)/chat/page";
import GoalsPage from "@/app/(app)/goals/page";
import ProductionPage from "@/app/(app)/production/page";
import FilesPage from "@/app/(app)/files/page";
import AnalyticsPage from "@/app/(app)/analytics/page";
import * as chatHomeRoute from "@/app/api/chat/home/route";
import * as goalsRoute from "@/app/api/goals/route";
import * as productionRoute from "@/app/api/production/route";
import * as routinesRoute from "@/app/api/production/routines/route";
import * as ideasRoute from "@/app/api/ideas/route";
import * as taskRoute from "@/app/api/tasks/[id]/route";
import * as orgRoute from "@/app/api/organizations/[id]/route";
import * as boardRoute from "@/app/api/boards/[id]/route";
import * as projectsRoute from "@/app/api/projects/route";
import * as customersRoute from "@/app/api/crm/customers/route";
import { getServerT } from "@/lib/i18n/server";
import { withHq } from "./hq-helpers";
import { call, db, loginAs, makeOrg, makeProject, makeTask, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";
import { makeRoutine } from "./guest-helpers";
import { html, makeGoal, makeIdea, makeTwoCompanyPerson, suspendMember, type PageElement } from "./pages-access-helpers";

const { t } = getServerT();

/**
 * "Nobody who was suspended or removed still counts": a person who works in two companies and
 * is suspended in the OLDER one must be served the company they are still ACTIVE in, with the
 * role they hold THERE - on every page and route that used to take "the oldest membership".
 */

describe("routes serve the ACTIVE company, never the suspended one", () => {
  it("GET /api/goals lists the goals of the active company only", async () => {
    const w = await makeTwoCompanyPerson();
    await makeGoal(w.oldOrg.id, w.oldOwner.id, "OLD COMPANY GOAL");
    await makeGoal(w.newOrg.id, w.newOwner.id, "NEW COMPANY GOAL");
    // the company's «الشركة» (the old rows, with no space, are read there)
    await withHq(w.newOrg.id, [w.person.id]);
    await loginAs(w.person.id);
    const res = await call(goalsRoute.GET);
    expect(res.status).toBe(200);
    expect((res.json?.["goals"] as { title: string }[]).map((g) => g.title)).toEqual(["NEW COMPANY GOAL"]);
  });

  it("POST /api/goals uses the role held in the active company (a member there), and writes nothing into the suspended one", async () => {
    const w = await makeTwoCompanyPerson({ oldRole: "ADMIN", newRole: "MEMBER" });
    await loginAs(w.person.id);
    const res = await call(goalsRoute.POST, {
      body: { title: "Sneaky goal", period: "WEEKLY", anchorDate: "2026-10-22" },
    });
    expect(res.status).toBe(403);
    expect(await db.goal.count({ where: { title: "Sneaky goal" } })).toBe(0);
  });

  it("GET /api/production shows the active company's checklist only", async () => {
    const w = await makeTwoCompanyPerson();
    await makeRoutine({ orgId: w.oldOrg.id, title: "OLD COMPANY ROUTINE" });
    await makeRoutine({ orgId: w.newOrg.id, title: "NEW COMPANY ROUTINE" });
    // the company's «الشركة» (the old rows, with no space, are read there)
    await withHq(w.newOrg.id, [w.person.id]);
    await loginAs(w.person.id);
    const res = await call(productionRoute.GET);
    expect(res.status).toBe(200);
    expect((res.json?.["items"] as { title: string }[]).map((r) => r.title)).toEqual(["NEW COMPANY ROUTINE"]);
  });

  it("GET /api/production/routines lists the active company's routines only", async () => {
    const w = await makeTwoCompanyPerson();
    await makeRoutine({ orgId: w.oldOrg.id, title: "OLD COMPANY ROUTINE" });
    await makeRoutine({ orgId: w.newOrg.id, title: "NEW COMPANY ROUTINE" });
    // the company's «الشركة» (the old rows, with no space, are read there)
    await withHq(w.newOrg.id, [w.person.id]);
    await loginAs(w.person.id);
    const res = await call(routinesRoute.GET);
    expect(res.status).toBe(200);
    expect((res.json?.["routines"] as { title: string }[]).map((r) => r.title)).toEqual(["NEW COMPANY ROUTINE"]);
  });

  it("POST /api/production/routines cannot be used with the role of the suspended company", async () => {
    const w = await makeTwoCompanyPerson({ oldRole: "ADMIN", newRole: "MEMBER" });
    await loginAs(w.person.id);
    const res = await call(routinesRoute.POST, { body: { title: "Sneaky routine" } });
    expect(res.status).toBe(403);
    expect(await db.routine.count({ where: { title: "Sneaky routine" } })).toBe(0);
  });

  it("GET /api/ideas lists the active company's ideas only, and POST files a new one there", async () => {
    const w = await makeTwoCompanyPerson();
    // the ideas of the company's «الشركة» (the old ones, with no space, are read there)
    await withHq(w.newOrg.id, [w.person.id]);
    await makeIdea(w.oldOrg.id, w.oldOwner.id, "OLD COMPANY IDEA");
    await makeIdea(w.newOrg.id, w.newOwner.id, "NEW COMPANY IDEA");
    await loginAs(w.person.id);
    const list = await call(ideasRoute.GET, { url: "http://localhost/api/ideas" });
    expect(list.status).toBe(200);
    expect((list.json?.["ideas"] as { title: string }[]).map((i) => i.title)).toEqual(["NEW COMPANY IDEA"]);

    const freshTitle = `A fresh idea ${uid()}`;
    const created = await call(ideasRoute.POST, { body: { title: freshTitle } });
    expect(created.status).toBe(201);
    const row = await db.idea.findFirstOrThrow({ where: { title: freshTitle } });
    expect(row.orgId).toBe(w.newOrg.id);
  });

  it("PATCH /api/tasks/[id] refuses to assign a task to a suspended or offboarded colleague", async () => {
    const team = await makeTeam();
    const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
    const { project, board, todo } = await makeProject(ws.id);
    const task = await makeTask({
      orgId: team.org.id,
      workspaceId: ws.id,
      projectId: project.id,
      boardId: board.id,
      columnId: todo.id,
      creatorId: team.member.id,
    });
    const suspended = await makeUser({ orgId: team.org.id, role: "MEMBER" });
    const offboarded = await makeUser({ orgId: team.org.id, role: "MEMBER" });
    const colleague = await makeUser({ orgId: team.org.id, role: "MEMBER" });
    // B4 (a task is given only to a person of its space): the active colleague works in the space
    await db.workspaceMember.create({ data: { workspaceId: ws.id, userId: colleague.id } });
    await suspendMember(team.org.id, suspended.id);
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: team.org.id, userId: offboarded.id } },
      data: { status: "OFFBOARDED" },
    });

    const stranger = await makeUser({ orgId: (await makeOrg()).id, role: "MEMBER" });

    await loginAs(team.member.id);
    for (const gone of [suspended, offboarded]) {
      const res = await call(taskRoute.PATCH, { method: "PATCH", params: { id: task.id }, body: { assigneeId: gone.id } });
      expect(res.status).toBe(403);
      expect(res.json?.["message"]).toBe("assignee.not_active");
    }
    const outsider = await call(taskRoute.PATCH, { method: "PATCH", params: { id: task.id }, body: { assigneeId: stranger.id } });
    expect(outsider.status).toBe(403);
    expect(outsider.json?.["message"]).toBe("assignee.not_member");
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId).toBeNull();

    const ok = await call(taskRoute.PATCH, { method: "PATCH", params: { id: task.id }, body: { assigneeId: colleague.id } });
    expect(ok.status).toBe(200);
  });

  it("PATCH /api/tasks/[id] still lets the others edit a task whose assignee was suspended since (re-sending them changes nothing)", async () => {
    const team = await makeTeam();
    const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
    const { project, board, todo } = await makeProject(ws.id);
    const holder = await makeUser({ orgId: team.org.id, role: "MEMBER" });
    const task = await makeTask({
      orgId: team.org.id,
      workspaceId: ws.id,
      projectId: project.id,
      boardId: board.id,
      columnId: todo.id,
      creatorId: team.member.id,
      assigneeId: holder.id,
    });
    await suspendMember(team.org.id, holder.id);

    await loginAs(team.member.id);
    const res = await call(taskRoute.PATCH, {
      method: "PATCH",
      params: { id: task.id },
      body: { title: "Renamed while the holder is away", assigneeId: holder.id },
    });
    expect(res.status).toBe(200);
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).title).toBe("Renamed while the holder is away");
  });
});

describe("pages serve the ACTIVE company, with the role held there", () => {
  it("/ideas lists the active company's ideas and is not a manager's view", async () => {
    const w = await makeTwoCompanyPerson({ oldRole: "ADMIN", newRole: "MEMBER" });
    // the ideas of the company's «الشركة» (the old ones, with no space, are read there)
    await withHq(w.newOrg.id, [w.person.id]);
    await makeIdea(w.oldOrg.id, w.oldOwner.id, "OLD COMPANY IDEA");
    await makeIdea(w.newOrg.id, w.newOwner.id, "NEW COMPANY IDEA");
    await loginAs(w.person.id);
    const element = (await IdeasPage()) as PageElement;
    expect((element.props["initial"] as { title: string }[]).map((i) => i.title)).toEqual(["NEW COMPANY IDEA"]);
    expect(element.props["ctx"]).toMatchObject({ orgRole: "MEMBER", canManage: false });
  });

  it("/chat opens the active company's chat", async () => {
    // Phase 3: the page hands over only who is looking (a guest or not); the list itself comes from
    // /api/chat/home, which scopes to the active company on the server (activeOrgCtx).
    const w = await makeTwoCompanyPerson({ oldRole: "ADMIN", newRole: "MEMBER" });
    for (const [org, title] of [[w.oldOrg, "OLD COMPANY TOPIC"], [w.newOrg, "NEW COMPANY TOPIC"]] as const) {
      const space = await makeWorkspace(org.id, [{ userId: w.person.id }]);
      await db.conversation.create({ data: { orgId: org.id, kind: "TOPIC", spaceId: space.id, title } });
    }
    await loginAs(w.person.id);
    const element = (await ChatPage()) as PageElement;
    // who is looking, and whether they may start a meeting (the calls row of the section grid, 2026-10-26)
    expect(element.props).toEqual({ guest: false, canMeet: true });
    const home = await call(chatHomeRoute.GET, { url: "http://localhost/api/chat/home" });
    expect(home.status).toBe(200);
    expect(home.text).toContain("NEW COMPANY TOPIC");
    expect(home.text).not.toContain("OLD COMPANY TOPIC");
  });

  it("/files and /goals and /production take the role from the active company", async () => {
    const w = await makeTwoCompanyPerson({ oldRole: "ADMIN", newRole: "MEMBER" });
    await loginAs(w.person.id);
    expect(((await FilesPage()) as PageElement).props["me"]).toEqual({ id: w.person.id, role: "MEMBER" });
    expect(((await GoalsPage()) as PageElement).props["canManage"]).toBe(false);
    const production = (await ProductionPage()) as PageElement;
    expect(production.props["canManage"]).toBe(false);
    expect(production.props["readOnly"]).toBe(false);
  });

  it("/analytics counts the ideas of the active company only", async () => {
    const w = await makeTwoCompanyPerson();
    // the ideas of the company's «الشركة» (the old ones, with no space, are read there)
    await withHq(w.newOrg.id, [w.person.id]);
    for (let i = 0; i < 5; i += 1) await makeIdea(w.oldOrg.id, w.oldOwner.id, `old idea ${i}`);
    for (let i = 0; i < 2; i += 1) await makeIdea(w.newOrg.id, w.newOwner.id, `new idea ${i}`);
    // a member reads the reports once the owner ticks the box (the template gives them to a lead and up)
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: w.newOrg.id, userId: w.person.id } },
      data: { capabilities: ["reports.view"] },
    });
    await loginAs(w.person.id);
    const page = await html(AnalyticsPage({}));
    expect(page).toContain(t("analytics.ideasTotal", { total: 2 }));
    expect(page).not.toContain(t("analytics.ideasTotal", { total: 5 }));
  });
});

describe("a suspended person's old cookie is dead (sessions ended at suspension)", () => {
  it("answers 401 on routes", async () => {
    const team = await makeTeam();
    const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
    await loginAs(team.member.id); // the cookie was issued while the person was active
    await suspendMember(team.org.id, team.member.id, { endSessions: true });

    expect((await call(ideasRoute.GET, { url: "http://localhost/api/ideas" })).status).toBe(401);
    expect((await call(projectsRoute.GET, { url: `http://localhost/api/projects?workspaceId=${ws.id}` })).status).toBe(401);
    expect((await call(customersRoute.GET)).status).toBe(401);
    expect((await call(goalsRoute.GET)).status).toBe(401);
  });

  it("sends pages to the login screen", async () => {
    const team = await makeTeam();
    await loginAs(team.member.id);
    await suspendMember(team.org.id, team.member.id, { endSessions: true });

    await expect(HomePage({})).rejects.toThrow("NEXT_REDIRECT:/login");
    await expect(IdeasPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    await expect(ChatPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    await expect(FilesPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });
});

describe("a status change alone (no new session version) still closes the door", () => {
  it("the cookie of a person with no active membership left is refused on routes and pages", async () => {
    const team = await makeTeam();
    const ws = await makeWorkspace(team.org.id, [{ userId: team.member.id }]);
    await loginAs(team.member.id);
    await suspendMember(team.org.id, team.member.id); // no version bump: the old cookie is still signed correctly

    expect((await call(ideasRoute.GET, { url: "http://localhost/api/ideas" })).status).toBe(401);
    expect((await call(projectsRoute.GET, { url: `http://localhost/api/projects?workspaceId=${ws.id}` })).status).toBe(401);
    await expect(HomePage({})).rejects.toThrow("NEXT_REDIRECT:/login");
    await expect(IdeasPage()).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("requireOrgMember and requireWorkspace refuse a company where the person is suspended, while their other company keeps working", async () => {
    const w = await makeTwoCompanyPerson({ oldRole: "MEMBER", newRole: "MEMBER" });
    // the person still has a workspace row in the old company: a leftover must grant nothing
    const oldWs = await makeWorkspace(w.oldOrg.id, [{ userId: w.person.id }]);
    const { board } = await makeProject(oldWs.id);
    const newWs = await makeWorkspace(w.newOrg.id, [{ userId: w.person.id }]);
    const newProject = await makeProject(newWs.id);
    await loginAs(w.person.id);

    const oldOrg = await call(orgRoute.GET, { params: { id: w.oldOrg.id } });
    expect(oldOrg.status).toBe(403);
    expect(oldOrg.json?.["message"]).toBe("not_org_member");
    expect((await call(orgRoute.GET, { params: { id: w.newOrg.id } })).status).toBe(200);

    const oldBoard = await call(boardRoute.GET, { params: { id: board.id } });
    expect(oldBoard.status).toBe(403);
    expect(oldBoard.json?.["message"]).toBe("not_workspace_member");
    expect((await call(boardRoute.GET, { params: { id: newProject.board.id } })).status).toBe(200);
  });
});
