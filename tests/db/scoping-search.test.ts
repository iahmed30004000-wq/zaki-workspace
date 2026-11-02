import { describe, expect, it } from "vitest";
import * as searchRoute from "@/app/api/search/route";
import { call, db, loginAs, logout, makeOrg, makeUser, makeWorkspace } from "./helpers";
import { joinOrg, joinWorkspace, makeScopedOrg, seedWork } from "./scoping-helpers";
import { SPACE_COOKIE } from "@/server/services/current-space";

interface SearchBody {
  tasks: { id: string; key: string; title: string; priority: string; projectId: string; projectName: string }[];
  projects: { id: string; name: string; workspaceId: string; workspaceName: string }[];
}

/** Nothing found: every list of the answer empty (the space's chat, people and files included). */
const EMPTY = { tasks: [], projects: [], topics: [], messages: [], people: [], files: [], documents: [] };

async function search(q: string) {
  const res = await call(searchRoute.GET, { url: `http://localhost/api/search?q=${encodeURIComponent(q)}` });
  return { status: res.status, body: res.json as unknown as SearchBody };
}


/** Enter a space (src/server/services/current-space.ts): search looks inside the space the person is in. */
const enter = (spaceId: string) => (globalThis as { __zkCookieJar?: Map<string, string> }).__zkCookieJar?.set(SPACE_COOKIE, spaceId);

