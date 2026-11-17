import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * P0.1 guard (docs/restructure/P0-privacy.md): silent oversight is the capability `archive.view` (`hasOversight` in
 * src/server/policy/conversation.ts), never the OWNER rank. So no chat code decides a READ by comparing the rank:
 * `role === "OWNER"`, `orgRole === "OWNER"` and `isOwnerOf(` are refused in src/server/chat/** and in the conversation
 * policy, unless the line says why it is not a reading decision with `// oversight-ok: <reason>`.
 */
const ROOT = join(__dirname, "..");
const FORBIDDEN = /\b(?:role|orgRole) === "OWNER"|\bisOwnerOf\(/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("the chat never reads by rank", () => {
  const files = [...walk(join(ROOT, "src/server/chat")), join(ROOT, "src/server/policy/conversation.ts")];

  it("every owner-rank comparison in the chat carries `oversight-ok` and a reason", () => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
        if (FORBIDDEN.test(line) && !/oversight-ok:\s*\S/.test(line)) offenders.push(`${relative(ROOT, file).split(sep).join("/")}:${i + 1}: ${line.trim().slice(0, 110)}`);
      });
    }
    expect(offenders, "decide the READ with hasOversight(org), or say on the line why this is not a reading decision").toEqual([]);
  });

  it("the one definition of oversight asks for the capability", () => {
    const policy = readFileSync(join(ROOT, "src/server/policy/conversation.ts"), "utf8");
    expect(policy).toMatch(/export function hasOversight/);
    expect(policy).toMatch(/effectiveCapabilities\(m\)\.has\("archive\.view"\)/);
  });
});
