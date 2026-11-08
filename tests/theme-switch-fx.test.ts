import { describe, expect, it } from "vitest";
import {
  BRIGHTNESS_MAX,
  BRIGHTNESS_MIN,
  DAY_END,
  DAY_START,
  DEFAULT_SWITCH_PREF,
  MAX_PARTICLES,
  SWITCH_COOKIE,
  SWITCH_STYLES,
  arrowToDark,
  bodyArcs,
  brightnessOfPosition,
  clockOf,
  positionOfBrightness,
  positionOfWarmth,
  warmthOfPosition,
  clampBrightness,
  clampWarmth,
  effectiveStyle,
  glassAllowed,
  isDayMinute,
  minuteForTheme,
  minuteOf,
  motionAllowed,
  parseSwitchPref,
  particleBudget,
  pFromPointer,
  raggedCircle,
  sceneBlend,
  serializeSwitchPref,
  skyPhase,
  sliderStep,
  sparkSeeds,
  themeForMinute,
  tintOf,
  tintStyle,
  type FxGate,
} from "@/lib/themes/switch-fx";
import { FEATURES, FEATURE_DEFAULTS } from "@/lib/features";
import { AR } from "@/lib/i18n/dict";

const open: FxGate = { fxOn: true, economy: false, reducedMotion: false };

describe("the stored choice: style, brightness, warmth and the dark theme to come back to", () => {
  it("defaults to the plain switch, full brightness, no warmth, «ليل»", () => {
    expect(DEFAULT_SWITCH_PREF).toEqual({ style: "plain", brightness: 100, warmth: 0, dark: "night" });
    expect(SWITCH_STYLES).toEqual(["plain", "glass", "lamp", "sky", "warmth"]);
    expect(SWITCH_COOKIE).toBe("zk-switch");
  });

  it("round-trips through its compact text (cookie-safe characters only)", () => {
    const pref = { style: "warmth", brightness: 70, warmth: -35, dark: "neon-coast" } as const;
    const text = serializeSwitchPref(pref);
    expect(text).toBe("warmth.70.-35.neon-coast");
    expect(text).toMatch(/^[a-z0-9.-]+$/);
    expect(parseSwitchPref(text)).toEqual(pref);
  });

  it("anything unknown, broken or hostile becomes the default instead of throwing", () => {
    for (const raw of [undefined, null, "", "x", 7, {}, "lamp", "lamp.1.2", "evil.50.0.night", "lamp.50.0.day.extra;drop", "<script>"]) {
      expect(parseSwitchPref(raw), JSON.stringify(raw)).toEqual(DEFAULT_SWITCH_PREF);
    }
  });

  it("clamps the numbers instead of refusing them, and a light theme is never the «dark» to come back to", () => {
    expect(parseSwitchPref("lamp.5.0.night").brightness).toBe(BRIGHTNESS_MIN);
    expect(parseSwitchPref("lamp.999.0.night").brightness).toBe(BRIGHTNESS_MAX);
    expect(parseSwitchPref("warmth.100.-500.night").warmth).toBe(-100);
    expect(parseSwitchPref("warmth.100.500.night").warmth).toBe(100);
    expect(parseSwitchPref("glass.100.0.day").dark).toBe("night");
    expect(clampBrightness(Number.NaN)).toBe(100);
    expect(clampWarmth(Number.NaN)).toBe(0);
    expect(clampWarmth(12.6)).toBe(13);
  });
});

