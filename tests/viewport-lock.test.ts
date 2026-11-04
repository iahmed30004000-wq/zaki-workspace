import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.resolve(__dirname, "..", rel), "utf8");

/**
 * The owner (2026-11-04): in the installed phone app the page zoomed in and out by itself, and was left cut at its edges. The scale is
 * fixed at 1 in the viewport the server writes (never changed by a script after the page loaded), the browser does not re-size text on
 * its own, and a double tap is only a tap.
 */
describe("the page keeps its size on a phone", () => {
  it("the viewport fixes the scale at 1", () => {
    const layout = read("src/app/layout.tsx");
    for (const part of ["initialScale: 1", "minimumScale: 1", "maximumScale: 1", "userScalable: false"]) expect(layout, part).toContain(part);
  });

  it("no script rewrites the viewport after the page has loaded", () => {
    expect(read("src/app/layout.tsx")).not.toMatch(/AppScaleLock/);
  });

  it("the browser does not re-size text by itself, and a double tap does not zoom", () => {
    const css = read("src/app/globals.css");
    const rule = /\nhtml\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(rule).toContain("-webkit-text-size-adjust: 100%");
    expect(rule).toContain("touch-action: manipulation");
  });
});
