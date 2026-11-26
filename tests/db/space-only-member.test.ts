/**
 * «محصور بمساحة» (`OrganizationMember.spaceOnly`) — ask 5 of the owner's tasks prompt (2026-11-25): a person can be added to ONE
 * space only (the girls and Claude in «العمل»). They work inside it like anybody, and they see no other space, topic or private
 * message outside it: no «الشركة», no company-wide list of people, no departments, and nobody from outside can pull them out.
 * Every account made without it is exactly what it was.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as membersRoute from "@/app/api/organizations/[id]/members/route";
import * as memberRoute from "@/app/api/organizations/[id]/members/[userId]/route";
import * as conversationsRoute from "@/app/api/chat/conversations/route";
import * as conversationRoute from "@/app/api/chat/conversations/[id]/route";
import * as directoryRoute from "@/app/api/chat/directory/route";
import * as userRoute from "@/app/api/users/[id]/route";
import * as departmentsRoute from "@/app/api/departments/route";
import * as telegramRoute from "@/app/api/integrations/telegram/route";
import * as telegramMessagesRoute from "@/app/api/integrations/telegram/messages/route";
import * as tasksRoute from "@/app/api/tasks/route";
import * as inviteRoute from "@/app/api/calls/[id]/invite/route";
import * as convCallRoute from "@/app/api/chat/conversations/[id]/call/route";
import { addOrgToHq, hqSpaceIdOf, hqTopicIdOf } from "@/server/chat/hq";
import { chatDirectory, staffDirectory } from "@/server/chat/directory";
import { setCallsFetchForTests } from "@/server/calls/livekit";
import { presenceRoster } from "@/server/services/presence-roster";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { setAccountStatus } from "@/server/services/accounts";
import { spacesOf } from "@/server/services/current-space";
import { listWorkspacePeople } from "@/server/services/views";
import { changeWorkspaceMembers } from "@/server/services/workspaces";
import { call, db, loginAs, makeProject, makeTeam, makeUser, makeWorkspace, uid } from "./helpers";

const saved: Record<string, string | undefined> = {};
const CALL_KEYS = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const;
beforeAll(() => {
  for (const k of CALL_KEYS) saved[k] = process.env[k];
  process.env["LIVEKIT_URL"] = "wss://calls.test.local";
  process.env["LIVEKIT_API_KEY"] = "test-key";
  process.env["LIVEKIT_API_SECRET"] = "test-calls-secret-0123456789abcdef0123456789";
  setCallsFetchForTests(async () => Response.json({ participants: [] }));
});
afterAll(() => {
  for (const k of CALL_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setCallsFetchForTests(null);
});

/** A company with «الشركة», the space «العمل» and another space; one colleague inside «العمل», one stranger outside it. */
async function company() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const colleague = await makeUser({ orgId, role: "MEMBER", name: "زميلة العمل" });
  const stranger = await makeUser({ orgId, role: "MEMBER", name: "غريب برا العمل" });
  const work = await makeWorkspace(orgId, [{ userId: colleague.id }], "العمل");
  const other = await makeWorkspace(orgId, [{ userId: stranger.id }, { userId: team.member.id }], "التصنيع");
  await addOrgToHq(orgId);
  return { ...team, orgId, colleague, stranger, work, other, hq: hqSpaceIdOf(orgId) };
}
type Company = Awaited<ReturnType<typeof company>>;

const newBody = (over: Record<string, unknown> = {}) => ({ name: "بنت جديدة", username: `g${uid()}`, role: "MEMBER", ...over });
const create = (c: Company, body: Record<string, unknown>) => call(membersRoute.POST, { params: { id: c.orgId }, body });

/** The company plus «بنت»: made by the owner through the people screen, limited to «العمل», already onboarded. */
async function world() {
  const c = await company();
  await loginAs(c.owner.id);
  const made = await create(c, newBody({ workspaceIds: [c.work.id], spaceOnly: true }));
  expect(made.status, made.text).toBe(201);
  const girlId = made.json?.["userId"] as string;
  await db.user.update({ where: { id: girlId }, data: { mustChangePassword: false, transparencyVersion: 1, transparencyAcceptedAt: new Date() } });
  return { ...c, girlId };
}

const spaceIdsOf = async (userId: string) => (await db.workspaceMember.findMany({ where: { userId }, select: { workspaceId: true } })).map((r) => r.workspaceId).sort();
const openDm = (userId: string) => call(conversationsRoute.POST, { body: { kind: "DM", userId } });
const group = (memberIds: string[]) => call(conversationsRoute.POST, { body: { kind: "GROUP", title: "مجموعة", memberIds } });
const peopleIds = async (url: string) => (((await call(directoryRoute.GET, { url })).json?.["people"] ?? []) as Array<{ userId: string }>).map((p) => p.userId).sort();

