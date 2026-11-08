import { describe, expect, it } from "vitest";
import {
  PARTICLE_CAP,
  SKY_RANGE_MIN,
  clamp01,
  dayBars,
  easeInOutCubic,
  edgeProfile,
  emit,
  followStep,
  formatKelvin,
  kelvinCaption,
  kelvinOf,
  lampStats,
  mixRgb,
  moonCells,
  parseTriplet,
  pixelFrame,
  positionOfKelvin,
  repaintPercent,
  revealEase,
  revealPolygon,
  rgbOf,
  settleTarget,
  shardSeeds,
  skyBodies,
  skyClock,
  skyIsDay,
  skyKeyBlend,
  skyMinute,
  skyMoment,
  skyPosition,
  springDone,
  springStep,
  stepParticles,
  sunCells,
  trackPosition,
  type Particle,
} from "@/lib/themes/switch-motion";

describe("the knob's inertia", () => {
  it("follows the pointer by a share of the distance that does not depend on the frame rate", () => {
    const oneStep = followStep(0, 1, 32, 70);
    let twoSteps = followStep(0, 1, 16, 70);
    twoSteps = followStep(twoSteps, 1, 16, 70);
    expect(oneStep).toBeCloseTo(twoSteps, 6);
    expect(oneStep).toBeGreaterThan(0.3);
    expect(oneStep).toBeLessThan(1);
  });
  it("does not move with no time, and never overshoots while following", () => {
    expect(followStep(0.2, 1, 0)).toBe(0.2);
    expect(followStep(0, 1, 100000)).toBeLessThanOrEqual(1);
  });
  it("settles on the end with a little overshoot, then rests", () => {
    let s = { x: 0.5, v: 0 };
    let peak = 0;
    let steps = 0;
    while (!springDone(s, 1) && steps < 600) {
      s = springStep(s, 1, 16);
      peak = Math.max(peak, s.x);
      steps++;
    }
    expect(springDone(s, 1)).toBe(true);
    expect(steps).toBeLessThan(400);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.08);
  });
  it("a flick carries the knob over the middle, a slow release does not", () => {
    expect(settleTarget(0.45, 0)).toBe(0);
    expect(settleTarget(0.45, 1.5)).toBe(1);
    expect(settleTarget(0.55, -1.5)).toBe(0);
    expect(settleTarget(0.9, 0)).toBe(1);
  });
  it("clamps and eases inside 0..1", () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
  });
});

describe("colours", () => {
  it("reads the generated `R G B` tokens and refuses anything else", () => {
    expect(parseTriplet("255 201 74")).toEqual([255, 201, 74]);
    expect(parseTriplet(" 0 0 0 ")).toEqual([0, 0, 0]);
    expect(parseTriplet("#FFC94A")).toBeNull();
    expect(parseTriplet("300 1 1")).toBeNull();
  });
  it("mixes and writes them", () => {
    expect(mixRgb([0, 0, 0], [100, 200, 50], 0.5)).toEqual([50, 100, 25]);
    expect(mixRgb([10, 10, 10], [20, 20, 20], 2)).toEqual([20, 20, 20]);
    expect(rgbOf([1, 2, 3], 0.5)).toBe("rgb(1 2 3 / 0.5)");
  });
});

describe("colour temperature", () => {
  it("runs from 10,500 K at the moon to 2,100 K at the sun", () => {
    expect(kelvinOf(0)).toBe(10500);
    expect(kelvinOf(1)).toBe(2100);
    expect(kelvinOf(0.5)).toBe(6300);
    expect(kelvinOf(-4)).toBe(10500);
    expect(kelvinOf(9)).toBe(2100);
  });
  it("round-trips through a position", () => {
    for (const k of [10500, 9300, 5900, 3800, 2100]) expect(kelvinOf(positionOfKelvin(k))).toBe(k);
  });
  it("names the three captions the way the reference does", () => {
    expect(kelvinCaption(10100)).toBe("cool");
    expect(kelvinCaption(7600)).toBe("cool");
    expect(kelvinCaption(5900)).toBe("neutral");
    expect(kelvinCaption(3800)).toBe("warm");
    expect(kelvinCaption(3300)).toBe("warm");
  });
  it("writes the number with a comma", () => {
    expect(formatKelvin(5900)).toBe("5,900 K");
    expect(formatKelvin(10500)).toBe("10,500 K");
    expect(formatKelvin(950)).toBe("950 K");
  });
});

