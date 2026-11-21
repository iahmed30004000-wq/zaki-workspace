import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RING_GAP_MS, RING_SOUND_URL, ringbackFor, ringbackMsLeft, startRing, startRingback } from "../src/lib/calls/ring-sound";
import { RING_PATTERNS, RINGBACK_NOTES } from "../src/lib/calls/tones";

const ROOT = path.resolve(__dirname, "..");

describe("the caller hears the phone ring while nobody has answered (the owner, 2026-10-30: like a messenger)", () => {
  const startedAt = "2026-10-30T12:00:00Z";
  const at = (sec: number) => Date.parse(startedAt) + sec * 1000;

  it("rings while the caller is alone in a call that just started, for the same 30 s the other side rings", () => {
    expect(ringbackMsLeft({ alone: true, startedAt, now: at(5), forMs: 30_000 })).toBe(25_000);
    expect(ringbackMsLeft({ alone: true, startedAt, now: at(0), forMs: 30_000 })).toBe(30_000);
  });

  it("stops as soon as somebody else is in, and does not ring in an old call", () => {
    expect(ringbackMsLeft({ alone: false, startedAt, now: at(5), forMs: 30_000 })).toBe(0);
    expect(ringbackMsLeft({ alone: true, startedAt, now: at(31), forMs: 30_000 })).toBe(0);
  });
});

describe("the ringback is for a private call where somebody is really being rung (the owner: «برن علي ع حالي»)", () => {
  const startedAt = "2026-11-21T12:00:00Z";
  const at = (sec: number) => Date.parse(startedAt) + sec * 1000;
  const dm = { kind: "DM" as const, rangCount: 1, startedAt };

  it("rings the caller of a private call who is alone while the other side rings", () => {
    expect(ringbackFor({ view: dm, alone: true, now: at(5), forMs: 30_000 })).toBe(25_000);
  });

  it("never rings for a topic call, even one started with «رنّ على الكل»", () => {
    expect(ringbackFor({ view: { ...dm, kind: "TOPIC", rangCount: 40 }, alone: true, now: at(5), forMs: 30_000 })).toBe(0);
    expect(ringbackFor({ view: { ...dm, kind: "GROUP", rangCount: 3 }, alone: true, now: at(5), forMs: 30_000 })).toBe(0);
  });

  it("never rings for a meeting, nor when nobody was rung (a call that was joined, not started with a ring)", () => {
    expect(ringbackFor({ view: { ...dm, kind: "MEETING", rangCount: 0 }, alone: true, now: at(5), forMs: 30_000 })).toBe(0);
    expect(ringbackFor({ view: { ...dm, rangCount: 0 }, alone: true, now: at(5), forMs: 30_000 })).toBe(0);
  });

  it("is silent while the call is not loaded yet, and once somebody has joined", () => {
    expect(ringbackFor({ view: null, alone: true, now: at(5), forMs: 30_000 })).toBe(0);
    expect(ringbackFor({ view: dm, alone: false, now: at(5), forMs: 30_000 })).toBe(0);
  });
});

describe("the ringback has its own soft tone, not the incoming ringtone", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is two notes, softer than the ringtone, and a different pattern from every incoming tone", () => {
    expect(RINGBACK_NOTES).toHaveLength(2);
    expect(RINGBACK_NOTES[0]!.freq).not.toBe(RINGBACK_NOTES[1]!.freq);
    for (const n of RINGBACK_NOTES) expect(n.gain ?? 0.1).toBeLessThanOrEqual(0.1);
    expect(RINGBACK_NOTES).not.toEqual(RING_PATTERNS.soft);
    expect(RINGBACK_NOTES).not.toEqual(RING_PATTERNS.bell);
  });

  it("never plays the ringtone file and stops cleanly", () => {
    vi.useFakeTimers();
    const files: string[] = [];
    class FakeAudio {
      constructor(src: string) {
        files.push(src);
      }
      play = () => Promise.resolve();
      pause = () => undefined;
    }
    vi.stubGlobal("Audio", FakeAudio);
    const stop = startRingback();
    vi.advanceTimersByTime(10_000);
    expect(files).toEqual([]);
    expect(() => stop()).not.toThrow();
    expect(() => stop()).not.toThrow();
  });
});

describe("the ring sound", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("plays the file, asks again after a short pause, and stops cleanly", () => {
    vi.useFakeTimers();
    const instances: FakeAudio[] = [];
    class FakeAudio {
      src: string;
      volume = 1;
      onended: (() => void) | null = null;
      play = vi.fn(() => Promise.resolve());
      pause = vi.fn();
      constructor(src: string) {
        this.src = src;
        instances.push(this);
      }
    }
    vi.stubGlobal("Audio", FakeAudio);
    const stop = startRing();
    expect(instances[0]?.src).toBe(RING_SOUND_URL);
    expect(instances[0]?.play).toHaveBeenCalledTimes(1);
    instances[0]?.onended?.();
    vi.advanceTimersByTime(RING_GAP_MS + 10);
    expect(instances[0]?.play).toHaveBeenCalledTimes(2);
    stop();
    expect(instances[0]?.pause).toHaveBeenCalled();
    vi.advanceTimersByTime(RING_GAP_MS * 3);
    expect(instances[0]?.play).toHaveBeenCalledTimes(2); // nothing plays after stop
    stop(); // a second stop is harmless
  });

  it("never throws when the browser refuses to play (no gesture yet): the built-in beep takes over", async () => {
    class RefusedAudio {
      volume = 1;
      onended: (() => void) | null = null;
      play = () => Promise.reject(new Error("NotAllowedError"));
      pause = () => undefined;
    }
    vi.stubGlobal("Audio", RefusedAudio);
    const stop = startRing();
    await Promise.resolve();
    expect(() => stop()).not.toThrow();
  });
});

describe("the sound file and who owns it", () => {
  it("is a small mp3 under public/sounds, and the credits say where it came from and under which licence", () => {
    const file = path.join(ROOT, "public/sounds/ring.mp3");
    expect(statSync(file).size / 1024).toBeLessThanOrEqual(150);
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 3).toString("latin1") === "ID3" || bytes[0] === 0xff).toBe(true);
    const credits = readFileSync(path.join(ROOT, "public/brand/CREDITS.md"), "utf8");
    expect(credits).toMatch(/sounds\/ring\.mp3[^\n]*CC0[^\n]*opengameart\.org\/content\/modern-ringtone-chirptone/);
  });

  it("is served like the other static folders: a request for it is never sent to the sign-in page", () => {
    const middleware = readFileSync(path.join(ROOT, "src/middleware.ts"), "utf8");
    expect(middleware).toMatch(/STATIC_DIRS = \[[^\]]*"\/sounds\/"/);
    expect(middleware).toMatch(/STATIC_EXT = [^\n]*mp3/);
  });

  it("the incoming ringtone belongs to the incoming card ONLY; the caller's room has its own soft ringback", () => {
    const card = readFileSync(path.join(ROOT, "src/components/calls/call-ring.tsx"), "utf8");
    const room = readFileSync(path.join(ROOT, "src/components/calls/call-room.tsx"), "utf8");
    expect(card).toMatch(/startRing\b/);
    expect(card).not.toMatch(/startRingback/);
    expect(card).not.toMatch(/createOscillator/);
    expect(room).not.toMatch(/\bstartRing\b/);
    expect(room).toMatch(/startRingback/);
    expect(room).toMatch(/ringbackFor/);
  });
});
