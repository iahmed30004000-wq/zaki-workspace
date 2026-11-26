/**
 * «حساب وكيل» 🤖 — ask 6 of the owner's tasks prompt (2026-11-25): a kind of account for Claude and ميوز, labelled 🤖, so what
 * they post shows under their own name and not the owner's.
 *
 * Two halves. The account: an ordinary login of its own whose name carries 🤖 wherever a name is shown. The token: Claude
 * reaches the app with a door token, which until now acted as whoever MADE it; the owner may now make one that acts as an
 * agent account («باسم مين»). Only an agent account can be chosen: nothing is ever written in a real person's name.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as membersRoute from "@/app/api/organizations/[id]/members/route";
import * as memberRoute from "@/app/api/organizations/[id]/members/[userId]/route";
import * as meRoute from "@/app/api/me/route";
import * as mcpRoute from "@/app/mcp/route";
import * as systemTokensRoute from "@/app/api/system-tokens/route";
import * as apiTokensRoute from "@/app/api/integrations/api-tokens/route";
import * as v1TasksRoute from "@/app/api/v1/tasks/route";
import { withFeature } from "@/lib/features";
import { initials } from "@/lib/format";
import { setAccountStatus } from "@/server/services/accounts";
import { effectiveCapabilities } from "@/server/policy/capabilities";
import { failureLimiter } from "@/server/door/limits";
import { call, db, loginAs, logout, makeProject, makeTeam, makeWorkspace, uid } from "./helpers";

beforeEach(() => failureLimiter.reset("unknown"));

async function world() {
  const team = await makeTeam();
  const orgId = team.org.id;
  const space = await makeWorkspace(orgId, [{ userId: team.admin.id, role: "ADMIN" }, { userId: team.member.id }], "العمل");
  const other = await makeWorkspace(orgId, [], "التصنيع");
  const board = await makeProject(space.id);
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "apiDoor", true) as Prisma.InputJsonValue } });
  return { ...team, orgId, space, other, ...board };
}
type World = Awaited<ReturnType<typeof world>>;

const create = (w: World, over: Record<string, unknown> = {}) =>
  call(membersRoute.POST, { params: { id: w.orgId }, body: { name: "Claude", username: `a${uid()}`, role: "MEMBER", workspaceIds: [w.space.id], ...over } });

/** The agent account «Claude», made by the owner through the people screen. It has never signed in (its password is still temporary). */
async function agentIn(w: World, over: Record<string, unknown> = {}) {
  await loginAs(w.owner.id);
  const made = await create(w, { agent: true, ...over });
  expect(made.status, made.text).toBe(201);
  logout();
  return made.json!["userId"] as string;
}
const nameOf = async (userId: string) => (await db.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } })).name;

describe("the account", () => {
  it("is marked, and its name carries 🤖; an ordinary account is what it was", async () => {
    const w = await world();
    const claude = await agentIn(w);
    expect(await nameOf(claude)).toBe("Claude 🤖");
    expect((await db.organizationMember.findFirstOrThrow({ where: { userId: claude } })).agent).toBe(true);
    await loginAs(w.owner.id);
    const person = (await create(w, { name: "سلمى" })).json!["userId"] as string;
    expect(await nameOf(person)).toBe("سلمى");
    expect((await db.organizationMember.findFirstOrThrow({ where: { userId: person } })).agent).toBe(false);
  });

  it("keeps the mark, once, through every change of its name: by the owner and by itself", async () => {
    const w = await world();
    const claude = await agentIn(w, { name: "🤖 Claude 🤖" });
    expect(await nameOf(claude)).toBe("Claude 🤖");
    await loginAs(w.owner.id);
    expect((await call(memberRoute.PATCH, { method: "PATCH", params: { id: w.orgId, userId: claude }, body: { name: "كلود" } })).status).toBe(200);
    expect(await nameOf(claude)).toBe("كلود 🤖");
    await db.user.update({ where: { id: claude }, data: { mustChangePassword: false, transparencyVersion: 1, transparencyAcceptedAt: new Date() } });
    await loginAs(claude);
    const own = await call(meRoute.PATCH, { method: "PATCH", body: { name: "Claude الجديد" } });
    expect(own.status, own.text).toBe(200);
    expect(await nameOf(claude)).toBe("Claude الجديد 🤖");
  });

  it("is never a partner of outside nor an owner, when made or later", async () => {
    const w = await world();
    await loginAs(w.owner.id);
    expect((await create(w, { agent: true, role: "GUEST" })).status).toBe(422);
    const claude = await agentIn(w);
    await loginAs(w.owner.id);
    for (const role of ["GUEST", "OWNER"]) expect((await call(memberRoute.PATCH, { method: "PATCH", params: { id: w.orgId, userId: claude }, body: { role } })).status, role).toBe(422);
  });

  it("its round letter is a letter, not half of the 🤖", () => {
    expect(initials("Claude 🤖")).toBe("C");
    expect(initials("ميوز 🤖")).toBe("م");
    expect(initials("سلمى أحمد")).toBe("سأ");
  });
});

