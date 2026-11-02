import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.resolve(__dirname, "..", rel), "utf8");

/** WP-UI2 item 3: the keyboard must not push the bottom bar under it, and content must keep off the notch. */
describe("the safe area and the keyboard (item 3)", () => {
  it("the viewport asks the browser to resize the page's content, not slide it under the keyboard", () => {
    expect(read("src/app/layout.tsx")).toContain('interactiveWidget: "resizes-content"');
  });

  it("the `.zk-safe-x` utility exists and pads both inline sides by the safe-area inset", () => {
    const css = read("src/app/globals.css");
    expect(css).toMatch(/\.zk-safe-x\s*\{/);
    const rule = /\.zk-safe-x\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(rule).toContain("env(safe-area-inset-left)");
    expect(rule).toContain("env(safe-area-inset-right)");
    // theme colours only: the rule must not carry a literal colour
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("the page itself does not rubber-band (overscroll-y contained)", () => {
    expect(read("src/app/globals.css")).toMatch(/overscroll-behavior-y:\s*contain/);
  });
});

/** The page stops where the content stops: nothing may stretch the document past the window and leave an empty band. */
describe("the frame holds the page (no empty band under the shell)", () => {
  it("the shell frame is positioned and clips, so an absolutely placed child (a screen-reader heading, a decoration) cannot lengthen the document", () => {
    const shell = read("src/components/app-shell.tsx");
    const frame = /<div className="([^"]*\bh-dvh\b[^"]*)">/.exec(shell)?.[1] ?? "";
    expect(frame).toMatch(/\brelative\b/);
    // `clip` (not `hidden`): a hidden frame can still be scrolled by a focus or a scroll-into-view, which is what opened the band
    expect(frame).toMatch(/\boverflow-clip\b/);
    expect(frame).not.toMatch(/\boverflow-hidden\b/);
  });
});