describe("making the account", () => {
  it("is put in that one space and never in «الشركة»; an ordinary account still joins «الشركة»", async () => {
    const w = await world();
    expect(await spaceIdsOf(w.girlId)).toEqual([w.work.id]);
    expect((await db.organizationMember.findFirstOrThrow({ where: { userId: w.girlId } })).spaceOnly).toBe(true);
    await loginAs(w.owner.id);
    const plain = await create(w, newBody({ workspaceIds: [w.work.id] }));
    expect(await spaceIdsOf(plain.json?.["userId"] as string)).toEqual([w.work.id, w.hq].sort());
  });

  it("is refused with two spaces, with none, with «الشركة», or for another rank, and nothing is made", async () => {
    const c = await company();
    await loginAs(c.owner.id);
    const before = await db.organizationMember.count({ where: { organizationId: c.orgId } });
    const bad = [
      { workspaceIds: [c.work.id, c.other.id] },
      { workspaceIds: [] },
      { workspaceIds: [c.hq] },
      { workspaceIds: [c.work.id], role: "ADMIN" },
      { workspaceIds: [c.work.id], role: "GUEST" },
    ];
    for (const over of bad) expect((await create(c, newBody({ spaceOnly: true, ...over }))).status, JSON.stringify(over)).toBe(422);
    expect(await db.organizationMember.count({ where: { organizationId: c.orgId } })).toBe(before);
  });

  it("«الشركة» never comes back: not by the company-wide fill, not by a return from suspension, not by hand", async () => {
    const w = await world();
    await addOrgToHq(w.orgId);
    const actor = { userId: w.owner.id, orgId: w.orgId, role: "OWNER" as const, isOwner: true, isPrimaryOwner: true, isExternal: false, caps: effectiveCapabilities({ role: "OWNER", primaryOwner: true }) };
    await setAccountStatus(actor, w.girlId, { action: "suspend" });
    await setAccountStatus(actor, w.girlId, { action: "reactivate" });
    await expect(changeWorkspaceMembers({ userId: w.owner.id, orgRole: "OWNER" }, w.hq, { add: [w.girlId], remove: [], promote: [], demote: [] })).rejects.toThrow();
    expect(await spaceIdsOf(w.girlId)).toEqual([w.work.id]);
  });

  it("keeps the rank «موظف»: a change of rank is refused", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    const res = await call(memberRoute.PATCH, { method: "PATCH", params: { id: w.orgId, userId: w.girlId }, body: { role: "ADMIN" } });
    expect(res.status).toBe(422);
    expect(await spaceIdsOf(w.girlId)).toEqual([w.work.id]);
  });
});