describe("the lamp", () => {
  it("matches the readings of the reference at its ends", () => {
    expect(lampStats(0)).toEqual({ pct: 0, lux: 221, kelvin: 7800 });
    expect(lampStats(1)).toEqual({ pct: 100, lux: 738, kelvin: 2900 });
  });
  it("is in between at 32% (the reference shows 427 lux and about 6,200 K)", () => {
    const s = lampStats(0.32);
    expect(s.pct).toBe(32);
    expect(Math.abs(s.lux - 427)).toBeLessThan(15);
    expect(Math.abs(s.kelvin - 6200)).toBeLessThan(300);
  });
  it("only ever gets brighter and warmer as the knob goes up", () => {
    let last = lampStats(0);
    for (let i = 1; i <= 20; i++) {
      const s = lampStats(i / 20);
      expect(s.lux).toBeGreaterThanOrEqual(last.lux);
      expect(s.kelvin).toBeLessThanOrEqual(last.kelvin);
      last = s;
    }
  });
  it("draws 24 bars with a bell at noon and a floor at night", () => {
    const bars = dayBars();
    expect(bars).toHaveLength(24);
    expect(bars[12]).toBe(Math.max(...bars));
    expect(bars[2]).toBeLessThan(0.1);
    expect(bars.every((b) => b > 0 && b <= 1)).toBe(true);
  });
});

describe("the sky", () => {
  it("is a 12-hour scrub", () => {
    expect(SKY_RANGE_MIN).toBe(720);
    expect(skyMinute(0)).toBe(0);
    expect(skyMinute(1)).toBe(720);
    expect(skyMinute(2)).toBe(720);
    expect(skyPosition(360)).toBe(0.5);
  });
  it("names the five moments at the times the reference shows them", () => {
    expect(skyMoment(0)).toBe("midnight");
    expect(skyMoment(14)).toBe("midnight");
    expect(skyMoment(87)).toBe("moonset");
    expect(skyMoment(203)).toBe("moonset");
    expect(skyMoment(336)).toBe("goldenhour");
    expect(skyMoment(483)).toBe("morning");
    expect(skyMoment(621)).toBe("morning");
    expect(skyMoment(692)).toBe("noon");
    expect(skyMoment(720)).toBe("noon");
  });
  it("writes the clock like the caption", () => {
    expect(skyClock(0)).toBe("00:00");
    expect(skyClock(336)).toBe("05:36");
    expect(skyClock(720)).toBe("12:00");
    expect(skyClock(5000)).toBe("12:00");
  });
  it("blends between neighbouring key frames and ends on the last", () => {
    expect(skyKeyBlend(0)).toEqual({ from: 0, to: 1, t: 0 });
    expect(skyKeyBlend(720)).toEqual({ from: 4, to: 5, t: 1 });
    const mid = skyKeyBlend(268);
    expect(mid.from).toBe(1);
    expect(mid.to).toBe(2);
    expect(mid.t).toBeCloseTo(0.5, 1);
  });
  it("shows the moon and the stars at midnight, the sun and the clouds at noon", () => {
    const night = skyBodies(0);
    const noon = skyBodies(720);
    expect(night.moon.alpha).toBe(1);
    expect(night.stars).toBe(1);
    expect(night.sun.alpha).toBe(0);
    expect(night.day).toBe(0);
    expect(noon.sun.alpha).toBe(1);
    expect(noon.moon.alpha).toBe(0);
    expect(noon.stars).toBe(0);
    expect(noon.day).toBe(1);
    expect(noon.sun.x).toBeGreaterThan(0.8);
    expect(noon.sun.y).toBeLessThan(0.3);
  });
  it("flips the product's theme at 06:00", () => {
    expect(skyIsDay(359)).toBe(false);
    expect(skyIsDay(360)).toBe(true);
  });
});

describe("the pixel icon", () => {
  it("has a sun with rays and a crescent with sparkles, and they are different", () => {
    const sun = sunCells();
    const moon = moonCells();
    expect(sun.length).toBeGreaterThan(20);
    expect(moon.length).toBeGreaterThan(20);
    expect(sun.some((c) => c.x === 7 && c.y === 7)).toBe(true);
    expect(JSON.stringify(sun)).not.toBe(JSON.stringify(moon));
  });
  it("is the whole sun at 0 and the whole moon at 1", () => {
    const sunFrame = pixelFrame(0);
    const moonFrame = pixelFrame(1);
    expect(sunFrame.length).toBe(sunCells().length);
    expect(moonFrame.length).toBe(moonCells().length);
    expect(sunFrame.every((c) => c.alpha === 1 && c.dx === 0 && c.dy === 0)).toBe(true);
  });
  it("scatters in between and is repeatable", () => {
    const mid = pixelFrame(0.5);
    expect(mid.some((c) => c.dx !== 0 || c.dy !== 0)).toBe(true);
    expect(JSON.stringify(pixelFrame(0.5))).toBe(JSON.stringify(mid));
  });
});

