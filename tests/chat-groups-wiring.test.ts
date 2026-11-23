import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * «مجموعات المواضيع»: the routes of `/api/groups` and `/api/topics` are MACHINE paths for the middleware (a system token has no cookie), so the cross-site write check the
 * middleware does for other API paths must be done by the route itself. Every exported handler under those two folders goes through `structureRoute`, and nothing else is added there.
 */
const ROOT = path.resolve(__dirname, "..");

function routes(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) routes(full, out);
    else if (name === "route.ts") out.push(full);
  }
  return out;
}

describe("the machine paths of the chat structure", () => {
  const files = [...routes(path.join(ROOT, "src/app/api/groups")), ...routes(path.join(ROOT, "src/app/api/topics"))];

  it("exist and every exported handler is wrapped in structureRoute", () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const handlers = [...src.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g)];
      expect(handlers.length, file).toBeGreaterThan(0);
      for (const h of handlers) {
        const body = src.slice(src.indexOf(h[0]));
        const next = body.slice(h[0].length).search(/export async function /);
        const text = next === -1 ? body : body.slice(0, next + h[0].length);
        expect(text, `${path.relative(ROOT, file)} ${h[1]}`).toContain("structureRoute(req");
      }
    }
  });

  it("the middleware lists exactly these two folders beside the older machine paths", () => {
    const mw = readFileSync(path.join(ROOT, "src/middleware.ts"), "utf8");
    expect(mw).toMatch(/MACHINE_PATHS = \[[^\]]*"\/api\/groups", "\/api\/topics"\]/);
  });

  it("the gate does the cross-site check for a browser and asks the door for a token", () => {
    const gate = readFileSync(path.join(ROOT, "src/server/door/structure-auth.ts"), "utf8");
    expect(gate).toContain("originAllowed(");
    expect(gate).toContain('authenticateDoor(req, requestId, "chat.structure")');
  });

  it("the token scope is its own and v1 of the door never grows with it", () => {
    const tokens = readFileSync(path.join(ROOT, "src/server/door/tokens.ts"), "utf8");
    expect(tokens).toContain('DOOR_STRUCTURE_PERMISSIONS = ["chat.structure"]');
    expect(tokens).toMatch(/export const DOOR_PERMISSIONS = \["ideas.read", "ideas.write", "tasks.read", "tasks.write"\]/);
  });
});
