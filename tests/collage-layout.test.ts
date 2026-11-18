import { describe, expect, it } from "vitest";
import { collageColumns, layoutCollage, MAX_PICTURES, MAX_PAGE_HEIGHT } from "../src/lib/cards/collage-layout";

/** Q1.2: «اعمليهم صورة وحدة» — a pure layout: 2 to 9 pictures, never cropped, shortest column first, split when taller than 4096. */
const shot = (w = 1080, h = 1920) => ({ width: w, height: h });

describe("the columns", () => {
  it("two columns for 2 to 4 pictures, three for 5 to 9", () => {
    expect(collageColumns(2)).toBe(2);
    expect(collageColumns(4)).toBe(2);
    expect(collageColumns(5)).toBe(3);
    expect(collageColumns(9)).toBe(3);
  });
  it("fewer than two or more than nine is refused", () => {
    expect(() => layoutCollage([shot()])).toThrow();
    expect(() => layoutCollage(Array.from({ length: MAX_PICTURES + 1 }, () => shot()))).toThrow();
  });
});

describe("the layout", () => {
  it("is 1080 wide with two columns and 1440 with three, 12 px gaps all round, a white page", () => {
    const two = layoutCollage([shot(1000, 500), shot(1000, 500)]);
    expect(two.pages[0]!.width).toBe(1080);
    expect(two.pages[0]!.background).toBe("#ffffff");
    const three = layoutCollage(Array.from({ length: 5 }, () => shot(1000, 500)));
    expect(three.pages[0]!.width).toBe(1440);
    const p = two.pages[0]!.placements;
    expect(p[0]).toMatchObject({ x: 12, y: 12, w: 522, h: 261 });
    expect(p[1]).toMatchObject({ x: 546, y: 12, w: 522, h: 261 });
  });
  it("never crops: every picture keeps its own proportions", () => {
    const sizes = [shot(1080, 2400), shot(720, 1280), shot(1440, 900), shot(500, 500), shot(333, 777)];
    const page = layoutCollage(sizes).pages[0]!;
    for (const pl of page.placements) {
      const src = sizes[pl.index]!;
      expect(Math.abs(pl.w / pl.h - src.width / src.height)).toBeLessThan(0.02);
    }
  });
  it("puts each picture in the shortest column, in order, and nothing overlaps", () => {
    const sizes = [shot(1000, 2000), shot(1000, 500), shot(1000, 500), shot(1000, 500)];
    const page = layoutCollage(sizes).pages[0]!;
    const byIndex = new Map(page.placements.map((p) => [p.index, p]));
    expect(byIndex.get(0)!.x).toBe(12);
    for (const i of [1, 2, 3]) expect(byIndex.get(i)!.x).toBe(546);
    expect(byIndex.get(2)!.y).toBeGreaterThan(byIndex.get(1)!.y + byIndex.get(1)!.h - 1);
    for (const a of page.placements) {
      for (const b of page.placements) {
        if (a.index >= b.index) continue;
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${a.index} vs ${b.index}`).toBe(true);
      }
    }
  });
  it("leaves room for a caption line on top when there is one", () => {
    const without = layoutCollage([shot(1000, 500), shot(1000, 500)]).pages[0]!;
    const withCap = layoutCollage([shot(1000, 500), shot(1000, 500)], { caption: "حراك" }).pages[0]!;
    expect(withCap.caption).toEqual({ text: "حراك", x: 12, y: 12, w: 1056, h: expect.any(Number) });
    expect(withCap.placements[0]!.y).toBeGreaterThan(without.placements[0]!.y);
    expect(withCap.height).toBeGreaterThan(without.height);
  });
});

describe("the split", () => {
  it("a result taller than 4096 is made more than one picture, in order, none taller than 4096", () => {
    const tall = Array.from({ length: 9 }, () => shot(1080, 4000));
    const out = layoutCollage(tall);
    expect(out.pages.length).toBeGreaterThanOrEqual(2);
    for (const pg of out.pages) expect(pg.height).toBeLessThanOrEqual(MAX_PAGE_HEIGHT);
    const order = out.pages.flatMap((pg) => pg.placements.map((p) => p.source)).sort((a, b) => a - b);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("a short result stays one picture", () => {
    expect(layoutCollage([shot(1000, 400), shot(1000, 400), shot(1000, 400)]).pages).toHaveLength(1);
  });
});