describe("the tint laid over the app: gentle, capped, and only for its own style", () => {
  it("is nothing at full brightness / zero warmth, whatever the style", () => {
    for (const style of SWITCH_STYLES) expect(tintStyle({ ...DEFAULT_SWITCH_PREF, style })).toBeUndefined();
  });

  it("lamp dims (never darker than the cap), and warmth is ignored by the lamp", () => {
    const lamp = { ...DEFAULT_SWITCH_PREF, style: "lamp", brightness: BRIGHTNESS_MIN, warmth: 80 } as const;
    expect(tintOf(lamp).dim).toBeGreaterThan(0.3);
    expect(tintOf(lamp).dim).toBeLessThanOrEqual(0.4);
    expect(tintOf(lamp).warm).toBe(0);
    expect(tintOf(lamp).cool).toBe(0);
  });

  it("warmth tints warm above zero and cool below, never both, and brightness is ignored", () => {
    const warm = tintOf({ ...DEFAULT_SWITCH_PREF, style: "warmth", warmth: 100, brightness: 40 });
    expect(warm.warm).toBeGreaterThan(0);
    expect(warm.warm).toBeLessThanOrEqual(0.2);
    expect(warm.cool).toBe(0);
    expect(warm.dim).toBe(0);
    const cool = tintOf({ ...DEFAULT_SWITCH_PREF, style: "warmth", warmth: -100 });
    expect(cool.cool).toBeGreaterThan(0);
    expect(cool.warm).toBe(0);
  });

  it("the plain, glass and sky styles never tint, even with numbers stored from an earlier style", () => {
    for (const style of ["plain", "glass", "sky"] as const) {
      expect(tintStyle({ style, brightness: 40, warmth: 100, dark: "night" }), style).toBeUndefined();
    }
  });

  it("is written as CSS variables the overlay reads", () => {
    const style = tintStyle({ style: "lamp", brightness: 70, warmth: 0, dark: "night" });
    expect(Object.keys(style ?? {}).sort()).toEqual(["--zk-cool", "--zk-dim", "--zk-warm"]);
    expect(Number(style?.["--zk-dim"])).toBeCloseTo(0.18, 2);
  });
});

