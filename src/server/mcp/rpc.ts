import { ZodError } from "zod";
import { log } from "@/server/log";
import { MCP_TOOL_DEFS, type McpScope, type McpToolDef } from "./defs";

/**
 * «خادم MCP»: JSON-RPC 2.0 for the Model Context Protocol over Streamable HTTP, STATELESS (no session, no stream: `GET` is 405). Pure apart from what the host hands in:
 * the tools (with their `run`), who the call is for, and one `audit` hook. The route (src/app/mcp/route.ts) authenticates the token and builds the host.
 *
 *   initialize / ping / notifications/*   the handshake
 *   tools/list                              only the tools whose scope the token holds
 *   tools/call                              the arguments are checked, the tool runs inside the token's person (never wider), ONE audit row is written
 *
 * A failure INSIDE a tool (bad arguments, a rule of the app, a missing thing) is a normal result with `isError: true` that the model can read and react to; only a
 * request that is not JSON-RPC, an unknown method or an unknown tool is a protocol error. No stack and no internal message ever leaves.
 */
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export interface McpContext {
  orgId: string;
  /** The person the token acts for. */
  userId: string;
  tokenId: string;
  permissions: readonly string[];
  requestId: string;
}

export interface McpTool extends McpToolDef {
  run: (ctx: McpContext, args: never) => Promise<unknown>;
}

export interface McpHost {
  tools: readonly McpTool[];
  ctx: McpContext;
  /** One row per call, after it ran: which tool, and whether it worked. */
  audit: (tool: string, ok: boolean) => Promise<void>;
}

/** A refusal or a failure a tool wants the model to read: a stable `code` and a short message. */
export class McpToolError extends Error {
  constructor(
    readonly code: string,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code);
    this.name = "McpToolError";
  }
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

const fail = (id: RpcResponse["id"], code: number, message: string, data?: unknown): RpcResponse => ({ jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } });
const ok = (id: RpcResponse["id"], result: Record<string, unknown>): RpcResponse => ({ jsonrpc: "2.0", id, result });

const CODE_LIKE = /^[a-z0-9_.-]{1,60}$/;

function scopeHeld(ctx: McpContext, scope: McpScope): boolean {
  return ctx.permissions.includes(scope);
}

function toolText(isError: boolean, value: unknown): Record<string, unknown> {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return { content: [{ type: "text", text }], isError };
}

/** What the model may read about a failure: the codes of the app's own rules, the names of the bad fields, never an internal message or a stack. */
function describeFailure(err: unknown, tool: string, requestId: string): string {
  if (err instanceof McpToolError) return `Error ${err.code}${err.message !== err.code ? `: ${err.message}` : ""}${err.details !== undefined ? ` ${JSON.stringify(err.details)}` : ""}`;
  if (err instanceof ZodError) return `Invalid arguments: ${err.issues.map((i) => `${i.path.join(".") || "(arguments)"}: ${i.message}`).join("; ")}`;
  const name = typeof err === "object" && err !== null ? String((err as { name?: unknown }).name) : "";
  const message = err instanceof Error ? err.message : "";
  if (name === "NotFoundError") return "Error not_found: no such item for this token's person.";
  if (name === "ForbiddenError") return `Error forbidden${CODE_LIKE.test(message) ? `: ${message}` : ""}: this token's person may not do this.`;
  if (name === "ValidationError") return "Error validation_failed: the values are not acceptable.";
  if (name === "UnauthorizedError") return "Error unauthorized: the token's person can no longer act.";
  log.error("mcp.tool_failed", { tool, requestId, name });
  return "Error internal: something went wrong on our side.";
}

async function callTool(params: unknown, host: McpHost): Promise<{ result?: Record<string, unknown>; protocolError?: { code: number; message: string } }> {
  const p = typeof params === "object" && params !== null ? (params as { name?: unknown; arguments?: unknown }) : {};
  const tool = host.tools.find((t) => t.name === p.name);
  if (typeof p.name !== "string" || !tool) return { protocolError: { code: -32602, message: `Unknown tool: ${typeof p.name === "string" ? p.name.slice(0, 80) : "(none)"}` } };
  if (!scopeHeld(host.ctx, tool.scope)) {
    await host.audit(tool.name, false);
    return { result: toolText(true, `Error forbidden: this token does not hold the scope ${tool.scope}.`) };
  }
  let success = false;
  try {
    const args = tool.schema.parse(p.arguments ?? {});
    const value = await tool.run(host.ctx, args as never);
    success = true;
    return { result: toolText(false, value) };
  } catch (err) {
    return { result: toolText(true, describeFailure(err, tool.name, host.ctx.requestId)) };
  } finally {
    await host.audit(tool.name, success).catch((e: unknown) => log.warn("mcp.audit_failed", { tool: tool.name, name: e instanceof Error ? e.name : "?" }));
  }
}

async function handleOne(message: unknown, host: McpHost): Promise<RpcResponse | null> {
  if (typeof message !== "object" || message === null || Array.isArray(message)) return fail(null, -32600, "Invalid Request");
  const m = message as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: unknown };
  const hasId = typeof m.id === "string" || typeof m.id === "number";
  // a response from the client (we ask it nothing): nothing to answer
  if (m.method === undefined && (m.result !== undefined || m.error !== undefined)) return null;
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") return fail(hasId ? (m.id as string | number) : null, -32600, "Invalid Request");
  // a notification: no id, no answer
  if (!hasId) return null;
  const id = m.id as string | number;

  switch (m.method) {
    case "initialize": {
      const asked = typeof m.params === "object" && m.params !== null ? (m.params as { protocolVersion?: unknown }).protocolVersion : undefined;
      const version = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(String(asked)) ? String(asked) : MCP_PROTOCOL_VERSIONS[0];
      return ok(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "zaki-workspace", version: "1.0.0" },
        instructions: "Zaki Workspace: tasks and chat, acting as the person this token belongs to. Every rule of the app applies.",
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: host.tools.filter((t) => scopeHeld(host.ctx, t.scope)).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
      });
    case "tools/call": {
      const out = await callTool(m.params, host);
      return out.protocolError ? fail(id, out.protocolError.code, out.protocolError.message) : ok(id, out.result ?? {});
    }
    default:
      return fail(id, -32601, `Method not found: ${m.method.slice(0, 80)}`);
  }
}

/** One JSON-RPC message or a batch. `null`: nothing to send back (only notifications) — the route answers 202. */
export async function handleBody(body: unknown, host: McpHost): Promise<RpcResponse | RpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return fail(null, -32600, "Invalid Request");
    const answers: RpcResponse[] = [];
    for (const message of body) {
      const answer = await handleOne(message, host);
      if (answer) answers.push(answer);
    }
    return answers.length ? answers : null;
  }
  return handleOne(body, host);
}

export { MCP_TOOL_DEFS };