describe("what the account sees", () => {
  it("its spaces are that one, and «الشركة»'s topics do not open", async () => {
    const w = await world();
    expect((await spacesOf({ userId: w.girlId, orgId: w.orgId, role: "MEMBER" })).map((s) => s.id)).toEqual([w.work.id]);
    await loginAs(w.girlId);
    const res = await call(conversationRoute.GET, { params: { id: hqTopicIdOf(w.orgId, "general") } });
    expect([403, 404]).toContain(res.status);
  });

  it("every list of people holds only the space's own (and the owner)", async () => {
    const w = await world();
    const own = [w.colleague.id, w.owner.id].sort();
    await loginAs(w.girlId);
    expect(await peopleIds("http://localhost/api/chat/directory?scope=company")).toEqual(own);
    expect(await peopleIds("http://localhost/api/chat/directory")).toEqual(own);
    const contacts = (await chatDirectory(w.orgId, undefined, w.girlId, "MEMBER")).map((p) => p.userId).filter((id) => id !== w.girlId).sort();
    expect(contacts).toEqual(own);
    const staff = (await staffDirectory(w.orgId, "MEMBER", w.girlId)).map((p) => p.id).filter((id) => id !== w.girlId).sort();
    expect(staff).toEqual(own);
    const filter = (await listWorkspacePeople({ orgId: w.orgId, workspaceId: w.work.id, orgRole: "MEMBER", userId: w.girlId })).map((p) => p.id).filter((id) => id !== w.girlId).sort();
    expect(filter).toEqual(own);
    expect((await call(userRoute.GET, { params: { id: w.stranger.id } })).status).toBe(404);
    expect((await call(userRoute.GET, { params: { id: w.colleague.id } })).status).toBe(200);
  });

  it("taken out of its one space it meets nobody, not the whole company", async () => {
    const w = await world();
    await db.workspaceMember.deleteMany({ where: { userId: w.girlId } });
    expect((await presenceRoster(w.orgId, w.girlId, { spaceId: null })).people.map((p) => p.userId)).toEqual([w.girlId]);
    await loginAs(w.girlId);
    expect(await peopleIds("http://localhost/api/chat/directory?scope=company")).toEqual([]);
    expect((await openDm(w.owner.id)).status).toBe(403);
  });

  it("an ordinary member's lists are what they were", async () => {
    const w = await world();
    await loginAs(w.colleague.id);
    expect(await peopleIds("http://localhost/api/chat/directory?scope=company")).toContain(w.stranger.id);
    expect((await staffDirectory(w.orgId, "MEMBER", w.colleague.id)).map((p) => p.id)).toContain(w.stranger.id);
    expect((await call(userRoute.GET, { params: { id: w.stranger.id } })).status).toBe(200);
    expect((await call(departmentsRoute.GET)).status).toBe(200);
  });

  it("the company-wide areas are closed: departments, the customers' Telegram, and the tickets, campaigns and customers boxes", async () => {
    const w = await world();
    await loginAs(w.girlId);
    expect((await call(departmentsRoute.GET)).status).toBe(403);
    expect((await call(telegramRoute.GET)).status).toBe(403);
    expect((await call(telegramMessagesRoute.GET, { url: "http://localhost/api/integrations/telegram/messages?chatId=x" })).status).toBe(403);
    const row = await db.organizationMember.findFirstOrThrow({ where: { userId: w.girlId } });
    // even when somebody switches one on by hand: the account's limit wins
    const caps = effectiveCapabilities({ ...row, capabilities: ["tickets.view", "tickets.edit", "crm.view", "users.manage"] });
    for (const c of ["tickets.view", "tickets.edit", "campaigns.view", "crm.view", "users.manage"] as const) expect(caps.has(c), c).toBe(false);
    for (const c of ["tasks.view", "tasks.edit", "projects.view", "files.view", "calls.view", "directory.view"] as const) expect(caps.has(c), c).toBe(true);
  });

  it("inside its space it works like anybody: a task, and a private message with a colleague there and with the owner", async () => {
    const w = await world();
    const alpha = await makeProject(w.work.id, "ألفا");
    await loginAs(w.girlId);
    const task = await call(tasksRoute.POST, { body: { workspaceId: w.work.id, projectId: alpha.project.id, boardId: alpha.board.id, title: "مهمتها", assigneeId: w.colleague.id } });
    expect(task.status, task.text).toBe(201);
    expect((await openDm(w.colleague.id)).status).toBe(201);
    expect((await openDm(w.owner.id)).status).toBe(201);
    expect((await group([w.colleague.id])).status).toBe(201);
  });
});

describe("nobody connects it with somebody outside its space", () => {
  it("no private message, from either side", async () => {
    const w = await world();
    await loginAs(w.girlId);
    expect((await openDm(w.stranger.id)).status).toBe(403);
    await loginAs(w.stranger.id);
    expect((await openDm(w.girlId)).status).toBe(403);
  });

  it("no group holding both: not made by it, not made about it, not added to later", async () => {
    const w = await world();
    await loginAs(w.girlId);
    expect((await group([w.stranger.id])).status).toBe(403);
    const mine = (await group([w.colleague.id])).json?.["id"] as string;
    expect((await call(conversationRoute.PATCH, { method: "PATCH", params: { id: mine }, body: { addMemberIds: [w.stranger.id] } })).status).toBe(403);
    await loginAs(w.stranger.id);
    expect((await group([w.girlId])).status).toBe(403);
    const theirs = (await group([w.member.id])).json?.["id"] as string;
    expect((await call(conversationRoute.PATCH, { method: "PATCH", params: { id: theirs }, body: { addMemberIds: [w.girlId] } })).status).toBe(403);
    expect(await db.conversationMember.count({ where: { userId: w.girlId, conversationId: theirs } })).toBe(0);
    // two ordinary members of different spaces still make a group, as before
    expect((await group([w.colleague.id])).status).toBe(201);
  });

  it("no call is rung from its group to somebody outside", async () => {
    const w = await world();
    await loginAs(w.girlId);
    const mine = (await group([w.colleague.id])).json?.["id"] as string;
    const started = await call(convCallRoute.POST, { params: { id: mine }, body: { video: false, ring: false } });
    expect(started.status, started.text).toBe(201);
    const res = await call(inviteRoute.POST, { params: { id: started.json?.["id"] as string }, body: { userId: w.stranger.id } });
    expect(res.status).toBe(403);
  });
});
