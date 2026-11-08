import { describe, expect, it } from "vitest";
import { COLOR_TOKENS, PALETTES, STYLE_TOKENS } from "@/lib/themes/palettes";
import { THEME_KEYS, THEMES, type ThemeKey } from "@/lib/themes/registry";
import {
  darknessOf,
  fromOklab,
  hexTriplet,
  midOf,
  mixOklab,
  planScrub,
  sameWrites,
  scrubAllowed,
  scrubColor,
  scrubSideAt,
  scrubValues,
  settleEnd,
  settleStep,
  themeOfEnd,
  toOklab,
  tripletText,
} from "@/lib/themes/scrub";
import { beginPageScrub, SCRUB_ATTRIBUTE, type ScrubRoot } from "@/components/theme/scrub/page-scrub";
import type { FxGate } from "@/lib/themes/switch-fx";

const DARKS = THEME_KEYS.filter((k) => THEMES[k].dark);
const valuesOf = (plan: ReturnType<typeof planScrub>, t: number) => Object.fromEntries(scrubValues(plan, t));
const paletteTriplets = (key: ThemeKey) => Object.fromEntries(COLOR_TOKENS.map((n) => [`--${n}`, tripletText(hexTriplet(PALETTES[key].colors[n]))]));

describe("the continuous theme: the two ends are exactly the two palettes", () => {
  for (const dark of DARKS) {
    it(`t = 0 is «نهار» and t = 1 is ${dark}, token for token (no round trip through OKLab)`, () => {
      const plan = planScrub(dark);
      const at0 = valuesOf(plan, 0);
      const at1 = valuesOf(plan, 1);
      for (const [name, value] of Object.entries(paletteTriplets("day"))) expect(at0[name], `${name} at 0`).toBe(value);
      for (const [name, value] of Object.entries(paletteTriplets(dark))) expect(at1[name], `${name} at 1`).toBe(value);
    });
  }

  it("the style values (font, radius, shadow) are the light theme's at 0 and the dark theme's at 1", () => {
    const plan = planScrub("islamic-epic");
    for (const name of STYLE_TOKENS) {
      expect(valuesOf(plan, 0)[`--${name}`]).toBe(PALETTES.day.style[name]);
      expect(valuesOf(plan, 1)[`--${name}`]).toBe(PALETTES["islamic-epic"].style[name]);
    }
  });

  it("writes every colour token and every style token, and nothing else", () => {
    const names = scrubValues(planScrub("night"), 0.3).map(([n]) => n);
    expect(names).toEqual([...COLOR_TOKENS.map((n) => `--${n}`), ...STYLE_TOKENS.map((n) => `--${n}`)]);
  });

  it("a light theme given as the dark end falls back to «ليل», and a dark one as the light end to «نهار»", () => {
    expect(planScrub("day").dark).toBe("night");
    expect(planScrub("night", "neon-coast").light).toBe("day");
    expect(themeOfEnd(planScrub("neon-coast"), 1)).toBe("neon-coast");
    expect(themeOfEnd(planScrub("neon-coast"), 0)).toBe("day");
  });
});

