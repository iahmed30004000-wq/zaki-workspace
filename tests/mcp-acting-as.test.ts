import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * «يشتغل باسم» (src/server/acting-as.ts) lends a person's identity to the routes for ONE call. It is dangerous in the wrong hands, so exactly these files may touch it:
 * the module itself, `currentUser` (which reads it), and the route of /mcp (which sets it, after the token passed the door).
 */
const ROOT = path.resolve(__dirname, "..");
const ALLOWED = new Set(["src/server/acting-as.ts", "src/server/auth.ts", "src/app/mcp/route.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("nobody borrows an identity but the MCP route", () => {
  it("only the allowed files mention acting-as", () => {
    const users = walk(path.join(ROOT, "src"))
      .filter((f) => /acting-as/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f).replace(/\\/g, "/"))
      .filter((f) => !ALLOWED.has(f));
    expect(users).toEqual([]);
  });

  it("the route sets it only AFTER the door, and only for the token's person", () => {
    const route = readFileSync(path.join(ROOT, "src/app/mcp/route.ts"), "utf8");
    expect(route.indexOf("authenticateDoor")).toBeGreaterThan(-1);
    expect(route.indexOf("runAsUser(")).toBeGreaterThan(route.indexOf("authenticateDoor"));
    expect(route).toContain("runAsUser(who.issuerId");
  });

  it("an ordinary request never sees it: with nobody acting, currentUser reads the cookie", () => {
    const auth = readFileSync(path.join(ROOT, "src/server/auth.ts"), "utf8");
    expect(auth).toContain("const acting = actingUserId();");
    expect(auth).toContain(": await getSessionUser()");
  });
});
