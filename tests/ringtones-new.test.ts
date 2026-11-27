import { describe, expect, it } from "vitest";
import { patternMs, RING_PATTERN_PERIOD_MS, RING_PATTERNS, RINGBACK_NOTES } from "@/lib/calls/tones";
import { parseRingTone, RING_TONE_LABEL, RING_TONES } from "@/lib/calls/ring-prefs";
import { builtinsFor } from "@/lib/sound-library/catalog";
import { AR } from "@/lib/i18n/dict";

/** «نغمات الرنين الجديدة موافق» (the owner, 2026-11-27): five ringtones of our own, written as notes. */
const NEW = ["marimba", "breeze", "pearl", "hop", "sunset"] as const;

describe("the five new ringtones", () => {
  it("are choices of the device's ringtone and of the phone's sounds library, each with an Arabic name", () => {
    const library = builtinsFor("ring").map((s) => s.id);
    for (const tone of NEW) {
      expect(RING_TONES).toContain(tone);
      expect(parseRingTone(tone)).toBe(tone);
      expect(library).toContain(`ring-${tone}`);
      expect(AR[RING_TONE_LABEL[tone]], tone).toMatch(/^[؀-ۿ ]+$/);
    }
  });

  it("each is its own melody with a pause before it starts again, never too loud, and none is the caller's waiting tone", () => {
    const shapes = Object.values(RING_PATTERNS).map((p) => JSON.stringify(p));
    expect(new Set(shapes).size).toBe(shapes.length);
    for (const tone of NEW) {
      const notes = RING_PATTERNS[tone];
      expect(notes.length, tone).toBeGreaterThanOrEqual(4);
      expect(RING_PATTERN_PERIOD_MS[tone] - patternMs(notes), tone).toBeGreaterThanOrEqual(600);
      for (const n of notes) {
        expect(n.freq, tone).toBeGreaterThan(200);
        expect(n.freq, tone).toBeLessThan(4000);
        expect(n.gain ?? 0, tone).toBeLessThanOrEqual(0.2);
      }
      // what sounds at one moment never adds up past what the speakers take
      for (const at of notes.map((n) => n.at)) expect(notes.filter((n) => n.at <= at && at < n.at + n.dur).reduce((sum, n) => sum + (n.gain ?? 0), 0), `${tone}@${at}`).toBeLessThan(0.9);
      expect(notes).not.toEqual(RINGBACK_NOTES);
    }
  });
});
