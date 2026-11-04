import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The installed app keeps its page size (no zoomed-in, edge-cut page); a normal browser tab is untouched. */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the installed app's scale lock", () => {
  it("is mounted once in the root layout", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain("<AppScaleLock />");
    expect(layout.match(/<AppScaleLock \/>/g)).toHaveLength(1);
  });

  it("locks the scale only when the page is opened as an installed app, and only once", () => {
    const src = read("src/components/app-scale-lock.tsx");
    expect(src).toContain("(display-mode: ${mode})");
    for (const mode of ['"standalone"', '"fullscreen"', '"minimal-ui"']) expect(src).toContain(mode);
    expect(src).toContain("maximum-scale=1");
    expect(src).toContain("/maximum-scale/.test(content)");
  });

  it("keeps the server's viewport as it is (zoom stays available in a browser tab)", () => {
    expect(read("src/app/layout.tsx")).not.toMatch(/maximumScale|userScalable/);
  });
});
