import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import * as mcpRoute from "@/app/mcp/route";
import * as systemTokensRoute from "@/app/api/system-tokens/route";
import * as systemTokenRoute from "@/app/api/system-tokens/[id]/route";
import { withFeature } from "@/lib/features";
import { failureLimiter, tokenLimiter } from "@/server/door/limits";
import { createTopic } from "@/server/chat/topics";
import { call, db, loginAs, logout, makeProject, makeTeam, makeWorkspace } from "./helpers";

/**
 * «خادم MCP» (docs/contracts/mcp.md) against a real PostgreSQL, through the real route handler: the token is made the way the owner makes it («توكنات الأنظمة» ←
 * «Claude (MCP)»), and every tool runs the app's own routes inside the token's person.
 */

const URL_MCP = "http://localhost/mcp";

beforeEach(() => failureLimiter.reset("unknown"));

async function setFeature(orgId: string, on: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { settings: true } });
  await db.organization.update({ where: { id: orgId }, data: { settings: withFeature(org.settings, "apiDoor", on) as Prisma.InputJsonValue } });
}

async function world() {
  const team = await makeTeam();
  const space = await makeWorkspace(team.org.id, [{ userId: team.admin.id, role: "ADMIN" }, { userId: team.member.id }], "الإعلانات");
  const board = await makeProject(space.id);
  await setFeature(team.org.id, true);
  return { ...team, space, ...board };
}
type World = Awaited<ReturnType<typeof world>>;

async function mint(w: World) {
  await loginAs(w.owner.id);
  const r = await call(systemTokensRoute.POST, { url: "http://localhost/api/system-tokens", body: { system: "claude-mcp", workspaceId: w.space.id } });
  expect(r.status, r.text).toBe(201);
  logout();
  return { token: r.json!["token"] as string, id: (r.json!["item"] as { id: string }).id, item: r.json!["item"] as { permissions: string[]; system: string } };
}

const rpc = (token: string | null, body: unknown) =>
  call(mcpRoute.POST, { url: URL_MCP, body, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), accept: "application/json, text/event-stream" } });

let n = 0;
async function tool(token: string, name: string, args: Record<string, unknown>) {
  const res = await rpc(token, { jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } });
  expect(res.status, res.text).toBe(200);
  const result = (res.json as { result: { isError: boolean; content: { text: string }[] } }).result;
  const text = result.content[0]!.text;
  return { isError: result.isError, text, value: result.isError ? null : (JSON.parse(text) as Record<string, any>) };
}