describe("the continuous theme: t is clamped and the mix is monotone", () => {
  const plan = planScrub("night");
  it("t below 0 or above 1 (or not a number) is the nearest end", () => {
    expect(scrubValues(plan, -3)).toEqual(scrubValues(plan, 0));
    expect(scrubValues(plan, 7)).toEqual(scrubValues(plan, 1));
    expect(scrubValues(plan, Number.NaN)).toEqual(scrubValues(plan, 0));
    expect(scrubValues(plan, Number.POSITIVE_INFINITY)).toEqual(scrubValues(plan, 0));
  });

  it("every colour's lightness moves from one end to the other and never turns back (to the rounding of 8-bit channels)", () => {
    const steps = Array.from({ length: 41 }, (_, i) => i / 40);
    for (const token of COLOR_TOKENS) {
      const from = toOklab(hexTriplet(PALETTES.day.colors[token])).L;
      const to = toOklab(hexTriplet(PALETTES.night.colors[token])).L;
      const sign = Math.sign(to - from) || 1;
      let prev = from;
      for (const t of steps) {
        const triplet = scrubValues(plan, t).find(([n]) => n === `--${token}`)?.[1] ?? "0 0 0";
        const [r, g, b] = triplet.split(" ").map(Number) as [number, number, number];
        const L = toOklab([r, g, b]).L;
        expect((L - prev) * sign, `${token} at ${t}`).toBeGreaterThan(-0.006);
        prev = L;
      }
    }
  });

  it("half way is a real mid-tone: not either end, and the page surface carries a little warmth (red and yellow) like the reference's brown", () => {
    const mid = valuesOf(plan, 0.5);
    for (const token of ["--surface", "--surface-1", "--fg"] as const) {
      expect(mid[token]).not.toBe(valuesOf(plan, 0)[token]);
      expect(mid[token]).not.toBe(valuesOf(plan, 1)[token]);
    }
    const [r, , b] = (mid["--surface"] as string).split(" ").map(Number) as [number, number, number];
    expect(r).toBeGreaterThan(b); // warmer than a neutral grey
    const plainMix = fromOklab(mixOklab(toOklab(hexTriplet(PALETTES.day.colors.surface)), toOklab(hexTriplet(PALETTES.night.colors.surface)), 0.5));
    expect(plainMix[0] - plainMix[2]).toBeLessThan(r - b); // the bump made it warmer than the plain OKLab mix
  });

  it("the non-colour tokens switch at the middle, not before", () => {
    const epic = planScrub("islamic-epic");
    expect(valuesOf(epic, 0.49)["--radius-card"]).toBe(PALETTES.day.style["radius-card"]);
    expect(valuesOf(epic, 0.5)["--radius-card"]).toBe(PALETTES["islamic-epic"].style["radius-card"]);
    expect(scrubSideAt(epic, 0.49)).toEqual({ theme: "day", dark: false });
    expect(scrubSideAt(epic, 0.5)).toEqual({ theme: "islamic-epic", dark: true });
  });

  it("OKLab round-trips every palette colour to the same 8-bit value", () => {
    for (const key of THEME_KEYS) for (const token of COLOR_TOKENS) {
      const c = hexTriplet(PALETTES[key].colors[token]);
      expect(fromOklab(toOklab(c)), `${key} ${token}`).toEqual(c);
    }
  });

  it("scrubColor returns the very objects at the ends", () => {
    const a = [10, 20, 30] as const;
    const b = [200, 210, 220] as const;
    expect(scrubColor(a, b, 0)).toBe(a);
    expect(scrubColor(a, b, 1)).toBe(b);
    expect(scrubColor(a, b, 0.5)[0]).toBeGreaterThan(10);
  });

  it("sameWrites sees a change of one level and nothing else", () => {
    const a = scrubValues(plan, 0.2);
    expect(sameWrites(a, scrubValues(plan, 0.2))).toBe(true);
    expect(sameWrites(a, scrubValues(plan, 0.8))).toBe(false);
    expect(sameWrites(null, a)).toBe(false);
  });
});

describe("a knob's position and what the page does", () => {
  it("the lamp, the glass, the temperature look and the plain switch are linear: night on the left, day on the right", () => {
    for (const look of ["plain", "glass", "lamp", "warmth"] as const) {
      expect(darknessOf(look, 0)).toBe(1);
      expect(darknessOf(look, 1)).toBe(0);
      expect(darknessOf(look, 0.25)).toBeCloseTo(0.75, 10);
      expect(darknessOf(look, -4)).toBe(1);
      expect(darknessOf(look, 9)).toBe(0);
    }
  });

  it("the sky: midnight is dark, noon is light, monotone in between, and the page is half way where the sky says so", () => {
    expect(darknessOf("sky", 0)).toBe(1);
    expect(darknessOf("sky", 1)).toBe(0);
    let prev = 1;
    for (let i = 0; i <= 100; i++) {
      const d = darknessOf("sky", i / 100);
      expect(d).toBeLessThanOrEqual(prev + 1e-9);
      prev = d;
    }
    const mid = midOf("sky");
    expect(mid).toBeGreaterThan(0.55);
    expect(mid).toBeLessThan(0.7);
    expect(darknessOf("sky", mid)).toBeCloseTo(0.5, 2);
    expect(midOf("lamp")).toBe(0.5);
  });

  it("a release settles on the nearer end of the PAGE: a flick carries it over the middle, the sky's middle is not 0.5", () => {
    expect(settleEnd(0.4, 0)).toBe(0);
    expect(settleEnd(0.6, 0)).toBe(1);
    expect(settleEnd(0.45, 2)).toBe(1); // a quick push toward the day
    expect(settleEnd(0.55, -2)).toBe(0);
    const mid = midOf("sky");
    expect(settleEnd(0.6, 0, mid)).toBe(0); // still on the night side of the sky's page
    expect(settleEnd(mid + 0.03, 0, mid)).toBe(1);
  });
});

describe("the settle after a release: a spring that ends exactly on the end", () => {
  it("reaches either end within about a second at 60 frames a second, with at most a small overshoot, then rests", () => {
    for (const end of [0, 1] as const) {
      let spring = { x: end === 1 ? 0.4 : 0.6, v: 0 };
      let frames = 0;
      let overshoot = 0;
      for (; frames < 240; frames++) {
        const step = settleStep(spring, end, 1000 / 60);
        spring = step.spring;
        overshoot = Math.max(overshoot, end === 1 ? spring.x - 1 : -spring.x);
        if (step.done) break;
      }
      expect(frames, `end ${end}`).toBeLessThan(90);
      expect(overshoot).toBeLessThan(0.08);
    }
  });
});

