import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { qrFileName, qrLogoBox, qrModel } from "@/lib/chat/v2/qr";

/** The QR screen (S6.5): the code with the app's mark in the middle, share and download. What decides a scan is here, not in the canvas. */
const read = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8").replace(/\r\n/g, "\n");

describe("qrModel with a mark in the middle", () => {
  it("keeps the default level M, and a higher level makes a different (bigger or denser) code for the same address", () => {
    const url = "https://work.example.com/u/abc123";
    const m = qrModel(url);
    const h = qrModel(url, "H");
    expect(h.path).not.toBe(m.path);
    expect(h.size).toBeGreaterThanOrEqual(m.size);
    expect(qrModel(url)).toEqual(m);
  });
});

describe("qrLogoBox", () => {
  it("is a centred square of odd side that covers well under 8% of the code, so level H (30% recoverable) scans with the mark on it", () => {
    for (const size of [21, 25, 29, 33, 41, 57, 77]) {
      const box = qrLogoBox(size);
      expect(box.side % 2).toBe(1);
      expect(box.x).toBe(box.y);
      expect(box.x * 2 + box.side).toBe(size);
      expect((box.side * box.side) / (size * size)).toBeLessThan(0.08);
      expect(box.side).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("qrFileName", () => {
  it("is the person's name as a PNG, with nothing a file name may not hold", () => {
    expect(qrFileName("سارة علي")).toBe("سارة علي.png");
    expect(qrFileName('a/b\\c:d*e?f"g<h>i|j')).toBe("a b c d e f g h i j.png");
    expect(qrFileName("   ")).toBe("qr.png");
    expect(qrFileName("")).toBe("qr.png");
  });
});

describe("the screen", () => {
  const SRC = read("src/components/chat/v2/info/profile-qr.tsx");
  it("is a sheet that fills a phone, with the name inside the picture (so a saved picture says whose it is)", () => {
    expect(SRC).toContain("data-info-qr-screen");
    expect(SRC).toContain('qrModel(url, "H")');
    expect(SRC).toContain("qrLogoBox(model.size)");
    expect(SRC).toContain("<text");
  });
  it("offers share (the phone's share sheet, else the clipboard) and a PNG download made on the device", () => {
    expect(SRC).toContain("data-info-qr-share");
    expect(SRC).toContain("data-info-qr-download");
    expect(SRC).toContain("navigator.share");
    expect(SRC).toContain("navigator.clipboard.writeText");
    expect(SRC).toContain('toBlob(resolve, "image/png")');
    expect(SRC).toContain("qrFileName(name)");
  });
  it("the code stays black on white whatever the theme is", () => {
    expect(SRC).toContain('fill="white"');
    expect(SRC).toContain('fill="black"');
  });
});
