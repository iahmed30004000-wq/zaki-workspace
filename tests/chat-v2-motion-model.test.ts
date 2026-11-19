import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FADE_UP_MS, FLIP_MS, FRESH_WINDOW_MS, POP_MS, SLIDE_MS, flipMoves, isFreshArrival, reactionSignature } from "@/lib/chat/v2/phone/motion";

const read = (rel: string): string => readFileSync(path.resolve(__dirname, "..", rel), "utf8");

/**
 * C2.8 — motion («الحركة»): row move (FLIP) 150 ms, bubble fade-up 120 ms, reaction pop 150 ms, the phone's slide 200 ms. Every one is OFF under
 * `prefers-reduced-motion`. The durations are the spec's (C2-chat-ui.md §9) and are pinned here against the keyframes the CSS really has.
 */
describe("the durations are the spec's", () => {
  it("150 / 120 / 150 / 200 ms", () => {
    expect([FLIP_MS, FADE_UP_MS, POP_MS, SLIDE_MS]).toEqual([150, 120, 150, 200]);
  });

  it("the Tailwind animations carry the same numbers", () => {
    const css = read("tailwind.config.ts");
    expect(css).toMatch(/"slide-in-start": "slide-in-start 200ms /);
    expect(css).toMatch(/"fade-up": "fade-up 120ms /);
    expect(css).toMatch(/pop: "pop 150ms /);
  });

  it("the slide starts from the START edge (a variable that is +100% in a right-to-left page), not from a physical side", () => {
    const css = read("tailwind.config.ts");
    expect(css).toMatch(/"slide-in-start": \{[^}]*translateX\(var\(--zk-slide-from, 100%\)\)/);
  });
});

describe("a bubble fades up only when it has just arrived", () => {
  const now = Date.parse("2026-11-19T10:00:00.000Z");
  it("a message from the last few seconds is fresh; an old one (opening a chat, scrolling up) never is", () => {
    expect(isFreshArrival("2026-11-19T09:59:59.000Z", now)).toBe(true);
    expect(isFreshArrival(new Date(now - FRESH_WINDOW_MS).toISOString(), now)).toBe(true);
    expect(isFreshArrival(new Date(now - FRESH_WINDOW_MS - 1).toISOString(), now)).toBe(false);
    expect(isFreshArrival("2026-11-18T10:00:00.000Z", now)).toBe(false);
  });

  it("a little clock difference with the server still counts as just now; a date from the far future or a broken one does not", () => {
    expect(isFreshArrival(new Date(now + 2000).toISOString(), now)).toBe(true);
    expect(isFreshArrival(new Date(now + 60_000).toISOString(), now)).toBe(false);
    expect(isFreshArrival("not a date", now)).toBe(false);
    expect(isFreshArrival("", now)).toBe(false);
  });
});

describe("the reactions pop when they change", () => {
  const a = [{ emoji: "👍", count: 1, mine: false }];
  it("the signature changes with a new emoji, a new count and my own toggle — and only then", () => {
    expect(reactionSignature(a)).toBe(reactionSignature([{ emoji: "👍", count: 1, mine: false }]));
    expect(reactionSignature(a)).not.toBe(reactionSignature([{ emoji: "👍", count: 2, mine: false }]));
    expect(reactionSignature(a)).not.toBe(reactionSignature([{ emoji: "👍", count: 1, mine: true }]));
    expect(reactionSignature(a)).not.toBe(reactionSignature([...a, { emoji: "❤️", count: 1, mine: false }]));
    expect(reactionSignature([])).toBe("");
  });
});

describe("a row that moved slides to its place (FLIP)", () => {
  it("reports the rows whose offset changed, from where they were to where they are; the others and the new ones stand still", () => {
    const prev = new Map<string | number, number>([["a", 0], ["b", 76], ["c", 152]]);
    const next = new Map<string | number, number>([["c", 0], ["a", 76], ["b", 152], ["d", 228]]);
    expect(flipMoves(prev, next)).toEqual([
      { key: "c", from: 152, to: 0 },
      { key: "a", from: 0, to: 76 },
      { key: "b", from: 76, to: 152 },
    ]);
    expect(flipMoves(prev, prev)).toEqual([]);
  });

  it("does nothing when too many rows moved at once (a folder switch or a search is a new list, not a move)", () => {
    const prev = new Map<string | number, number>();
    const next = new Map<string | number, number>();
    for (let i = 0; i < 60; i += 1) {
      prev.set(`k${i}`, i * 76);
      next.set(`k${i}`, (i + 1) * 76);
    }
    expect(flipMoves(prev, next)).toEqual([]);
    expect(flipMoves(prev, next, 100)).toHaveLength(60);
  });
});

describe("every motion is off under prefers-reduced-motion", () => {
  it("the classes that animate carry motion-reduce:animate-none, and the script-driven ones ask the media query first", () => {
    const bubble = read("src/components/chat/v2/message-bubble.tsx");
    expect(bubble).toMatch(/animate-fade-up motion-reduce:animate-none/);
    const pop = read("src/components/chat/v2/phone/reaction-pop.tsx");
    expect(pop).toMatch(/animate-pop motion-reduce:animate-none/);
    const frame = read("src/components/chat/v2/phone/screen-frame.tsx");
    expect(frame).toMatch(/animate-slide-in-start motion-reduce:animate-none/);
    expect(read("src/lib/chat/v2/phone/use-flip.ts")).toMatch(/prefersReducedMotion\(\)/);
    expect(read("src/lib/chat/v2/phone/use-edge-swipe.ts")).toContain("reducedMotion: prefersReducedMotion");
    expect(read("src/lib/chat/v2/phone/edge-swipe-controller.ts")).toContain("if (env.reducedMotion()) return clear();");
    expect(read("src/lib/chat/v2/phone/motion.ts")).toMatch(/\(prefers-reduced-motion: reduce\)/);
  });

  it("the global rule that stops every animation under reduced motion is still in globals.css", () => {
    expect(read("src/app/globals.css")).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*,/);
  });
});