describe("the token and the gate", () => {
  it("the system «Claude (MCP)» makes a token with exactly mcp.tasks and mcp.chat", async () => {
    const w = await world();
    const { item } = await mint(w);
    expect(item.system).toBe("claude-mcp");
    expect([...item.permissions].sort()).toEqual(["mcp.chat", "mcp.tasks"]);
  });

  it("no token, a wrong token and a token of the wrong shape are 401; GET and DELETE are 405", async () => {
    const w = await world();
    await mint(w);
    expect((await rpc(null, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(401);
    failureLimiter.reset("unknown");
    expect((await rpc("zws_000000000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(401);
    expect((await call(mcpRoute.GET, { url: URL_MCP, method: "GET" })).status).toBe(405);
    expect((await call(mcpRoute.DELETE, { url: URL_MCP, method: "DELETE" })).status).toBe(405);
  });

  it("with the company's switch «باب الربط» OFF the server is 404 for everybody", async () => {
    const w = await world();
    const { token } = await mint(w);
    await setFeature(w.org.id, false);
    expect((await rpc(token, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(404);
  });

  it("a revoked token is 401 at once", async () => {
    const w = await world();
    const { token, id } = await mint(w);
    expect((await rpc(token, { jsonrpc: "2.0", id: 1, method: "ping" })).status).toBe(200);
    await loginAs(w.owner.id);
    const revoked = await call(systemTokenRoute.DELETE, { url: `http://localhost/api/system-tokens/${id}`, method: "DELETE", params: { id } });
    expect(revoked.status, revoked.text).toBe(200);
    logout();
    expect((await rpc(token, { jsonrpc: "2.0", id: 2, method: "ping" })).status).toBe(401);
  });

  it("60 calls a minute per token: the 61st is 429", async () => {
    const w = await world();
    const { token, id } = await mint(w);
    tokenLimiter.reset(`t:${id}`);
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await rpc(token, { jsonrpc: "2.0", id: i, method: "ping" })).status;
    expect(last).toBe(429);
  });
});

describe("initialize and tools/list", () => {
  it("the handshake answers, and the list holds the eight tools", async () => {
    const w = await world();
    const { token } = await mint(w);
    const init = await rpc(token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(init.status).toBe(200);
    expect((init.json as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe("zaki-workspace");
    const note = await rpc(token, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(note.status).toBe(202);
    const list = await rpc(token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = (list.json as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
    expect(names).toHaveLength(8);
    expect(names).toEqual(["list_tasks", "create_task", "move_task", "comment_task", "update_task", "post_message", "list_conversations", "get_board"]);
  });
});

describe("the task tools run the app's own routes as the token's person", () => {
  it("create → list → comment → update → move → get_board, Arabic kept as it is, everything attributed to the owner and audited «via Claude MCP»", async () => {
    const w = await world();
    const { token } = await mint(w);

    const made = await tool(token, "create_task", { projectId: w.project.id, boardId: w.board.id, columnId: w.todo.id, title: "تشغيل المهمة المجدولة", description: "وصف عربي", dueDate: "2026-12-01" });
    expect(made.isError, made.text).toBe(false);
    const taskId = made.value!["id"] as string;
    const row = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(row.title).toBe("تشغيل المهمة المجدولة");
    expect(row.description).toBe("وصف عربي");
    expect(row.creatorId).toBe(w.owner.id);
    expect(row.columnId).toBe(w.todo.id);

    const listed = await tool(token, "list_tasks", { boardId: w.board.id, query: "المجدولة" });
    const tasks = listed.value!["tasks"] as { id: string; title: string; column: { id: string; name: string } }[];
    expect(tasks.map((t) => t.id)).toEqual([taskId]);
    expect(tasks[0]!.column).toEqual({ id: w.todo.id, name: "todo" });
    expect(listed.text).toContain("تشغيل المهمة المجدولة");

    const commented = await tool(token, "comment_task", { taskId, body: "تمّ التشغيل بنجاح" });
    expect(commented.isError, commented.text).toBe(false);
    const comment = await db.taskComment.findFirstOrThrow({ where: { taskId } });
    expect(comment.body).toBe("تمّ التشغيل بنجاح");
    expect(comment.authorId).toBe(w.owner.id);

    const updated = await tool(token, "update_task", { taskId, title: "عنوان جديد", assigneeId: w.member.id });
    expect(updated.isError, updated.text).toBe(false);
    const after = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    expect(after.title).toBe("عنوان جديد");
    expect(after.assigneeId).toBe(w.member.id);

    const moved = await tool(token, "move_task", { taskId, columnId: w.done.id });
    expect(moved.isError, moved.text).toBe(false);
    expect((await db.task.findUniqueOrThrow({ where: { id: taskId } })).columnId).toBe(w.done.id);

    const board = await tool(token, "get_board", { boardId: w.board.id });
    const columns = board.value!["columns"] as { id: string; name: string; stage: string }[];
    expect(columns.map((c) => c.name)).toEqual(["todo", "done"]);
    for (const c of columns) expect(["TODO", "DOING", "REVIEW", "DONE"]).toContain(c.stage);

    const audits = await db.auditLog.findMany({ where: { orgId: w.org.id, action: "mcp.tool" }, orderBy: { createdAt: "asc" } });
    expect(audits.map((a) => (a.meta as { tool: string }).tool)).toEqual(["create_task", "list_tasks", "comment_task", "update_task", "move_task", "get_board"]);
    for (const a of audits) {
      expect(a.actorId).toBe(w.owner.id);
      expect((a.meta as { via: string; ok: boolean }).via).toBe("Claude MCP");
      expect((a.meta as { ok: boolean }).ok).toBe(true);
    }
    // the app's own audit row of the same creation is there too, under the same person
    expect(await db.auditLog.count({ where: { orgId: w.org.id, action: "task.created", target: taskId, actorId: w.owner.id } })).toBe(1);
  });

  it("a rule of the app speaking is a tool error, never a crash: a task that does not exist, a column of nowhere", async () => {
    const w = await world();
    const { token } = await mint(w);
    const missing = await tool(token, "comment_task", { taskId: "no-such-task", body: "x" });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain("not_found");
    const bad = await tool(token, "create_task", { projectId: w.project.id, boardId: w.board.id, columnId: "no-such-column", title: "x" });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("column.not_found");
    expect(await db.task.count({ where: { orgId: w.org.id } })).toBe(0);
    // the same board, the wrong project: refused too
    const other = await makeProject(w.space.id);
    const crossed = await tool(token, "create_task", { projectId: other.project.id, boardId: w.board.id, columnId: w.todo.id, title: "x" });
    expect(crossed.isError).toBe(true);
    const seed = await tool(token, "create_task", { projectId: w.project.id, boardId: w.board.id, columnId: w.todo.id, title: "للنقل" });
    const noMove = await tool(token, "move_task", { taskId: seed.value!["id"] as string, columnId: "no-such-column" });
    expect(noMove.isError).toBe(true);
    expect((await db.task.findUniqueOrThrow({ where: { id: seed.value!["id"] as string } })).columnId).toBe(w.todo.id);
  });

  it("the token is its person and no more: when the person is suspended the token is 401 at once, with nothing created", async () => {
    const w = await world();
    const { token } = await mint(w);
    expect((await tool(token, "create_task", { projectId: w.project.id, boardId: w.board.id, columnId: w.todo.id, title: "قبل الإيقاف" })).isError).toBe(false);
    await db.organizationMember.update({ where: { organizationId_userId: { organizationId: w.org.id, userId: w.owner.id } }, data: { status: "SUSPENDED" } });
    const res = await rpc(token, { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "create_task", arguments: { projectId: w.project.id, boardId: w.board.id, columnId: w.todo.id, title: "بعد الإيقاف" } } });
    expect(res.status).toBe(401);
    expect(await db.task.count({ where: { orgId: w.org.id, title: "بعد الإيقاف" } })).toBe(0);
  });
});

describe("the chat tools", () => {
  it("list_conversations names the topics of a space, and post_message posts as the owner where the owner may post", async () => {
    const w = await world();
    const { token } = await mint(w);
    const topic = await createTopic({ orgId: w.org.id, orgRole: "OWNER", userId: w.owner.id }, { spaceId: w.space.id, title: "تقارير" });

    const listed = await tool(token, "list_conversations", { workspaceId: w.space.id });
    expect(listed.isError, listed.text).toBe(false);
    const rows = listed.value!["conversations"] as { id: string; title: string; kind: string }[];
    expect(rows.map((r) => r.id)).toContain(topic.id);
    expect(rows.find((r) => r.id === topic.id)?.title).toBe("تقارير");

    const posted = await tool(token, "post_message", { conversationId: topic.id, body: "تمّ تشغيل المهمة المجدولة ✅" });
    expect(posted.isError, posted.text).toBe(false);
    const msg = await db.chatMessage.findFirstOrThrow({ where: { conversationId: topic.id, authorId: w.owner.id }, orderBy: { createdAt: "desc" } });
    expect(msg.body).toBe("تمّ تشغيل المهمة المجدولة ✅");
  });

  it("post_message in a conversation the person cannot post in is a tool error and nothing is written", async () => {
    const w = await world();
    const { token } = await mint(w);
    const res = await tool(token, "post_message", { conversationId: "no-such-conversation", body: "x" });
    expect(res.isError).toBe(true);
    expect(await db.chatMessage.count({ where: { body: "x" } })).toBe(0);
  });
});