describe("search: only work in workspaces the caller can access", () => {
  it("a plain MEMBER finds the tasks and projects of their own workspace but none of a workspace they are not in", async () => {
    const f = await makeScopedOrg();
    await loginAs(f.member.id);
    const { status, body } = await search(f.token);
    expect(status).toBe(200);
    expect(body.tasks.map((t) => t.id)).toEqual([f.inside.task.id]);
    expect(body.projects.map((p) => p.id)).toEqual([f.inside.project.id]);
    // and nothing from the other workspace leaks through any field
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(f.outside.task.id);
    expect(raw).not.toContain(f.outside.project.id);
    expect(raw).not.toContain(f.wsOut.id);
  });

  it("a plain MEMBER of no workspace at all finds nothing", async () => {
    const f = await makeScopedOrg();
    const loner = await makeUser({ orgId: f.org.id, role: "MEMBER" });
    await loginAs(loner.id);
    const { status, body } = await search(f.token);
    expect(status).toBe(200);
    expect(body).toEqual(EMPTY);
  });

  it("an ADMIN finds only the work of the spaces they are in: nothing by rank, then just that space", async () => {
    const f = await makeScopedOrg();
    await loginAs(f.admin.id);
    expect((await search(f.token)).body).toEqual(EMPTY);

    await joinWorkspace(f.admin.id, f.wsOut.id, "MEMBER");
    const { body } = await search(f.token);
    expect(body.tasks.map((t) => t.id)).toEqual([f.outside.task.id]);
    expect(body.projects.map((p) => p.id)).toEqual([f.outside.project.id]);
    expect(JSON.stringify(body)).not.toContain(f.inside.task.id);
  });

  it("the OWNER finds the work of every workspace in the org — of the one he is in (each space is its own site)", async () => {
    const f = await makeScopedOrg();
    await loginAs(f.owner.id);
    for (const [space, work] of [[f.wsIn, f.inside], [f.wsOut, f.outside]] as const) {
      enter(space.id);
      const { body } = await search(f.token);
      expect(body.tasks.map((t) => t.id)).toEqual([work.task.id]);
      expect(body.projects.map((p) => p.id)).toEqual([work.project.id]);
    }
  });

  it("a workspace member added later starts finding that workspace's work", async () => {
    const f = await makeScopedOrg();
    const other = await makeUser({ orgId: f.org.id, role: "MEMBER" });
    await loginAs(other.id);
    expect((await search(f.token)).body.tasks).toEqual([]);
    await joinWorkspace(other.id, f.wsOut.id);
    const { body } = await search(f.token);
    expect(body.tasks.map((t) => t.id)).toEqual([f.outside.task.id]);
    expect(body.projects.map((p) => p.id)).toEqual([f.outside.project.id]);
  });

  it("a GUEST finds nothing unless they were put in a workspace, and then only that one", async () => {
    const f = await makeScopedOrg();
    await loginAs(f.guest.id);
    expect((await search(f.token)).body).toEqual(EMPTY);
    await joinWorkspace(f.guest.id, f.wsIn.id, "GUEST");
    const { body } = await search(f.token);
    expect(body.tasks.map((t) => t.id)).toEqual([f.inside.task.id]);
    expect(body.projects.map((p) => p.id)).toEqual([f.inside.project.id]);
  });

  it("never returns another organization's work, even for someone who belongs to both", async () => {
    const a = await makeScopedOrg();
    const b = await makeScopedOrg();
    // a user in both orgs: MEMBER of A inside wsIn only, MEMBER of B inside b.wsOut only
    const multi = await makeUser({ orgId: a.org.id, role: "MEMBER" });
    await joinWorkspace(multi.id, a.wsIn.id);
    await joinOrg(multi.id, b.org.id, "MEMBER");
    await joinWorkspace(multi.id, b.wsOut.id);

    // they work in A (their oldest membership) inside A's space: A's work is found, B's never
    await loginAs(multi.id);
    const forA = (await search(a.token)).body;
    expect(forA.tasks.map((t) => t.id)).toEqual([a.inside.task.id]);
    expect((await search(b.token)).body).toEqual(EMPTY);
    // a space of B named in the cookie is not theirs in the company they work in: still nothing of B's
    enter(b.wsOut.id);
    expect((await search(b.token)).body).toEqual(EMPTY);

    // and a user of only one org cannot find the other org's work at all
    await loginAs(a.owner.id);
    expect((await search(b.token)).body).toEqual(EMPTY);
  });

  it("an archived task is still left out and the response keeps its shape", async () => {
    const f = await makeScopedOrg();
    const extra = await seedWork({
      orgId: f.org.id,
      workspaceId: f.wsIn.id,
      token: f.token,
      label: "archived",
      creatorId: f.owner.id,
    });
    await db.task.update({ where: { id: extra.task.id }, data: { archived: true } });
    await loginAs(f.member.id);
    const { body } = await search(f.token);
    expect(body.tasks.map((t) => t.id)).toEqual([f.inside.task.id]);
    const task = body.tasks[0]!;
    expect(Object.keys(task).sort()).toEqual(["id", "key", "priority", "projectId", "projectName", "title"]);
    expect(task.projectId).toBe(f.inside.project.id);
    expect(task.projectName).toBe(f.inside.project.name);
    const project = body.projects.find((p) => p.id === f.inside.project.id)!;
    expect(Object.keys(project).sort()).toEqual(["id", "name", "workspaceId", "workspaceName"]);
    expect(project.workspaceId).toBe(f.wsIn.id);
    expect(project.workspaceName).toBe(f.wsIn.name);
  });

  it("keeps its contract: 401 anonymous, 401 for someone with no ACTIVE membership (they are signed out), empty for a one-letter query", async () => {
    const f = await makeScopedOrg();
    logout();
    expect((await search(f.token)).status).toBe(401);

    // someone in no organization has no ACTIVE membership: the session is not honoured (it used to be a 403)
    const stranger = await makeUser();
    await loginAs(stranger.id);
    expect((await search(f.token)).status).toBe(401);

    // a suspended person keeps their rows but is signed out at once: the same 401, and nothing is found
    const suspended = await makeUser({ orgId: f.org.id, role: "MEMBER" });
    await joinWorkspace(suspended.id, f.wsIn.id);
    await loginAs(suspended.id);
    expect((await search(f.token)).status).toBe(200);
    await db.organizationMember.update({
      where: { organizationId_userId: { organizationId: f.org.id, userId: suspended.id } },
      data: { status: "SUSPENDED" },
    });
    const refused = await search(f.token);
    expect(refused.status).toBe(401);
    expect(JSON.stringify(refused.body)).not.toContain(f.inside.task.id);

    await loginAs(f.admin.id);
    const short = await search("a");
    expect(short.status).toBe(200);
    expect(short.body).toEqual(EMPTY);
  });

  it("work in a same-named workspace of an org the caller does not belong to never shows up", async () => {
    const f = await makeScopedOrg();
    const otherOrg = await makeOrg();
    const intruder = await makeUser({ orgId: otherOrg.id, role: "ADMIN" });
    const ws = await makeWorkspace(otherOrg.id, [{ userId: intruder.id }], `Out ${f.token}`);
    await seedWork({ orgId: otherOrg.id, workspaceId: ws.id, token: f.token, label: "theirs", creatorId: intruder.id });
    await loginAs(f.member.id);
    const { body } = await search(f.token);
    expect(body.tasks.map((t) => t.id)).toEqual([f.inside.task.id]);
  });
});
