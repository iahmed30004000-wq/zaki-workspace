import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { adjustFilter, clampAdjust, cropBox, editedName, emptyEdit, isUntouched, turnedSize, type EditState } from "@/lib/chat/v2/composer/photo-edit";

/** The photo editor (S6.2): the numbers it draws with. The canvas itself is the browser's; what decides the result is here. */
describe("adjustFilter", () => {
  it("is «none» while nothing is moved, so an untouched picture is never redrawn", () => {
    expect(adjustFilter(emptyEdit)).toBe("none");
  });
  it("exposure moves the brightness, contrast the contrast, enhance both a little and the colour", () => {
    expect(adjustFilter({ ...emptyEdit, exposure: 100 })).toBe("brightness(1.50) contrast(1.00) saturate(1.00)");
    expect(adjustFilter({ ...emptyEdit, exposure: -100 })).toBe("brightness(0.50) contrast(1.00) saturate(1.00)");
    expect(adjustFilter({ ...emptyEdit, contrast: 50 })).toBe("brightness(1.00) contrast(1.25) saturate(1.00)");
    expect(adjustFilter({ ...emptyEdit, enhance: 100 })).toBe("brightness(1.00) contrast(1.25) saturate(1.50)");
  });
});

describe("clampAdjust", () => {
  it("keeps a slider's number a whole number inside -100..100", () => {
    expect(clampAdjust(250)).toBe(100);
    expect(clampAdjust(-250)).toBe(-100);
    expect(clampAdjust(12.6)).toBe(13);
    expect(clampAdjust(Number.NaN)).toBe(0);
  });
});

describe("turnedSize", () => {
  it("swaps the sides on a quarter turn and keeps them on a half turn", () => {
    expect(turnedSize(400, 300, 0)).toEqual({ w: 400, h: 300 });
    expect(turnedSize(400, 300, 1)).toEqual({ w: 300, h: 400 });
    expect(turnedSize(400, 300, 2)).toEqual({ w: 400, h: 300 });
    expect(turnedSize(400, 300, 3)).toEqual({ w: 300, h: 400 });
  });
});

describe("cropBox", () => {
  it("is the whole picture for «free»", () => {
    expect(cropBox(400, 300, "free")).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });
  it("is the biggest centred box of the ratio", () => {
    expect(cropBox(400, 300, "square")).toEqual({ x: 50, y: 0, w: 300, h: 300 });
    expect(cropBox(300, 400, "square")).toEqual({ x: 0, y: 50, w: 300, h: 300 });
    expect(cropBox(1600, 1200, "four-three")).toEqual({ x: 0, y: 0, w: 1600, h: 1200 });
    expect(cropBox(1600, 1200, "sixteen-nine")).toEqual({ x: 0, y: 150, w: 1600, h: 900 });
  });
  it("never leaves the picture, whatever its shape", () => {
    for (const [w, h] of [[1, 1], [7, 1000], [1000, 7], [333, 777]] as const) {
      for (const preset of ["free", "square", "four-three", "sixteen-nine"] as const) {
        const box = cropBox(w, h, preset);
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w).toBeLessThanOrEqual(w);
        expect(box.y + box.h).toBeLessThanOrEqual(h);
        expect(box.w).toBeGreaterThanOrEqual(1);
        expect(box.h).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe("isUntouched and editedName", () => {
  it("knows a picture nobody changed", () => {
    expect(isUntouched(emptyEdit)).toBe(true);
    const moved: EditState[] = [
      { ...emptyEdit, turns: 1 },
      { ...emptyEdit, crop: "square" },
      { ...emptyEdit, enhance: 1 },
      { ...emptyEdit, strokes: [{ color: "red", width: 0.01, points: [[0, 0], [1, 1]] }] },
    ];
    for (const state of moved) expect(isUntouched(state)).toBe(false);
  });
  it("names the edited picture as a JPEG (it was redrawn), keeping the name the person knows", () => {
    expect(editedName("IMG_001.png")).toBe("IMG_001.jpg");
    expect(editedName("photo")).toBe("photo.jpg");
    expect(editedName("a.b.webp")).toBe("a.b.jpg");
  });
});

describe("the editor and its place in the sheet", () => {
  const SHEET = readFileSync(path.resolve(__dirname, "../src/components/chat/v2/composer/attach-sheet.tsx"), "utf8");
  const SURFACE = readFileSync(path.resolve(__dirname, "../src/components/chat/v2/composer/composer-surface.tsx"), "utf8");
  const ENGINE = readFileSync(path.resolve(__dirname, "../src/lib/chat/v2/composer/use-composer.ts"), "utf8");
  it("a picture tile has an edit button and a quality button, only when the engine can do them", () => {
    expect(SHEET).toContain("data-attach-edit");
    expect(SHEET).toContain("data-attach-hd");
    expect(SHEET).toContain("onEdit && ");
  });
  it("the quality button lifts the longest side to the high limit for that picture only", () => {
    expect(ENGINE).toContain("item.hd ? { maxSide: HIGH_MAX_SIDE } : { maxSide: maxSideFor(readDevicePrefs().imageQuality) }");
  });
  it("an edit replaces the file in place and keeps its place and its choice of quality", () => {
    expect(ENGINE).toContain("function replaceFile(index: number, file: File)");
    expect(ENGINE).toContain("function setHd(index: number, on: boolean)");
    expect(SURFACE).toContain("onEdit={c.replaceFile}");
  });
});
