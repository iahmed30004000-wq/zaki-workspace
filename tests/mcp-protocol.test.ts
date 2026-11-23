import { describe, expect, it, vi } from "vitest";
import { MCP_TOOL_DEFS, scopeOfTool } from "@/server/mcp/defs";
import { handleBody, type McpHost, type McpTool } from "@/server/mcp/rpc";

/**
 * «خادم MCP» (docs/contracts/mcp.md): JSON-RPC 2.0 over Streamable HTTP, stateless. This file is the protocol itself, without a database: the answers to
 * initialize, ping and tools/list, the errors, the scopes of the token and the audit row of each call.
 */

const ALL = ["mcp.tasks", "mcp.chat"];
const tool = (name: string, run: McpTool["run"]): McpTool => {
  const def = MCP_TOOL_DEFS.find((d) => d.name === name);
  if (!def) throw new Error(`no tool ${name}`);
  return { ...def, run };
};
const host = (over: Partial<McpHost> = {}, runs: Record<string, McpTool["run"]> = {}): McpHost => ({
  tools: MCP_TOOL_DEFS.map((d) => tool(d.name, runs[d.name] ?? (async () => ({ ok: true })))),
  ctx: { orgId: "o1", userId: "u1", tokenId: "t1", permissions: ALL, requestId: "r1" },
  audit: async () => {},
  ...over,
});
const rpc = (method: string, params?: unknown, id: number | string | null = 1) => ({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
const one = async (body: unknown, h = host()) => (await handleBody(body, h)) as { jsonrpc: string; id: unknown; result?: Record<string, unknown>; error?: { code: number; message: string } };

describe("initialize, ping and the notification", () => {
  it("initialize answers the client's protocol version when it is one we speak, with tools and no more", async () => {
    const res = await one(rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "claude", version: "1" } }));
    expect(res.jsonrpc).toBe("2.0");
    expect(res.id).toBe(1);
    expect(res.result?.["protocolVersion"]).toBe("2025-03-26");
    expect(res.result?.["capabilities"]).toEqual({ tools: { listChanged: false } });
    expect((res.result?.["serverInfo"] as { name: string }).name).toBe("zaki-workspace");
  });

  it("a protocol version we do not know gets the newest one we speak", async () => {
    const res = await one(rpc("initialize", { protocolVersion: "1999-01-01" }));
    expect(res.result?.["protocolVersion"]).toBe("2025-06-18");
  });

  it("ping answers an empty result; the «initialized» notification answers nothing (the route sends 202)", async () => {
    expect((await one(rpc("ping"))).result).toEqual({});
    expect(await handleBody({ jsonrpc: "2.0", method: "notifications/initialized" }, host())).toBeNull();
  });
});

