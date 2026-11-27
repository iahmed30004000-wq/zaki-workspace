import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { TG_MOTION, tgMotionVars } from "@/lib/chat/v2/phone/motion";
import { EFFECT_KEYS, effectAllowed, effectOn } from "@/lib/motion/effects";
import { cleanDevicePrefs } from "@/lib/device-prefs";
import { bootScript } from "@/lib/themes/boot";
import { FEATURE_DEFAULTS, FEATURE_META } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";

/** The owner's spec «برومبت الورك سبيس زي تيليجرام» (2026-11-27): its timings are named constants, each within 30 ms. */
const SPEC: Partial<Record<keyof typeof TG_MOTION, number>> = {
  rippleMs: 150, openMs: 220, openShiftPx: 24, backMs: 180, subPageMs: 220, tabSwitchMs: 120, folderSwitchMs: 280, folderAvatarsMs: 150,
  searchFadeMs: 240, searchSkeletonMs: 2000, menuDimMs: 140, menuScaleMs: 150, toastMs: 3000, themeMenuMs: 180, themeRevealMs: 200,
  messageDimMs: 140, messageMenuMs: 150, reactionCardFillMs: 1000, reactionMenuFadeMs: 240, bubbleGrowMs: 200, reactionFlyMs: 250,
  reactionBurstMs: 1000, emojiEffectMs: 3300, deleteSettleMs: 300, composerMorphMs: 150, recordMorphMs: 200, micToSendMs: 120,
  dictationFadeMs: 250, voiceDustMs: 400,
};

describe("the spec's timings", () => {
  it.each(Object.entries(SPEC))("%s is within 30 of %i", (key, value) => {
    expect(Math.abs(TG_MOTION[key as keyof typeof TG_MOTION] - (value as number))).toBeLessThanOrEqual(30);
  });

  it("the dust of a deleted bubble takes 300 to 400 ms, the sheet 150 to 200", () => {
    expect(TG_MOTION.deleteDustMs).toBeGreaterThanOrEqual(300);
    expect(TG_MOTION.deleteDustMs).toBeLessThanOrEqual(400);
    expect(TG_MOTION.sheetMs).toBeGreaterThanOrEqual(150);
    expect(TG_MOTION.sheetMs).toBeLessThanOrEqual(200);
  });

  it("reach the CSS as custom properties with their unit", () => {
    expect(tgMotionVars(["openMs", "openShiftPx", "backCommitShare"])).toEqual({ "--tg-open-ms": "220ms", "--tg-open-shift-px": "24px", "--tg-back-commit-share": "0.5" });
  });
});

describe("«التأثيرات الحركية»", () => {
  const calm = { off: [], reducedMotion: false, economy: false };

  it("everything is on until the person, the device or the company says otherwise", () => {
    for (const key of EFFECT_KEYS) expect(effectAllowed(key, calm), key).toBe(true);
    expect(effectOn("dust")).toBe(true);
    expect(effectAllowed("dust", { ...calm, off: ["dust"] })).toBe(false);
    expect(effectAllowed("particles", { ...calm, off: ["dust"] })).toBe(true);
  });

  it("a request for less motion stops every moving one, not the blur; the saving mode stops the expensive drawing", () => {
    for (const key of EFFECT_KEYS) expect(effectAllowed(key, { ...calm, reducedMotion: true }), key).toBe(key === "blur");
    expect(effectAllowed("blur", { ...calm, economy: true })).toBe(false);
    expect(effectAllowed("dust", { ...calm, economy: true })).toBe(false);
    expect(effectAllowed("transitions", { ...calm, economy: true })).toBe(true);
  });

  it("the device keeps only known names, once each", () => {
    expect(cleanDevicePrefs({ effectsOff: ["dust", "dust", "nope", 4] })).toEqual({ effectsOff: ["dust"] });
    expect(cleanDevicePrefs({ effectsOff: [] })).toEqual({});
    expect(cleanDevicePrefs({ effectsOff: "dust" })).toEqual({});
  });

  it("is on the page before the first paint", () => {
    const attrs: Record<string, string> = {};
    const html = { style: { setProperty() {}, removeProperty() {} }, setAttribute: (k: string, v: string) => (attrs[k] = v), classList: { toggle() {} } };
    vm.runInNewContext(bootScript(), {
      document: { documentElement: html, cookie: "", querySelector: () => null },
      localStorage: { getItem: () => JSON.stringify({ effectsOff: ["dust", "blur"] }) },
      window: {},
    });
    expect(attrs["data-fx-off"]).toBe("dust blur");
  });

  it("every effect has its words", () => {
    for (const key of EFFECT_KEYS) {
      expect(AR[`settingsMe.fx.${key}` as keyof typeof AR], key).toBeTruthy();
      expect(AR[`settingsMe.fx.${key}.hint` as keyof typeof AR], key).toBeTruthy();
    }
  });
});

describe("the switch «tgPhone»", () => {
  it("is ON by default, a part of the new chat screen, and can be switched off", () => {
    expect(FEATURE_DEFAULTS.tgPhone).toBe(true);
    expect(FEATURE_META.tgPhone).toEqual({ group: "chat", dependsOn: ["chatLayoutV2"] });
    expect(AR["features.tgPhone.name"]).toBeTruthy();
  });
});
