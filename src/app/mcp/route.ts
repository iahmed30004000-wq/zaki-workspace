import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { runAsUser } from "@/server/acting-as";
import { authenticateDoor } from "@/server/services/api-door";
import { DoorError, doorErrorResponse, doorRoute } from "@/server/door/http";
import { BodyTooLargeError, readTextLimited } from "@/server/http/body-limit";
import { handleBody, type McpContext, type McpHost } from "@/server/mcp/rpc";
import { MCP_TOOLS } from "@/server/mcp/tools";

/**
 * «خادم MCP» — https://workspace.zakiai.io/mcp (docs/contracts/mcp.md). Model Context Protocol, Streamable HTTP, JSON-RPC 2.0, STATELESS: every POST is whole in itself.
 *
 *  - the token is the door's («توكنات الأنظمة» ← «Claude (MCP)», scopes `mcp.tasks` / `mcp.chat`): the same front gate as /api/v1 (shape, constant-time hash, revoked / expired /
 *    person no longer allowed, the company's switch «باب الربط», 60 calls a minute per token);
 *  - the tools run the app's own routes inside the token's person (src/server/mcp/tools.ts): nothing here widens a right;
 *  - one audit row per call: «via Claude MCP».
 * Nothing is configured outside the settings screen: no environment variable is read here.
 */
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;

const rpcError = (status: number, code: number, message: string, requestId: string) =>
  NextResponse.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status, headers: { "x-request-id": requestId, "cache-control": "no-store" } });

export async function POST(req: Request): Promise<NextResponse> {
  return doorRoute(async (requestId) => {
    // the gate first: a request without a good token learns nothing about the protocol
    const who = await authenticateDoor(req, requestId, null);
    if (!who.permissions.some((p) => p === "mcp.tasks" || p === "mcp.chat")) {
      throw new DoorError(403, "door.forbidden", "This token holds no MCP scope (mcp.tasks or mcp.chat).");
    }

    let raw: string;
    try {
      raw = await readTextLimited(req, MAX_BODY_BYTES);
    } catch (err) {
      if (err instanceof BodyTooLargeError) return rpcError(413, -32600, `The body is larger than ${MAX_BODY_BYTES} bytes.`, requestId);
      return rpcError(400, -32700, "The body could not be read.", requestId);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return rpcError(400, -32700, "Parse error", requestId);
    }

    const ctx: McpContext = { orgId: who.orgId, userId: who.issuerId, tokenId: who.tokenId, permissions: who.permissions, requestId };
    const host: McpHost = {
      tools: MCP_TOOLS,
      ctx,
      audit: async (tool, success) => {
        await db.auditLog.create({
          data: { action: "mcp.tool", actorId: who.issuerId, orgId: who.orgId, target: who.tokenId, workspaceId: who.workspaceId, meta: { tool, ok: success, via: "Claude MCP", tokenName: who.tokenName, requestId } },
        });
      },
    };
    const answer = await runAsUser(who.issuerId, () => handleBody(body, host));
    if (answer === null) return new NextResponse(null, { status: 202, headers: { "x-request-id": requestId } });
    return NextResponse.json(answer, { headers: { "x-request-id": requestId, "cache-control": "no-store" } });
  });
}

/** Stateless: no stream to open, no session to end. */
function notAllowed(): NextResponse {
  return doorErrorResponse(new DoorError(405, "mcp.method_not_allowed", "This server answers POST only (stateless).", undefined, { allow: "POST" }), "none");
}

export async function GET(): Promise<NextResponse> {
  return notAllowed();
}

export async function DELETE(): Promise<NextResponse> {
  return notAllowed();
}
