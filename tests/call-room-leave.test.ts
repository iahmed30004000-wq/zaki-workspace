import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { leaveTarget } from "../src/lib/calls/session";

const ROOT = path.resolve(__dirname, "..");
const room = readFileSync(path.join(ROOT, "src/components/calls/call-room.tsx"), "utf8").replace(/\r\n/g, "\n");
const provider = readFileSync(path.join(ROOT, "src/components/calls/call-provider.tsx"), "utf8").replace(/\r\n/g, "\n");
const dictionary = readFileSync(path.join(ROOT, "src/lib/i18n/ar.calls.json"), "utf8");

/** The owner, 2026-11-21: «الخروج منها غبي بتحسو وخطوات ومراحل» — leaving a call is ONE tap. */
describe("leaving a call is one tap", () => {
  it("«اطلع» leaves and goes straight back: the conversation, or home for a meeting", () => {
    expect(leaveTarget({ conversationId: "c1" })).toBe("/chat/c1");
    expect(leaveTarget({ conversationId: null })).toBe("/");
    expect(leaveTarget(null)).toBe("/");
  });

  it("the page has no «طلعت من المكالمة» screen, no «ارجع على المكالمة» button, and no «أكيد؟» second step", () => {
    expect(room).not.toContain("calls.left");
    expect(room).not.toContain("calls.again");
    expect(room).not.toContain("calls.end_confirm");
    expect(room).not.toContain("confirming");
    expect(dictionary).not.toContain('"calls.end_confirm"');
    expect(dictionary).not.toContain('"calls.left"');
    expect(dictionary).not.toContain('"calls.again"');
  });

  it("«اطلع» disconnects and navigates in the same tap (router.replace, no history entry left on the call)", () => {
    expect(room).toContain("router.replace(");
    expect(room).toMatch(/function leaveNow\(\)[^]*?void call\.leave\(\)/);
    // the provider marks the call as left BEFORE it waits for the room and the server, so the small window never flashes
    expect(provider).toMatch(/phase: "left", reconnecting: false \}\);\n\s+if \(room\) await room\.disconnect/);
  });

  it("«إنهاء للكل» is an item of a small menu next to «اطلع», for the hosts only, and one tap on it ends the call", () => {
    expect(room).toContain("DropdownMenuItem");
    expect(room).toContain('ct("calls.end_all")');
    expect(room).toMatch(/view\?\.can\.end &&[^]*?DropdownMenu/);
    expect(room).toMatch(/onSelect=\{\(\) => void endForAll\(\)\}/);
    // no timer-driven confirmation any more
    expect(room).not.toMatch(/setTimeout\(\(\) => setConfirming/);
  });

  it("the call keeps the end-of-call line in the chat (the server writes it; nothing here removes it)", () => {
    const server = readFileSync(path.join(ROOT, "src/server/calls/calls.ts"), "utf8");
    expect(server).toContain('k: missedBy ? "call_missed" : "call_ended"');
  });
});