describe("gating: the engine runs only where effects are allowed", () => {
  const gate = (over: Partial<FxGate>): FxGate => ({ fxOn: true, economy: false, reducedMotion: false, ...over });
  it("on for the feature on and nothing else asked", () => expect(scrubAllowed(gate({}))).toBe(true));
  it("off with the feature off, in «وضع التوفير», or with prefers-reduced-motion", () => {
    expect(scrubAllowed(gate({ fxOn: false }))).toBe(false);
    expect(scrubAllowed(gate({ economy: true }))).toBe(false);
    expect(scrubAllowed(gate({ reducedMotion: true }))).toBe(false);
  });
});

// ── the engine, on a fake <html> ────────────────────────────────────────────

function fakeRoot(initial: Record<string, string> = {}, dark = true) {
  const style = new Map<string, string>(Object.entries(initial));
  const log: string[] = [];
  const attrs = new Map<string, string>();
  let isDark = dark;
  const root: ScrubRoot = {
    style: {
      setProperty: (n, v) => {
        style.set(n, v);
        log.push(`set ${n}`);
      },
      removeProperty: (n) => {
        style.delete(n);
        log.push(`remove ${n}`);
      },
      getPropertyValue: (n) => style.get(n) ?? "",
    },
    classList: {
      toggle: (_t, force) => {
        isDark = force ?? !isDark;
        log.push(`dark ${isDark}`);
        return isDark;
      },
      contains: () => isDark,
    },
    setAttribute: (n, v) => void attrs.set(n, v),
    removeAttribute: (n) => void attrs.delete(n),
  };
  return { root, style, log, attrs, isDark: () => isDark };
}

function frames() {
  const queue: Array<() => void> = [];
  return {
    schedule: (fn: () => void) => queue.push(fn),
    unschedule: () => {
      queue.length = 0;
    },
    tick: () => {
      const run = queue.splice(0);
      for (const fn of run) fn();
    },
    size: () => queue.length,
  };
}

describe("the engine: one write pass per frame, and it leaves nothing behind", () => {
  const plan = planScrub("night");
  const passes = (log: string[]) => log.filter((l) => l === "set --surface").length;

  it("marks <html> while it runs and paints the first position at once", () => {
    const f = fakeRoot();
    const fr = frames();
    const scrub = beginPageScrub(plan, f.root, 0, fr.schedule, fr.unschedule);
    expect(f.attrs.has(SCRUB_ATTRIBUTE)).toBe(true);
    scrub.move(0.5);
    expect(f.style.get("--surface")).toBe(valuesOf(plan, 0.5)["--surface"]);
    expect(scrub.t()).toBe(0.5);
  });

  it("several moves in one frame are ONE write pass; the latest is painted on the next frame", () => {
    const f = fakeRoot();
    const fr = frames();
    const scrub = beginPageScrub(plan, f.root, 0, fr.schedule, fr.unschedule);
    scrub.move(0.1);
    scrub.move(0.2);
    scrub.move(0.3);
    expect(passes(f.log)).toBe(1);
    expect(f.style.get("--surface")).toBe(valuesOf(plan, 0.1)["--surface"]);
    fr.tick();
    expect(passes(f.log)).toBe(2);
    expect(f.style.get("--surface")).toBe(valuesOf(plan, 0.3)["--surface"]);
    fr.tick();
    expect(passes(f.log)).toBe(2); // nothing waiting: no more writes
  });

  it("a position whose numbers did not change writes nothing", () => {
    const f = fakeRoot();
    const fr = frames();
    const scrub = beginPageScrub(plan, f.root, 0, fr.schedule, fr.unschedule);
    scrub.move(0.4);
    fr.tick();
    const before = f.log.length;
    scrub.move(0.4);
    expect(f.log.length).toBe(before);
  });

  it("the dark class and color-scheme follow the middle", () => {
    const f = fakeRoot({}, false);
    const fr = frames();
    const scrub = beginPageScrub(plan, f.root, 0, fr.schedule, fr.unschedule);
    scrub.move(0.3);
    expect(f.isDark()).toBe(false);
    expect(f.style.get("color-scheme")).toBe("light");
    fr.tick();
    scrub.move(0.8);
    expect(f.isDark()).toBe(true);
    expect(f.style.get("color-scheme")).toBe("dark");
  });

  it("commit paints the end exactly, runs the commit, THEN drops every override (so no frame shows the page unthemed)", () => {
    const f = fakeRoot({ "--accent": "1 2 3" });
    const fr = frames();
    const order: string[] = [];
    const scrub = beginPageScrub(plan, f.root, 0, fr.schedule, fr.unschedule);
    scrub.move(0.9);
    scrub.commit(1, () => {
      order.push(`apply with surface ${f.style.get("--surface")}`);
    });
    expect(order).toEqual([`apply with surface ${valuesOf(plan, 1)["--surface"]}`]);
    expect(f.attrs.has(SCRUB_ATTRIBUTE)).toBe(false);
    expect(f.style.has("--surface")).toBe(false);
    expect(f.style.get("--accent")).toBe("1 2 3"); // an inline value that was there before is put back
    expect(f.style.has("color-scheme")).toBe(false);
    expect(scrub.active()).toBe(false);
    expect(fr.size()).toBe(0);
  });

  it("cancel puts everything back: properties, the attribute and the dark class; later moves do nothing", () => {
    const f = fakeRoot({}, false);
    const fr = frames();
    const scrub = beginPageScrub(plan, f.root, 0, fr.schedule, fr.unschedule);
    scrub.move(0.9);
    expect(f.isDark()).toBe(true);
    scrub.cancel();
    expect(f.isDark()).toBe(false);
    expect(f.attrs.has(SCRUB_ATTRIBUTE)).toBe(false);
    expect([...f.style.keys()]).toEqual([]);
    scrub.move(0.2);
    expect([...f.style.keys()]).toEqual([]);
    expect(fr.size()).toBe(0);
  });

  it("a position that is not a number is clamped, never written as NaN", () => {
    const f = fakeRoot();
    const fr = frames();
    const scrub = beginPageScrub(plan, f.root, 0, fr.schedule, fr.unschedule);
    scrub.move(Number.NaN);
    expect([...f.style.values()].some((v) => v.includes("NaN"))).toBe(false);
    expect(scrub.t()).toBe(0);
  });
});

