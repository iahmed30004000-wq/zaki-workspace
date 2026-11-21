import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startRing, RING_SOUND_URL } from "../src/lib/calls/ring-sound";
import { DEFAULT_RING_TONE, loadRingTone, parseRingTone, RING_TONES, saveRingTone } from "../src/lib/calls/ring-prefs";
import { lockDecision, LOCK_FRESH_MS, startSharedRing, type LockStorage } from "../src/lib/calls/ring-lock";
import { CONNECT_NOTES, END_NOTES, patternMs, RING_PATTERNS, RING_PATTERN_PERIOD_MS } from "../src/lib/calls/tones";
import { RING_VIBRATION, startVibration } from "../src/lib/calls/vibrate";

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A key-value store both «tabs» of a test share, like localStorage does between the tabs of one browser. */
function sharedStore(): LockStorage {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe("three incoming ringtones, chosen per device", () => {
  it("the recorded one stays, two drawn ones join it; reading a remembered choice is safe", () => {
    expect([...RING_TONES]).toEqual(["file", "soft", "bell"]);
    expect(DEFAULT_RING_TONE).toBe("file");
    expect(parseRingTone("bell")).toBe("bell");
    expect(parseRingTone("trumpet")).toBeNull();
    expect(parseRingTone(null)).toBeNull();
  });

  it("is kept in localStorage on this device only, and a device with no storage rings the default", () => {
    const store = sharedStore();
    vi.stubGlobal("localStorage", store);
    expect(loadRingTone()).toBe("file");
    saveRingTone("soft");
    expect(store.getItem("zk-ring-tone")).toBe("soft");
    expect(loadRingTone()).toBe("soft");
    store.setItem("zk-ring-tone", "nonsense");
    expect(loadRingTone()).toBe("file");
    vi.stubGlobal("localStorage", undefined);
    expect(loadRingTone()).toBe("file");
  });

  it("a drawn ringtone plays no file; the recorded one still plays the file", () => {
    const files: string[] = [];
    class FakeAudio {
      volume = 1;
      onended: (() => void) | null = null;
      constructor(src: string) {
        files.push(src);
      }
      play = () => Promise.resolve();
      pause = () => undefined;
    }
    vi.stubGlobal("Audio", FakeAudio);
    startRing({ tone: "soft" })();
    startRing({ tone: "bell" })();
    expect(files).toEqual([]);
    startRing({ tone: "file" })();
    expect(files).toEqual([RING_SOUND_URL]);
  });

  it("the drawn patterns have their own notes and rounds", () => {
    expect(RING_PATTERNS.soft.length).toBeGreaterThan(2);
    expect(RING_PATTERNS.bell.length).toBeGreaterThan(2);
    expect(RING_PATTERN_PERIOD_MS.soft).toBeGreaterThan(patternMs(RING_PATTERNS.soft));
    expect(RING_PATTERN_PERIOD_MS.bell).toBeGreaterThan(patternMs(RING_PATTERNS.bell));
  });
});

describe("a connect blip and an end blip", () => {
  it("are short, and the end falls where the connect rises", () => {
    expect(patternMs(CONNECT_NOTES)).toBeLessThan(600);
    expect(patternMs(END_NOTES)).toBeLessThan(600);
    expect(CONNECT_NOTES[1]!.freq).toBeGreaterThan(CONNECT_NOTES[0]!.freq);
    expect(END_NOTES[1]!.freq).toBeLessThan(END_NOTES[0]!.freq);
  });

  it("the call keeper plays the connect sound when the call connects and the end sound when it ends", () => {
    const provider = read("src/components/calls/call-provider.tsx");
    expect(provider).toContain("playConnect()");
    expect(provider).toContain("playEnd()");
  });
});

describe("only ONE tab of a browser rings", () => {
  const callId = "c1";

  it("takes the ring when nobody holds it or the holder went quiet, keeps it, and leaves a live holder alone", () => {
    expect(lockDecision(null, "a", callId, 1000)).toBe("take");
    expect(lockDecision({ tab: "a", callId, at: 1000 }, "a", callId, 1500)).toBe("mine");
    expect(lockDecision({ tab: "a", callId, at: 1000 }, "b", callId, 1500)).toBe("other");
    expect(lockDecision({ tab: "a", callId, at: 1000 }, "b", callId, 1000 + LOCK_FRESH_MS + 1)).toBe("take");
    // a different call has its own ring
    expect(lockDecision({ tab: "a", callId: "c2", at: 1000 }, "b", callId, 1500)).toBe("take");
  });

  it("two tabs ring ONE copy: the second stays silent, and takes over when the first closes", () => {
    vi.useFakeTimers();
    const store = sharedStore();
    const played: string[] = [];
    const stopped: string[] = [];
    const play = (who: string) => () => {
      played.push(who);
      return () => void stopped.push(who);
    };
    const stopA = startSharedRing(callId, play("a"), { tabId: "a", storage: store, jitterMs: 0 });
    vi.advanceTimersByTime(10);
    const stopB = startSharedRing(callId, play("b"), { tabId: "b", storage: store, jitterMs: 0 });
    vi.advanceTimersByTime(3000);
    expect(played).toEqual(["a"]);
    // the first tab answers or closes: the lock is released, and the second picks the ring up
    stopA();
    expect(stopped).toEqual(["a"]);
    vi.advanceTimersByTime(2500);
    expect(played).toEqual(["a", "b"]);
    stopB();
    expect(stopped).toEqual(["a", "b"]);
  });

  it("a tab that died without letting go loses the ring after the lock goes stale", () => {
    vi.useFakeTimers();
    const store = sharedStore();
    store.setItem("zk-ring-lock", JSON.stringify({ tab: "dead", callId, at: Date.now() }));
    const played: string[] = [];
    const stop = startSharedRing(callId, () => (played.push("b"), () => undefined), { tabId: "b", storage: store, jitterMs: 0 });
    vi.advanceTimersByTime(500);
    expect(played).toEqual([]);
    vi.advanceTimersByTime(LOCK_FRESH_MS + 1500);
    expect(played).toEqual(["b"]);
    stop();
  });

  it("with no storage at all the ring just plays (never silent)", () => {
    vi.useFakeTimers();
    const played: string[] = [];
    const stop = startSharedRing(callId, () => (played.push("x"), () => undefined), { tabId: "x", storage: null, jitterMs: 0 });
    vi.advanceTimersByTime(10);
    expect(played).toEqual(["x"]);
    stop();
  });

  it("the incoming card rings through the lock and closes its twins when answered or declined", () => {
    const card = read("src/components/calls/call-ring.tsx");
    expect(card).toContain("startSharedRing(");
    expect(card).toContain("announceRingDone(");
  });
});

describe("the phone vibrates while it rings, where the browser can", () => {
  it("vibrates on a pattern, repeats it, and stops with the ring; a browser without vibration is fine", () => {
    vi.useFakeTimers();
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate });
    const stop = startVibration();
    expect(vibrate).toHaveBeenLastCalledWith(RING_VIBRATION);
    const first = vibrate.mock.calls.length;
    vi.advanceTimersByTime(3500);
    expect(vibrate.mock.calls.length).toBeGreaterThan(first);
    stop();
    expect(vibrate).toHaveBeenLastCalledWith(0);
    const after = vibrate.mock.calls.length;
    vi.advanceTimersByTime(10_000);
    expect(vibrate.mock.calls.length).toBe(after);

    vi.stubGlobal("navigator", {});
    expect(() => startVibration()()).not.toThrow();
  });
});

describe("the notification settings choose the ringtone", () => {
  it("offers the three tones with a way to hear each, kept per device", () => {
    const section = read("src/components/settings-me/notifications-section.tsx");
    expect(section).toContain("RING_TONES");
    expect(section).toContain("saveRingTone(");
    expect(section).toContain('role="radiogroup"');
    expect(section).toContain("startRing({ tone");
  });
});