describe("tools/list: the eight tools of the contract", () => {
  it("lists exactly the eight, in the contract's order, each with a description and an object schema", async () => {
    const res = await one(rpc("tools/list"));
    const tools = res.result?.["tools"] as { name: string; description: string; inputSchema: { type: string; properties: object; required?: string[] } }[];
    expect(tools.map((t) => t.name)).toEqual(["list_tasks", "create_task", "move_task", "comment_task", "update_task", "post_message", "list_conversations", "get_board"]);
    for (const t of tools) {
      expect(t.description.length, t.name).toBeGreaterThan(10);
      expect(t.inputSchema.type, t.name).toBe("object");
    }
  });

  it("the required fields are the contract's", async () => {
    const tools = (await one(rpc("tools/list"))).result?.["tools"] as { name: string; inputSchema: { required?: string[] } }[];
    const required = Object.fromEntries(tools.map((t) => [t.name, [...(t.inputSchema.required ?? [])].sort()]));
    expect(required).toEqual({
      list_tasks: [],
      create_task: ["boardId", "columnId", "projectId", "title"],
      move_task: ["columnId", "taskId"],
      comment_task: ["body", "taskId"],
      update_task: ["taskId"],
      post_message: ["body", "conversationId"],
      list_conversations: ["workspaceId"],
      get_board: ["boardId"],
    });
  });

  it("the task tools need «mcp.tasks» and the two chat tools «mcp.chat»", () => {
    for (const n of ["list_tasks", "create_task", "move_task", "comment_task", "update_task", "get_board"]) expect(scopeOfTool(n), n).toBe("mcp.tasks");
    for (const n of ["post_message", "list_conversations"]) expect(scopeOfTool(n), n).toBe("mcp.chat");
    expect(scopeOfTool("nope")).toBeNull();
  });

  it("a token with only «mcp.chat» sees only the chat tools in the list", async () => {
    const h = host({ ctx: { orgId: "o", userId: "u", tokenId: "t", permissions: ["mcp.chat"], requestId: "r" } });
    const names = ((await one(rpc("tools/list"), h)).result?.["tools"] as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(["post_message", "list_conversations"]);
  });
});

describe("tools/call", () => {
  it("runs the tool with its checked arguments, answers its result as text, and writes ONE audit row «via Claude MCP»", async () => {
    const run = vi.fn(async () => ({ id: "t1", title: "مهمة جديدة" }));
    const audit = vi.fn(async () => {});
    const res = await one(rpc("tools/call", { name: "comment_task", arguments: { taskId: "a1", body: "تمّ التسليم" } }), host({ audit }, { comment_task: run }));
    expect(run).toHaveBeenCalledTimes(1);
    expect((run.mock.calls[0] as unknown[])[1]).toEqual({ taskId: "a1", body: "تمّ التسليم" });
    expect(res.result?.["isError"]).toBe(false);
    const text = (res.result?.["content"] as { type: string; text: string }[])[0]!;
    expect(text.type).toBe("text");
    // Arabic goes through as it is: no \u escapes
    expect(text.text).toContain("مهمة جديدة");
    expect(text.text).not.toContain("\\u0645");
    expect(audit).toHaveBeenCalledWith("comment_task", true);
  });

  it("bad arguments are a tool error the model can read (not a protocol error), the tool never runs, and the call is still audited as failed", async () => {
    const run = vi.fn(async () => ({}));
    const audit = vi.fn(async () => {});
    const res = await one(rpc("tools/call", { name: "move_task", arguments: { taskId: "a1" } }), host({ audit }, { move_task: run }));
    expect(run).not.toHaveBeenCalled();
    expect(res.error).toBeUndefined();
    expect(res.result?.["isError"]).toBe(true);
    expect(JSON.stringify(res.result)).toContain("columnId");
    expect(audit).toHaveBeenCalledWith("move_task", false);
  });

  it("a tool outside the token's scopes is refused as a tool error, and never runs", async () => {
    const run = vi.fn(async () => ({}));
    const h = host({ ctx: { orgId: "o", userId: "u", tokenId: "t", permissions: ["mcp.tasks"], requestId: "r" } }, { post_message: run });
    const res = await one(rpc("tools/call", { name: "post_message", arguments: { conversationId: "c", body: "x" } }), h);
    expect(run).not.toHaveBeenCalled();
    expect(res.result?.["isError"]).toBe(true);
    expect(JSON.stringify(res.result)).toContain("mcp.chat");
  });

  it("a rule of the app speaking inside the tool (forbidden, not found) is a tool error with its code, never a stack", async () => {
    const res = await one(
      rpc("tools/call", { name: "get_board", arguments: { boardId: "b" } }),
      host({}, {
        get_board: async () => {
          throw Object.assign(new Error("secret internals"), { name: "NotFoundError" });
        },
      }),
    );
    expect(res.result?.["isError"]).toBe(true);
    expect(JSON.stringify(res.result)).not.toContain("secret internals");
    expect(JSON.stringify(res.result)).not.toContain("at ");
  });

  it("an unknown tool is an invalid-params protocol error (-32602)", async () => {
    const res = await one(rpc("tools/call", { name: "drop_database", arguments: {} }));
    expect(res.error?.code).toBe(-32602);
  });
});

describe("the envelope", () => {
  it("an unknown method is -32601, a body that is not a JSON-RPC request is -32600, and the id comes back as it was", async () => {
    const unknown = await one(rpc("resources/list", undefined, "abc"));
    expect(unknown.error?.code).toBe(-32601);
    expect(unknown.id).toBe("abc");
    const bad = await one({ hello: "world" });
    expect(bad.error?.code).toBe(-32600);
  });

  it("a batch is answered as a batch, and notifications in it add no answer", async () => {
    const out = (await handleBody([rpc("ping", undefined, 1), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc("ping", undefined, 2)], host())) as { id: number }[];
    expect(out.map((r) => r.id)).toEqual([1, 2]);
  });

  it("an empty batch is an invalid request", async () => {
    const res = (await handleBody([], host())) as { error?: { code: number } };
    expect(res.error?.code).toBe(-32600);
  });
});
