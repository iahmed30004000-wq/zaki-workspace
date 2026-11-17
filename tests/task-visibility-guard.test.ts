import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * P0.2 guard (docs/restructure/P0-privacy.md): a task can be private («المعنيين بس»). So EVERY read of the `Task`
 * table in `src/` either goes through the one visibility rule (`taskVisibleWhere`, `canSeeTask`, `taskVisibleSql`,
 * `requireTaskAccess` in src/server/services/team-scope.ts and src/server/auth.ts) in the same function, or says why not
 * on its own line (or within the 12 lines above it, for a raw-SQL statement) with `// task-visibility: <reason>` — a system job, an aggregate for oversight only.
 * A new reader that forgets the rule fails here, which is the whole point: one forgotten filter is a leak.
 */
const ROOT = join(__dirname, "..");
const READ = /\b(?:db|tx|prisma)\.task\.(?:findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|count|groupBy|aggregate)\b|\bFROM "Task"|\bJOIN "Task"/;
const RULE = /taskVisibleWhere\(|taskParticipantWhere\(|taskParticipantFilter\(|canSeeTask\(|canSeeTaskParticipants\(|taskVisibleSql\(|requireTaskAccess\(|assertTaskParticipant\(|requireTeamWork\([^)]*\btask\)/;
const MARK = /\/\/\s*task-visibility:\s*\S/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** The text of the function around line `at` (0-based): back to the nearest line that opens a function, forward to the next one. */
function enclosing(lines: string[], at: number): string {
  const opens = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\b|^(?:export\s+)?const\s+\w+\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>/;
  let start = at;
  while (start > 0 && !opens.test(lines[start]!)) start--;
  let end = at + 1;
  while (end < lines.length && !opens.test(lines[end]!)) end++;
  return lines.slice(start, end).join("\n");
}

describe("every read of tasks goes through the visibility rule", () => {
  it("each reader calls the helper in its function, or carries `task-visibility:` and a reason", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, "src"))) {
      const text = readFileSync(file, "utf8");
      if (!READ.test(text)) continue;
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!READ.test(line)) return;
        if (MARK.test(line) || Array.from({ length: 13 }, (_, k) => lines[i - k]).some((l) => l !== undefined && MARK.test(l))) return;
        if (RULE.test(enclosing(lines, i))) return;
        offenders.push(`${relative(ROOT, file).split(sep).join("/")}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders, "route this read through taskVisibleWhere / canSeeTask / taskVisibleSql / requireTaskAccess, or mark it with `// task-visibility: <reason>`").toEqual([]);
  });

  it("the helper itself knows the participants rule", () => {
    const helper = readFileSync(join(ROOT, "src/server/services/team-scope.ts"), "utf8");
    expect(helper).toMatch(/export function canSeeTask/);
    expect(helper).toMatch(/export function taskVisibleSql/);
    expect(helper).toMatch(/visibility/);
  });
});