// ---------- the token ----------

const makeToken = (w: World, body: Record<string, unknown> = {}) => call(systemTokensRoute.POST, { url: "http://localhost/api/system-tokens", body: { system: "claude-mcp", workspaceId: w.space.id, ...body } });
async function mint(w: World, body: Record<string, unknown> = {}) {
  await loginAs(w.owner.id);
  const r = await makeToken(w, body);
  expect(r.status, r.text).toBe(201);
  logout();
  return r.json!["token"] as string;
}
let n = 0;
const rpc = (token: string, body: unknown) => call(mcpRoute.POST, { url: "http://localhost/mcp", body, headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" } });
async function tool(token: string, name: string, args: Record<string, unknown>) {
  const res = await rpc(token, { jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } });
  expect(res.status, res.text).toBe(200);
  const result = (res.json as { result: { isError: boolean; content: { text: string }[] } }).result;
  const text = result.content[0]!.text;
  return { isError: result.isError, text, value: result.isError ? null : (JSON.parse(text) as Record<string, unknown>) };
}
const ping = async (token: string) => (await rpc(token, { jsonrpc: "2.0", id: ++n, method: "ping" })).status;
const newTask = (w: World, title: string) => ({ projectId: w.project.id, boardId: w.board.id, columnId: w.todo.id, title });

describe("a token that acts as the agent", () => {
  it("Claude's task, comment and message are Claude's, not the owner's, even before the account ever signed in", async () => {
    const w = await world();
    const claude = await agentIn(w);
    const token = await mint(w, { actsAsId: claude });
    const made = await tool(token, "create_task", newTask(w, "من كلود"));
    expect(made.isError, made.text).toBe(false);
    const taskId = made.value!["id"] as string;
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).creatorId).toBe(claude);
    const commented = await tool(token, "comment_task", { taskId, body: "خلصت" });
    expect(commented.isError, commented.text).toBe(false);
    expect((await db.taskComment.findFirstOrThrow({ where: { taskId } })).authorId).toBe(claude);
    const topic = await db.conversation.create({ data: { orgId: w.orgId, kind: "TOPIC", spaceId: w.space.id, title: "عام" } });
    const posted = await tool(token, "post_message", { conversationId: topic.id, body: "صباح الخير" });
    expect(posted.isError, posted.text).toBe(false);
    expect((await db.chatMessage.findFirstOrThrow({ where: { conversationId: topic.id, body: "صباح الخير" } })).authorId).toBe(claude);
    const audits = await db.auditLog.findMany({ where: { orgId: w.orgId, action: "mcp.tool" } });
    expect(new Set(audits.map((a) => a.actorId))).toEqual(new Set([claude]));
  });

  it("a plain system token of the door writes in the agent's name too", async () => {
    const w = await world();
    const claude = await agentIn(w);
    const token = await mint(w, { system: "mediabuyer", actsAsId: claude });
    const res = await call(v1TasksRoute.POST, { url: "http://localhost/api/v1/tasks", method: "POST", headers: { authorization: `Bearer ${token}`, "idempotency-key": `k-${uid()}-abc` }, body: { title: "من الباب", boardId: w.board.id } });
    expect(res.status, res.text).toBe(201);
    expect((await db.task.findFirstOrThrow({ where: { orgId: w.orgId, title: "من الباب" } })).creatorId).toBe(claude);
  });

  it("a token made with nobody named is its maker's, as before", async () => {
    const w = await world();
    await agentIn(w);
    const token = await mint(w);
    const made = await tool(token, "create_task", newTask(w, "متل قبل"));
    expect((await db.task.findUniqueOrThrow({ where: { id: made.value!["id"] as string } })).creatorId).toBe(w.owner.id);
  });

  it("only an agent account of that space can be named, and only by the owner; no token is made otherwise", async () => {
    const w = await world();
    const claude = await agentIn(w);
    const outside = await agentIn(w, { name: "برا", workspaceIds: [w.other.id] });
    await loginAs(w.owner.id);
    expect((await makeToken(w, { actsAsId: w.member.id })).status, "a real person").toBe(403);
    expect((await makeToken(w, { actsAsId: w.owner.id })).status, "even oneself by name").toBe(403);
    expect((await makeToken(w, { actsAsId: outside })).status, "an agent of another space").toBe(403);
    expect((await makeToken(w, { actsAsId: "nobody" })).status).toBe(403);
    await loginAs(w.admin.id);
    const byAdmin = await call(apiTokensRoute.POST, { body: { name: "توكن", permissions: ["tasks.read"], workspaceId: w.space.id, actsAsId: claude } });
    expect(byAdmin.status, "an admin").toBe(403);
    expect(await db.apiToken.count({ where: { organizationId: w.orgId } })).toBe(0);
  });

  it("it holds to the agent's own rights: a box taken from the agent is taken from the token", async () => {
    const w = await world();
    const claude = await agentIn(w);
    const token = await mint(w, { actsAsId: claude });
    await db.organizationMember.updateMany({ where: { organizationId: w.orgId, userId: claude }, data: { revokedCapabilities: ["tasks.edit"] } });
    expect((await tool(token, "create_task", newTask(w, "ممنوعة"))).isError).toBe(true);
    expect(await db.task.count({ where: { orgId: w.orgId, title: "ممنوعة" } })).toBe(0);
  });

  it("dies with either of the two: the agent taken out of the space, the agent suspended, the maker suspended", async () => {
    const w = await world();
    const claude = await agentIn(w);
    const first = await mint(w, { actsAsId: claude });
    expect(await ping(first)).toBe(200);
    await db.workspaceMember.deleteMany({ where: { userId: claude } });
    expect(await ping(first), "out of the space").toBe(401);
    await db.workspaceMember.create({ data: { workspaceId: w.space.id, userId: claude } });
    expect(await ping(first)).toBe(200);

    const actor = { userId: w.owner.id, orgId: w.orgId, role: "OWNER" as const, isOwner: true, isPrimaryOwner: true, isExternal: false, caps: effectiveCapabilities({ role: "OWNER", primaryOwner: true }) };
    await setAccountStatus(actor, claude, { action: "suspend" });
    failureLimiter.reset("unknown");
    expect(await ping(first), "suspended").toBe(401);
    expect((await db.apiToken.findFirstOrThrow({ where: { organizationId: w.orgId } })).revokedReason).toBe("person_suspended");
    await setAccountStatus(actor, claude, { action: "reactivate" });
    failureLimiter.reset("unknown");
    expect(await ping(first), "a dead token stays dead").toBe(401);

    const second = await mint(w, { actsAsId: claude });
    await db.organizationMember.updateMany({ where: { organizationId: w.orgId, userId: w.owner.id }, data: { status: "SUSPENDED" } });
    failureLimiter.reset("unknown");
    expect(await ping(second), "the maker suspended").toBe(401);
  });

  it("the owner's screen is told who it acts as, and which agents may be chosen in which space", async () => {
    const w = await world();
    // as Claude will be: limited to the one space (an agent that is not limited is in «الشركة» too, like any member)
    const claude = await agentIn(w, { spaceOnly: true });
    await loginAs(w.owner.id);
    await makeToken(w, { actsAsId: claude });
    const list = await call(systemTokensRoute.GET, { url: "http://localhost/api/system-tokens" });
    const body = list.json as { tokens: { actsAs: { id: string; name: string } | null }[]; agents: { id: string; name: string; spaceIds: string[] }[] };
    expect(body.tokens.map((t) => t.actsAs)).toEqual([{ id: claude, name: "Claude 🤖" }]);
    expect(body.agents).toEqual([{ id: claude, name: "Claude 🤖", spaceIds: [w.space.id] }]);
  });
});