describe("the sky: time of day <-> light/dark theme", () => {
  it("day is 06:00 up to 18:00, everything else is dark", () => {
    expect([DAY_START, DAY_END]).toEqual([360, 1080]);
    expect(isDayMinute(359)).toBe(false);
    expect(isDayMinute(360)).toBe(true);
    expect(isDayMinute(1079)).toBe(true);
    expect(isDayMinute(1080)).toBe(false);
    expect(isDayMinute(0)).toBe(false);
  });

  it("maps a minute to «نهار» or the person's own dark theme", () => {
    expect(themeForMinute(720, "islamic-epic")).toBe("day");
    expect(themeForMinute(30, "islamic-epic")).toBe("islamic-epic");
    expect(themeForMinute(1200, "night")).toBe("night");
  });

  it("a theme rests at noon (light) or midnight (dark)", () => {
    expect(minuteForTheme("day")).toBe(720);
    for (const theme of ["night", "islamic-epic", "neon-coast"] as const) expect(minuteForTheme(theme)).toBe(0);
  });

  it("a drag position 0..1 becomes a minute and never leaves the day", () => {
    expect(minuteOf(0)).toBe(0);
    expect(minuteOf(0.5)).toBe(720);
    expect(minuteOf(1)).toBe(1439);
    expect(minuteOf(-3)).toBe(0);
    expect(minuteOf(9)).toBe(1439);
    expect(minuteOf(Number.NaN)).toBe(0);
  });

  it("names the time of day, and the names agree with the theme threshold", () => {
    expect(skyPhase(0)).toBe("midnight");
    expect(skyPhase(300)).toBe("dawn");
    expect(skyPhase(480)).toBe("morning");
    expect(skyPhase(720)).toBe("noon");
    expect(skyPhase(900)).toBe("afternoon");
    expect(skyPhase(1050)).toBe("sunset");
    expect(skyPhase(1200)).toBe("night");
    expect(skyPhase(1439)).toBe("midnight");
    for (let m = 0; m < 1440; m++) {
      const phase = skyPhase(m);
      const dayPhase = phase === "morning" || phase === "noon" || phase === "afternoon" || phase === "sunset";
      expect(dayPhase, `${m} ${phase}`).toBe(isDayMinute(m));
      expect(AR[`themeSwitch.sky.${phase}`], phase).toMatch(/[؀-ۿ]/);
    }
  });

  it("the scene blends from night (0) to day (1) smoothly around dawn and dusk", () => {
    expect(sceneBlend(0)).toBe(0);
    expect(sceneBlend(720)).toBe(1);
    expect(sceneBlend(1439)).toBe(0);
    const dawn = [330, 345, 360, 375, 390].map(sceneBlend);
    expect([...dawn].sort((a, b) => a - b)).toEqual(dawn);
    expect(dawn[0]).toBe(0);
    expect(dawn[4]).toBe(1);
  });

  it("the sun is up by day and the moon by night, each inside the window", () => {
    const noon = bodyArcs(720);
    expect(noon.sun.visible).toBe(true);
    expect(noon.moon.visible).toBe(false);
    const midnight = bodyArcs(0);
    expect(midnight.sun.visible).toBe(false);
    expect(midnight.moon.visible).toBe(true);
    for (let m = 0; m < 1440; m += 30) {
      const { sun, moon } = bodyArcs(m);
      for (const b of [sun, moon]) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x).toBeLessThanOrEqual(100);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("a pointer on a track: position follows the reading direction", () => {
  const rect = { left: 100, right: 300, width: 200 };
  it("left-to-right: the left edge is 0", () => {
    expect(pFromPointer(100, rect, "ltr")).toBe(0);
    expect(pFromPointer(200, rect, "ltr")).toBe(0.5);
    expect(pFromPointer(300, rect, "ltr")).toBe(1);
  });
  it("right-to-left (this app): the right edge is 0", () => {
    expect(pFromPointer(300, rect, "rtl")).toBe(0);
    expect(pFromPointer(250, rect, "rtl")).toBe(0.25);
    expect(pFromPointer(100, rect, "rtl")).toBe(1);
  });
  it("is clamped and survives a zero-width track", () => {
    expect(pFromPointer(-50, rect, "ltr")).toBe(0);
    expect(pFromPointer(900, rect, "ltr")).toBe(1);
    expect(pFromPointer(10, { left: 0, right: 0, width: 0 }, "rtl")).toBe(0);
  });
});

describe("the keyboard (RTL: the end of the line is on the left)", () => {
  it("a switch: the arrow toward the end turns it on (dark), the other off; Home and End are the two ends", () => {
    expect(arrowToDark("ArrowLeft", "rtl")).toBe(true);
    expect(arrowToDark("ArrowRight", "rtl")).toBe(false);
    expect(arrowToDark("ArrowRight", "ltr")).toBe(true);
    expect(arrowToDark("ArrowLeft", "ltr")).toBe(false);
    expect(arrowToDark("Home", "rtl")).toBe(false);
    expect(arrowToDark("End", "rtl")).toBe(true);
    expect(arrowToDark("a", "rtl")).toBeNull();
    expect(arrowToDark("Enter", "rtl")).toBeNull(); // Enter and Space are the button's own click
  });

  const range = { min: 40, max: 100, step: 5, big: 20 };
  it("a slider: up and the arrow toward the end increase, the other decrease", () => {
    expect(sliderStep("ArrowLeft", 60, range, "rtl")).toBe(65);
    expect(sliderStep("ArrowRight", 60, range, "rtl")).toBe(55);
    expect(sliderStep("ArrowRight", 60, range, "ltr")).toBe(65);
    expect(sliderStep("ArrowUp", 60, range, "rtl")).toBe(65);
    expect(sliderStep("ArrowDown", 60, range, "rtl")).toBe(55);
    expect(sliderStep("PageUp", 60, range, "rtl")).toBe(80);
    expect(sliderStep("PageDown", 60, range, "rtl")).toBe(40);
    expect(sliderStep("Home", 60, range, "rtl")).toBe(40);
    expect(sliderStep("End", 60, range, "rtl")).toBe(100);
  });
  it("a slider never leaves its range, and ignores other keys", () => {
    expect(sliderStep("ArrowLeft", 100, range, "rtl")).toBe(100);
    expect(sliderStep("ArrowRight", 40, range, "rtl")).toBe(40);
    expect(sliderStep("Tab", 60, range, "rtl")).toBeNull();
  });
});

describe("gating: the feature switch, «وضع التوفير» and prefers-reduced-motion", () => {
  it("the feature OFF: only the plain switch, whatever was chosen", () => {
    for (const style of SWITCH_STYLES) expect(effectiveStyle(style, { ...open, fxOn: false })).toBe("plain");
    for (const style of SWITCH_STYLES) expect(effectiveStyle(style, open)).toBe(style);
  });

  it("motion needs the feature on, economy off and no reduced-motion request", () => {
    expect(motionAllowed(open)).toBe(true);
    expect(motionAllowed({ ...open, fxOn: false })).toBe(false);
    expect(motionAllowed({ ...open, economy: true })).toBe(false);
    expect(motionAllowed({ ...open, reducedMotion: true })).toBe(false);
  });

  it("particles: capped at 60, and none without motion", () => {
    expect(MAX_PARTICLES).toBeLessThanOrEqual(60);
    expect(particleBudget(open, 10)).toBe(10);
    expect(particleBudget(open, 5000)).toBe(MAX_PARTICLES);
    expect(particleBudget(open, -4)).toBe(0);
    expect(particleBudget({ ...open, economy: true }, 40)).toBe(0);
    expect(particleBudget({ ...open, reducedMotion: true }, 40)).toBe(0);
    expect(particleBudget({ ...open, fxOn: false }, 40)).toBe(0);
    expect(sparkSeeds(5000, 7)).toHaveLength(MAX_PARTICLES);
    expect(sparkSeeds(0, 7)).toEqual([]);
  });

  it("the glass is real only on a Chromium engine with motion allowed; everywhere else it is the flat knob", () => {
    expect(glassAllowed(open, true)).toBe(true);
    expect(glassAllowed(open, false)).toBe(false);
    expect(glassAllowed({ ...open, economy: true }, true)).toBe(false);
    expect(glassAllowed({ ...open, reducedMotion: true }, true)).toBe(false);
  });

  it("spark seeds are deterministic for a seed (a test, and no Math.random in a render)", () => {
    expect(sparkSeeds(12, 3)).toEqual(sparkSeeds(12, 3));
    expect(sparkSeeds(12, 3)).not.toEqual(sparkSeeds(12, 4));
  });
});

describe("the ragged reveal: a circle with a torn edge that grows from the pointer", () => {
  it("has the same number of points at every size, so the browser can animate between them", () => {
    const count = (s: string) => s.split(",").length;
    expect(count(raggedCircle(50, 40, 0))).toBe(count(raggedCircle(50, 40, 900)));
    expect(raggedCircle(50, 40, 10)).toMatch(/^polygon\(/);
  });

  it("is deterministic and never reaches farther than its jitter allows", () => {
    expect(raggedCircle(10, 10, 100, 24, 5)).toBe(raggedCircle(10, 10, 100, 24, 5));
    const pts = raggedCircle(0, 0, 100, 24, 5)
      .slice(8, -1)
      .split(",")
      .map((p) => p.trim().split(" ").map((v) => parseFloat(v)));
    for (const [x, y] of pts) {
      const d = Math.hypot(x as number, y as number);
      expect(d).toBeGreaterThanOrEqual(84);
      expect(d).toBeLessThanOrEqual(116);
    }
  });

  it("at radius 0 every point is the centre", () => {
    const body = raggedCircle(7, 9, 0, 6).slice(8, -1);
    for (const p of body.split(",")) expect(p.trim()).toBe("7px 9px");
  });
});

describe("the feature switch", () => {
  it("themeSwitchFx is a key, ON by default, and has its Arabic name and hint with the warning and the fix", () => {
    expect(FEATURES).toContain("themeSwitchFx");
    expect(FEATURE_DEFAULTS.themeSwitchFx).toBe(true);
    expect(AR["features.themeSwitchFx.name"]).toMatch(/[؀-ۿ]/);
    expect(AR["features.themeSwitchFx.hint"]).toContain("⚠️");
    expect(AR["features.themeSwitchFx.hint"]).toContain("🔧");
  });
});

describe("track positions <-> values", () => {
  it("brightness: the ends are 40 and 100, the top snaps to 100 and the round trip holds", () => {
    expect(brightnessOfPosition(0)).toBe(40);
    expect(brightnessOfPosition(1)).toBe(100);
    expect(brightnessOfPosition(0.99)).toBe(100);
    expect(brightnessOfPosition(0.5)).toBe(70);
    expect(brightnessOfPosition(-4)).toBe(40);
    expect(positionOfBrightness(40)).toBe(0);
    expect(positionOfBrightness(100)).toBe(1);
    expect(positionOfBrightness(70)).toBe(0.5);
    for (const b of [40, 55, 70, 85, 100]) expect(brightnessOfPosition(positionOfBrightness(b))).toBe(b);
  });

  it("warmth: -100 .. 100, the middle is a sticky zero, and the round trip holds", () => {
    expect(warmthOfPosition(0)).toBe(-100);
    expect(warmthOfPosition(1)).toBe(100);
    expect(warmthOfPosition(0.5)).toBe(0);
    expect(warmthOfPosition(0.52)).toBe(0);
    expect(warmthOfPosition(0.75)).toBe(50);
    expect(positionOfWarmth(-100)).toBe(0);
    expect(positionOfWarmth(0)).toBe(0.5);
    expect(positionOfWarmth(100)).toBe(1);
    for (const w of [-100, -50, 20, 100]) expect(warmthOfPosition(positionOfWarmth(w))).toBe(w);
  });

  it("the sky's clock", () => {
    expect(clockOf(0)).toBe("00:00");
    expect(clockOf(6)).toBe("00:06");
    expect(clockOf(485)).toBe("08:05");
    expect(clockOf(1439)).toBe("23:59");
  });
});