// ── where the code lives (source-text pins: a DOM-less test cannot see a chunk) ─────────────────────

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../src");
const read = (p: string) => readFileSync(path.join(SRC, p), "utf8");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));

describe("the engine stays lazy and the page follows the knob in every look", () => {
  it("page-scrub.ts is reached only through a dynamic import (never a static one: it must not be in a shared chunk)", () => {
    const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f));
    // `import type { ... } from` is erased by the compiler; any other static import of the engine would pull it into the importer's chunk
    const staticValueImports = files.filter((f) => /^import \{[^}]*\} from "[^"]*[/]page-scrub"/m.test(readFileSync(f, "utf8").replace(/^import type .*$/gm, "")));
    expect(staticValueImports.map((f) => path.relative(SRC, f).split(path.sep).join("/"))).toEqual([]);
    expect(read("components/theme/scrub/use-page-scrub.ts")).toMatch(/import\("\.\/page-scrub"\)/);
  });

  it("the top bar's shell code does not import the engine, the hook or the knob kit", () => {
    for (const f of ["components/theme/theme-switch.tsx", "components/theme/use-theme-toggle.ts", "components/theme/switch-fx-provider.tsx", "components/theme/theme-provider.tsx"]) {
      expect(read(f), f).not.toMatch(/scrub\/|fx\/kit|lib\/themes\/scrub/);
    }
    expect(read("components/theme/theme-switch.tsx")).toMatch(/dynamic\(\(\) => import\("\.\/switch-fx\/plain-scrub"\)/);
  });

  it("every look feeds the page from the knob's frames and commits at rest (no look is left on the old flip-at-release)", () => {
    const ctl = read("components/theme/switch-fx/fx-control.tsx");
    for (const look of ["glass", "lamp", "sky", "warmth"]) expect(ctl, look).toContain(`useLook("${look}")`);
    expect(ctl.match(/scrub\.settle\(/g)?.length).toBeGreaterThanOrEqual(4);
    expect(ctl.match(/scrub\.cancel\(\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(ctl).not.toMatch(/preview\(\{ brightness/); // the lamp no longer fakes it with a dimming overlay
    expect(ctl).not.toMatch(/skyIsDay\(/); // the sky no longer flips the theme at 06:00 behind the page's back
    const plain = read("components/theme/switch-fx/plain-scrub.tsx");
    expect(plain).toContain('useLook("plain")');
    expect(plain).toMatch(/grab: "travel"/);
    expect(plain).toMatch(/tap: /);
  });

  it("the knob kit abandons a drag on Escape and on blur, and the engine's transitions rule exists", () => {
    const kit = read("components/theme/fx/kit.ts");
    expect(kit).toMatch(/e\.key === "Escape"/);
    expect(kit).toMatch(/addEventListener\("blur", cancel\)/);
    expect(read("app/globals.css")).toMatch(/html\[data-theme-scrub\] \*[\s\S]*transition: none !important/);
  });
});
