import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_DOOR_PERMISSIONS, DOOR_PERMISSIONS, isDoorPermission } from "@/server/door/tokens";
import { DOOR_SYSTEMS, doorSystem } from "@/lib/door/systems";
import { AR } from "@/lib/i18n/dict";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

describe("the MCP server is wired to what exists", () => {
  it("the route is /mcp: POST answers JSON-RPC, GET and DELETE answer 405 (stateless: no stream, no session)", () => {
    const route = read("src/app/mcp/route.ts");
    expect(route).toContain("export async function POST");
    expect(route).toContain("export async function GET");
    expect(route).toContain("export async function DELETE");
    expect(route).toContain("405");
    expect(route).toContain("authenticateDoor");
    expect(route).toContain("handleBody");
  });

  it("the middleware lets /mcp through as a machine path (a bearer token, no session cookie)", () => {
    expect(read("src/middleware.ts")).toMatch(/MACHINE_PATHS = \[[^\]]*"\/mcp"/);
  });

  it("the two scopes exist as door permissions, and v1's own list did not grow", () => {
    expect(ALL_DOOR_PERMISSIONS).toContain("mcp.tasks");
    expect(ALL_DOOR_PERMISSIONS).toContain("mcp.chat");
    expect(isDoorPermission("mcp.tasks")).toBe(true);
    expect([...DOOR_PERMISSIONS]).toEqual(["ideas.read", "ideas.write", "tasks.read", "tasks.write"]);
  });

  it("«توكنات الأنظمة» offers the system «Claude (MCP)» with exactly the two scopes, and the page has its words", () => {
    const s = doorSystem("claude-mcp");
    expect(s?.name).toBe("Claude (MCP)");
    expect([...(s?.permissions ?? [])].sort()).toEqual(["mcp.chat", "mcp.tasks"]);
    expect(DOOR_SYSTEMS.map((x) => x.key)).toContain("mediabuyer");
    expect(AR["systok.system.claude-mcp"]).toBe("Claude (MCP)");
    expect(AR["systok.perm.mcp.tasks"]).toBeTruthy();
    expect(AR["systok.perm.mcp.chat"]).toBeTruthy();
    expect(AR["door.perm.mcp.tasks"]).toBeTruthy();
    expect(AR["door.perm.mcp.chat"]).toBeTruthy();
  });

  it("the rate limit is the door's 60 a minute per token, and nothing is read from the server's environment", () => {
    expect(read("src/server/door/limits.ts")).toContain("perToken: { limit: 60, windowMs: 60_000 }");
    expect(read("src/app/mcp/route.ts")).not.toContain("process.env");
  });

  it("the contract is written, with the curl calls and the steps in Arabic", () => {
    const doc = read("docs/contracts/mcp.md");
    for (const needle of ["initialize", "tools/list", "tools/call", "Authorization: Bearer", "توكنات الأنظمة", "https://workspace.zakiai.io/mcp"]) expect(doc, needle).toContain(needle);
  });
});