describe("particles", () => {
  const make = (life: number): Particle => ({ x: 0, y: 0, vx: 100, vy: 0, life, max: life, size: 2, kind: 0 });
  it("never holds more than the cap", () => {
    const list: Particle[] = [];
    for (let i = 0; i < PARTICLE_CAP * 3; i++) emit(list, make(1));
    expect(list.length).toBe(PARTICLE_CAP);
    expect(PARTICLE_CAP).toBeLessThanOrEqual(120);
  });
  it("moves them, slows them down, and drops the dead ones", () => {
    const list = [make(0.05), make(1)];
    stepParticles(list, 40);
    expect(list).toHaveLength(2);
    expect(list[1]?.x).toBeGreaterThan(0);
    expect(list[1]?.vx).toBeLessThan(100);
    stepParticles(list, 40);
    expect(list).toHaveLength(1);
  });
});

describe("the torn reveal", () => {
  it("has the same number of vertices at every radius (so clip-path can animate)", () => {
    const count = (s: string) => s.split(",").length;
    for (const look of ["shards", "ink"] as const) expect(count(revealPolygon(5, 5, 0, look, 3))).toBe(count(revealPolygon(5, 5, 900, look, 3)));
  });
  it("is repeatable and differs between seeds", () => {
    expect(revealPolygon(1, 2, 300, "shards", 4)).toBe(revealPolygon(1, 2, 300, "shards", 4));
    expect(revealPolygon(1, 2, 300, "shards", 4)).not.toBe(revealPolygon(1, 2, 300, "shards", 5));
  });
  it("is spikier for the shards than for the ink", () => {
    const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    expect(spread(edgeProfile(72, 9, 0.42, 1))).toBeGreaterThan(spread(edgeProfile(72, 9, 0.1, 5)));
  });
  it("repaints the way the reference reads: 1% at 0.5 s, 16% at 1.0 s, 59% at 1.5 s, 96% at 2.0 s of 2.2 s", () => {
    expect(revealEase(0)).toBe(0);
    expect(revealEase(1)).toBeCloseTo(1, 6);
    const at = (s: number) => Math.round(revealEase(s / 2.2) * 100);
    expect(Math.abs(at(0.5) - 1)).toBeLessThanOrEqual(4);
    expect(Math.abs(at(1.0) - 16)).toBeLessThanOrEqual(8);
    expect(Math.abs(at(1.5) - 59)).toBeLessThanOrEqual(8);
    expect(Math.abs(at(2.0) - 96)).toBeLessThanOrEqual(6);
    expect(revealEase(0.3, "ink")).toBeGreaterThan(0.5);
    expect(revealEase(1, "ink")).toBe(1);
    expect(repaintPercent(0)).toBe(0);
    expect(repaintPercent(0.455)).toBe(46);
    expect(repaintPercent(3)).toBe(100);
  });
  it("makes a bounded set of shards from a seed", () => {
    expect(shardSeeds(500, 1)).toHaveLength(40);
    expect(shardSeeds(8, 1)).toEqual(shardSeeds(8, 1));
    expect(shardSeeds(-3, 1)).toHaveLength(0);
  });
});

describe("the track", () => {
  it("reads a pointer along a left-to-right track", () => {
    expect(trackPosition(150, 100, 200)).toBe(0.25);
    expect(trackPosition(0, 100, 200)).toBe(0);
    expect(trackPosition(900, 100, 200)).toBe(1);
    expect(trackPosition(5, 0, 0)).toBe(0);
  });
});

describe("the keys of the left-to-right tracks", () => {
  it("toward the sun is 1, toward the moon is 0, the rest is not the track's", async () => {
    const { endForKey } = await import("@/lib/themes/switch-motion");
    expect(endForKey("ArrowRight")).toBe(1);
    expect(endForKey("End")).toBe(1);
    expect(endForKey("ArrowUp")).toBe(1);
    expect(endForKey("ArrowLeft")).toBe(0);
    expect(endForKey("Home")).toBe(0);
    expect(endForKey("ArrowDown")).toBe(0);
    expect(endForKey("Enter")).toBeNull();
    expect(endForKey(" ")).toBeNull();
    expect(endForKey("a")).toBeNull();
  });
});
