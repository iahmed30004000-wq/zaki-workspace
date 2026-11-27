import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * THE MOBILE FREEZE, the cheap half (the pictures are the other: qa/README.md): the computer's stylesheet cannot reach a phone, because every rule in it
 * lives inside `@media (min-width: 768px)`, and it only ever declares its own `--dk-…` values or styles under that query.
 */
const css = readFileSync(path.resolve(__dirname, "../src/app/desktop.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The top-level blocks of a stylesheet: what stands before each outer «{», and anything left over between blocks. */
function topLevel(source: string): { heads: string[]; loose: string } {
  const heads: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of source) {
    if (char === "{") {
      if (depth === 0) {
        heads.push(current.trim());
        current = "";
      }
      depth++;
    } else if (char === "}") depth--;
    else if (depth === 0) current += char;
  }
  return { heads, loose: current.trim() };
}

describe("desktop.css never reaches the phone", () => {
  it("has nothing outside the one media query of 768 px and wider", () => {
    const { heads, loose } = topLevel(css);
    expect(loose).toBe("");
    expect(heads.length).toBeGreaterThan(0);
    for (const head of heads) expect(head).toBe("@media (min-width: 768px)");
  });

  it("declares its custom properties under the computer's own prefix", () => {
    const names = [...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]!);
    expect(names.filter((name) => !name.startsWith("--dk-"))).toEqual([]);
  });
});
