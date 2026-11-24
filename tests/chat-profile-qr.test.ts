import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { profileQrUrl, qrModel } from "@/lib/chat/v2/qr";

/** «رمز QR» of a person's page: the numbers the screen draws, and where the row sits (the profile block, only with «شكل تيليجرام»). */
describe("qrModel", () => {
  it("is a square of 4v+17 modules whose top-left corner is the finder pattern, and the same text gives the same drawing", () => {
    const a = qrModel("https://work.example.com/u/abc123");
    expect((a.size - 17) % 4).toBe(0);
    expect(a.size).toBeGreaterThanOrEqual(21);
    // the three finder squares: a dark 7×7 ring at each corner except the bottom-right
    expect(a.path.startsWith("M0 0h1v1h-1z")).toBe(true);
    expect(a.path).toContain(`M${a.size - 1} 0h1v1h-1z`);
    expect(a.path).toContain(`M0 ${a.size - 1}h1v1h-1z`);
    expect(qrModel("https://work.example.com/u/abc123")).toEqual(a);
    expect(qrModel("https://work.example.com/u/other").path).not.toBe(a.path);
  });
});

describe("profileQrUrl", () => {
  it("is the person's page under the app's own address, the id encoded, no double slash", () => {
    expect(profileQrUrl("https://work.example.com/", "u 1")).toBe("https://work.example.com/u/u%201");
  });
});

describe("the row on the profile block", () => {
  const SRC = readFileSync(path.resolve(__dirname, "../src/components/chat/v2/info/info-panel.tsx"), "utf8");
  it("is drawn for a person's private chat and only while «شكل تيليجرام» is on", () => {
    expect(SRC).toContain("model.peerId && header.tgLook !== false ? <ProfileQrRow");
  });
});
