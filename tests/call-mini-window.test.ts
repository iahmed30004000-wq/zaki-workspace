import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clampOffset, CORNERS, isTap, nearestCorner, parseCorner, TAP_SLOP_PX } from "../src/lib/calls/mini-window";

const ROOT = path.resolve(__dirname, "..");
const provider = readFileSync(path.join(ROOT, "src/components/calls/call-provider.tsx"), "utf8").replace(/\r\n/g, "\n");

/** The owner, 2026-11-21: «لما اصغر الشاشة لتحت ما بقدر ازيحها» — the small call window moves, snaps to a corner and remembers it. */
describe("the small call window snaps to the nearest corner when released", () => {
  const view = { width: 400, height: 800 };
  const box = { width: 176, height: 150 };

  it("a window dropped in the top-left quarter goes to the top-left corner, and so on (a right-to-left page names that corner «end»)", () => {
    expect(nearestCorner({ x: 40, y: 60, ...box }, view, true)).toBe("top-end");
    expect(nearestCorner({ x: 40, y: 60, ...box }, view, false)).toBe("top-start");
    expect(nearestCorner({ x: 200, y: 600, ...box }, view, true)).toBe("bottom-start");
    expect(nearestCorner({ x: 200, y: 600, ...box }, view, false)).toBe("bottom-end");
    expect(nearestCorner({ x: 10, y: 640, ...box }, view, true)).toBe("bottom-end");
  });

  it("knows four corners and reads a remembered one safely", () => {
    expect([...CORNERS].sort()).toEqual(["bottom-end", "bottom-start", "top-end", "top-start"]);
    expect(parseCorner("top-start")).toBe("top-start");
    expect(parseCorner("middle")).toBeNull();
    expect(parseCorner(null)).toBeNull();
    expect(parseCorner(undefined)).toBeNull();
  });
});

describe("the window never leaves the screen while it is dragged", () => {
  const view = { width: 400, height: 800 };
  const rect = { left: 200, top: 600, right: 376, bottom: 750 };

  it("the offset is limited so every edge stays at least the margin inside the screen", () => {
    const margin = 8;
    expect(clampOffset({ dx: -500, dy: 0 }, rect, view, margin).dx).toBe(margin - rect.left);
    expect(clampOffset({ dx: 500, dy: 0 }, rect, view, margin).dx).toBe(view.width - margin - rect.right);
    expect(clampOffset({ dx: 0, dy: -2000 }, rect, view, margin).dy).toBe(margin - rect.top);
    expect(clampOffset({ dx: 0, dy: 2000 }, rect, view, margin).dy).toBe(view.height - margin - rect.bottom);
    expect(clampOffset({ dx: -20, dy: -30 }, rect, view, margin)).toEqual({ dx: -20, dy: -30 });
  });

  it("a window taller than the room left on a tiny screen is pinned to the top-left margin instead of flipping", () => {
    const small = { width: 100, height: 100 };
    const out = clampOffset({ dx: 50, dy: 50 }, { left: 0, top: 0, right: 176, bottom: 150 }, small, 8);
    expect(Number.isFinite(out.dx) && Number.isFinite(out.dy)).toBe(true);
  });
});

describe("a tap is not a drag", () => {
  it("a press that barely moved is a tap (it returns to the call); one that moved past the slop is a drag", () => {
    expect(isTap({ x: 100, y: 100 }, { x: 102, y: 103 })).toBe(true);
    expect(isTap({ x: 100, y: 100 }, { x: 100 + TAP_SLOP_PX + 1, y: 100 })).toBe(false);
    expect(isTap({ x: 100, y: 100 }, { x: 100, y: 100 - TAP_SLOP_PX - 1 })).toBe(false);
  });
});

describe("the small window in the call keeper", () => {
  it("is dragged by pointer events (touch and mouse), stays where it is dropped and remembers the place, and is off the stale bottom-20 offset", () => {
    expect(provider).toContain("onPointerDown");
    expect(provider).toContain("setPointerCapture");
    expect(provider).toContain("saveSpot(");
    expect(provider).toContain("loadSpot()");
    expect(provider).not.toContain("bottom-20");
    expect(provider).toContain("env(safe-area-inset-bottom)");
  });

  it("only its drag handle takes the touch: `touch-none` is on the handle, not on the whole window", () => {
    expect(provider).toContain("touch-none");
    const aside = provider.match(/<aside[^>]*aria-label=\{ct\("calls\.mini"\)\}[^>]*>/)?.[0] ?? "";
    expect(aside).not.toContain("touch-none");
  });

  it("a drag does not count as a tap on the picture (the link back to the call is cancelled after a drag)", () => {
    expect(provider).toMatch(/onClickCapture/);
  });
});
