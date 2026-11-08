import * as React from "react";
import { createElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

(globalThis as { React?: typeof React }).React = React;

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import { FxControl } from "@/components/theme/switch-fx/fx-control";
import { SwitchFxProvider } from "@/components/theme/switch-fx-provider";
import { SwitchStylePicker } from "@/components/theme/switch-style-picker";
import { ThemePicker } from "@/components/theme/theme-picker";
import { PlainSwitch, ThemeSwitch } from "@/components/theme/theme-switch";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { SWITCH_STYLES } from "@/lib/themes/switch-fx";
import { PALETTE_COLOUR, PHYSICAL_UTILITY, classTokens, textOf } from "./ui-render";

const ROOT = path.resolve(__dirname, "..");
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Themes = ThemeProvider as unknown as FunctionComponent<{ initialTheme?: string; children?: ReactNode }>;
const Fx = SwitchFxProvider as unknown as FunctionComponent<{ initial?: string; enabled: boolean; economy?: boolean; children?: ReactNode }>;

function render(element: ReactElement, opts: { theme?: string; pref?: string; enabled?: boolean; economy?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(
      Translations,
      { initial: "ar" },
      createElement(Themes, { initialTheme: opts.theme ?? "night" }, createElement(Fx, { initial: opts.pref, enabled: opts.enabled ?? true, economy: opts.economy ?? false }, element)),
    ),
  );
}

const attr = (html: string, name: string) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, "g"))].map((m) => m[1]);

describe("the plain switch: the default, compact and accessible", () => {
  it("is a role=switch button named in Arabic, checked while a dark theme is painted", () => {
    const night = render(createElement(PlainSwitch), { theme: "night" });
    expect(night).toMatch(/<button[^>]*role="switch"/);
    expect(attr(night, "aria-checked")).toEqual(["true"]);
    expect(attr(night, "aria-label")).toEqual([AR["themeSwitch.aria"]]);
    expect(render(createElement(PlainSwitch), { theme: "day" })).toContain('aria-checked="false"');
  });

  it("every dark theme counts as checked, so the switch never claims «نهار» on «إسلامي ملحمي» or «ساحل النيون»", () => {
    for (const theme of ["night", "islamic-epic", "neon-coast"]) expect(attr(render(createElement(PlainSwitch), { theme }), "aria-checked"), theme).toEqual(["true"]);
  });

  it("is one 44px target, with a title that says what the press does", () => {
    const night = render(createElement(PlainSwitch), { theme: "night" });
    expect(night).toMatch(/<button[^>]*class="[^"]*\bmin-h-11\b[^"]*\bmin-w-11\b/);
    expect(attr(night, "title")).toEqual([AR["themeSwitch.toggle_to_day"]]);
    expect(attr(render(createElement(PlainSwitch), { theme: "day" }), "title")).toEqual([AR["themeSwitch.toggle_to_dark"]]);
  });

  it("is right-to-left correct: the knob's travel is mirrored by a variant, and no class is a physical direction", () => {
    const html = render(createElement(PlainSwitch), { theme: "night" });
    expect(html).toContain("rtl:-translate-x-[18px]");
    const tokens = classTokens(html);
    expect(tokens.filter((c) => PHYSICAL_UTILITY.test(c.split(":").pop() as string))).toEqual([]);
  });

  it("uses theme tokens only and prints no Latin word", () => {
    const html = render(createElement(PlainSwitch));
    expect(classTokens(html).filter((c) => PALETTE_COLOUR.test(c))).toEqual([]);
    expect(textOf(html)).not.toMatch(/[A-Za-z]{2,}/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgba?\(\s*\d/);
  });
});

describe("the top bar's switch follows the feature switch and the person's choice", () => {
  it("the feature OFF: the plain switch, whatever look was chosen, and no tint layer", () => {
    for (const style of SWITCH_STYLES) {
      const html = render(createElement(ThemeSwitch), { pref: `${style}.60.40.night`, enabled: false });
      expect(html, style).toContain('role="switch"');
      expect(html, style).not.toContain('role="slider"');
      expect(html, style).not.toContain("data-zk-tint");
    }
  });

  it("the default look is the plain switch, and while a chosen look's code loads the plain switch holds its place (never a blank bar)", () => {
    expect(render(createElement(ThemeSwitch), { pref: undefined })).toContain('role="switch"');
    expect(render(createElement(ThemeSwitch), { pref: "lamp.60.0.night" })).toContain('role="switch"');
  });
});

describe("the tint layer: drawn from the server's first frame, only for the lamp and warmth", () => {
  const layer = (html: string) => /<div[^>]*data-zk-tint[^>]*>/.exec(html)?.[0];

  it("has no opacity set when there is nothing to draw (the plain switch, the glass and the sky never tint, whatever numbers an earlier look left)", () => {
    for (const style of ["plain", "glass", "sky"]) {
      const tag = layer(render(createElement(PlainSwitch), { pref: `${style}.40.100.night` }));
      expect(tag, style).toBeDefined();
      expect(tag, style).not.toContain("--zk-");
    }
  });

  it("carries the lamp's dim from the cookie in its very first paint, aria-hidden and click-through", () => {
    const tag = layer(render(createElement(PlainSwitch), { pref: "lamp.70.0.night" })) as string;
    expect(tag).toContain('aria-hidden="true"');
    expect(tag).toMatch(/--zk-dim:0\.18/);
    expect(tag).not.toContain("--zk-warm:0.");
  });

  it("carries warm for a warm choice and cool for a cool one", () => {
    expect(layer(render(createElement(PlainSwitch), { pref: "warmth.100.100.night" }))).toMatch(/--zk-warm:0\.18/);
    expect(layer(render(createElement(PlainSwitch), { pref: "warmth.100.-100.night" }))).toMatch(/--zk-cool:0\.14/);
  });

  it("a broken cookie draws nothing", () => {
    expect(layer(render(createElement(PlainSwitch), { pref: "<script>alert(1)</script>" }))).not.toContain("--zk-dim");
  });
});

describe("the four looks (the lazy chunk's controls)", () => {
  const look = (style: "plain" | "glass" | "lamp" | "sky" | "warmth", pref = `${style}.100.0.night`, theme = "night", size: "bar" | "preview" = "bar") =>
    render(createElement(FxControl, { style, size }), { pref, theme });

  it("glass: a role=switch, checked on a dark theme", () => {
    const html = look("glass");
    expect(html).toMatch(/<button[^>]*role="switch"[^>]*/);
    expect(html).toContain('aria-checked="true"');
    expect(look("glass", "glass.100.0.night", "day")).toContain('aria-checked="false"');
    expect(attr(html, "aria-label")).toEqual([AR["themeSwitch.aria"]]);
  });

  it("lamp: a slider 0..100 (the knob's % ) that rests at 0 on a dark theme and 100 on «نهار», and reads its value aloud in Arabic", () => {
    const dark = look("lamp");
    expect(dark).toContain('role="slider"');
    expect(attr(dark, "aria-valuemin")).toEqual(["0"]);
    expect(attr(dark, "aria-valuemax")).toEqual(["100"]);
    expect(attr(dark, "aria-valuenow")).toEqual(["0"]);
    const day = look("lamp", "lamp.100.0.night", "day");
    expect(attr(day, "aria-valuenow")).toEqual(["100"]);
    expect(attr(day, "aria-valuetext")).toEqual([AR["themeSwitch.lamp.value"]?.replace("{value}", "100")]);
    expect(dark).toContain('tabindex="0"');
  });

  it("sky: a slider over the 12 hours 00:00 .. 12:00 that rests at midnight on a dark theme and at noon on «نهار», named by the moment", () => {
    const dark = look("sky");
    expect(dark).toContain('role="slider"');
    expect(attr(dark, "aria-valuemax")).toEqual(["720"]);
    expect(attr(dark, "aria-valuenow")).toEqual(["0"]);
    expect(attr(dark, "aria-valuetext")).toEqual([`${AR["gallery.sky.midnight"]} 00:00`]);
    expect(attr(look("sky", "sky.100.0.night", "day"), "aria-valuenow")).toEqual(["720"]);
    expect(attr(look("sky", "sky.100.0.night", "day"), "aria-valuetext")).toEqual([`${AR["gallery.sky.noon"]} 12:00`]);
  });

  it("sky: the scene is decorative (aria-hidden) and drawn from theme variables, never a colour", () => {
    const html = look("sky");
    expect(html).toMatch(/<svg[^>]*class="zx-sky-art"[^>]*aria-hidden="true"/);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgba?\(\s*\d|hsla?\(/);
  });

  it("warmth (temperature): a slider 0..100 that rests at the moon (0) on a dark theme and the sun (100) on «نهار», reading its colour temperature aloud; the old tint's reset button only while one is saved", () => {
    const moon = look("warmth");
    expect(moon).toContain('role="slider"');
    expect(attr(moon, "aria-valuemin")).toEqual(["0"]);
    expect(attr(moon, "aria-valuemax")).toEqual(["100"]);
    expect(attr(moon, "aria-valuenow")).toEqual(["0"]);
    expect(attr(moon, "aria-valuetext")).toEqual([`10,500 K · ${AR["gallery.temp.cool"]}`]);
    const sun = look("warmth", "warmth.100.0.night", "day");
    expect(attr(sun, "aria-valuenow")).toEqual(["100"]);
    expect(attr(sun, "aria-valuetext")).toEqual([`2,100 K · ${AR["gallery.temp.warm"]}`]);
    expect(moon).not.toContain(AR["themeSwitch.warmth.reset"]);
    const saved = look("warmth", "warmth.100.35.night");
    expect(saved).toContain(`aria-label="${AR["themeSwitch.warmth.reset"]}"`);
    expect(look("warmth", "warmth.100.-20.night")).toContain(`aria-label="${AR["themeSwitch.warmth.reset"]}"`);
    // the reset is a 44px target too
    expect(/<button[^>]*class="[^"]*\bmin-h-11\b[^"]*\bmin-w-11\b/.test(saved)).toBe(true);
  });

  it("plain (a knob you can drag): the plain switch's own markup — role=switch, checked on a dark theme, 44px target, Arabic name — with the knob's place as a variable", () => {
    const night = look("plain", "plain.100.0.night", "night");
    expect(night).toMatch(/<button[^>]*role="switch"/);
    expect(attr(night, "aria-checked")).toEqual(["true"]);
    expect(attr(night, "aria-label")).toEqual([AR["themeSwitch.aria"]]);
    expect(attr(night, "title")).toEqual([AR["themeSwitch.toggle_to_day"]]);
    expect(night).toMatch(/<button[^>]*class="[^"]*\bmin-h-11\b[^"]*\bmin-w-11\b/);
    expect(night).toContain("--q:0");
    const day = look("plain", "plain.100.0.night", "day");
    expect(attr(day, "aria-checked")).toEqual(["false"]);
    expect(day).toContain("--q:1");
  });

  it("particles: a small canvas for the sheds by default, none in «وضع التوفير» or with the feature off", () => {
    const sheds = (html: string) => (html.match(/<canvas[^>]*class="zx-sheds"/g) ?? []).length;
    expect(sheds(look("warmth"))).toBe(1);
    const economy = render(createElement(FxControl, { style: "warmth", size: "bar" }), { pref: "warmth.100.0.night", economy: true });
    expect(sheds(economy)).toBe(0);
    expect(economy).toContain('data-motion="false"');
    const off = render(createElement(FxControl, { style: "warmth", size: "bar" }), { pref: "warmth.100.0.night", enabled: false });
    expect(sheds(off)).toBe(0);
  });

  it("every look: Arabic names, theme tokens only, logical directions only, no Latin word", () => {
    for (const style of ["plain", "glass", "lamp", "sky", "warmth"] as const) {
      for (const size of ["bar", "preview"] as const) {
        const html = look(style, `${style}.80.20.night`, "night", size);
        const tokens = classTokens(html);
        expect(tokens.filter((c) => PALETTE_COLOUR.test(c)), `${style} ${size}`).toEqual([]);
        expect(tokens.filter((c) => PHYSICAL_UTILITY.test(c.split(":").pop() as string)), `${style} ${size}`).toEqual([]);
        expect(textOf(html), `${style} ${size}`).not.toMatch(/[A-Za-z]{2,}/);
        expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgba?\(\s*\d/);
      }
    }
  });
});

describe("«مظهر المفتاح» in the person's look settings", () => {
  const picker = (opts: Parameters<typeof render>[1] = {}) => render(createElement(SwitchStylePicker), opts);

  it("shows five radios named in Arabic, the chosen one checked, and the warning with its fix together", () => {
    const html = picker({ pref: "lamp.100.0.night" });
    expect([...html.matchAll(/<input[^>]*type="radio"[^>]*name="zk-switch-style"[^>]*>/g)]).toHaveLength(5);
    expect(html).toContain(AR["themeSwitch.picker"]);
    for (const style of SWITCH_STYLES) expect(html).toContain(AR[`themeSwitch.style.${style}`]);
    const checked = [...html.matchAll(/<input[^>]*aria-label="([^"]+)"[^>]*checked=""[^>]*>/g)].map((m) => m[1]);
    expect(checked).toEqual([AR["themeSwitch.style.lamp"]]);
    expect(AR["themeSwitch.warn"]).toContain("⚠️");
    expect(AR["themeSwitch.warn"]).toContain("🔧");
    expect(html).toContain(AR["themeSwitch.warn"]);
  });

  it("the default is «عادي»", () => {
    const checked = [...picker().matchAll(/<input[^>]*aria-label="([^"]+)"[^>]*checked=""[^>]*>/g)].map((m) => m[1]);
    expect(checked).toEqual([AR["themeSwitch.style.plain"]]);
  });

  it("draws nothing while the feature switch is off (and the theme picker is then exactly as it was)", () => {
    expect(picker({ enabled: false })).toBe("");
    const off = render(createElement(ThemePicker), { enabled: false });
    const none = render(createElement(ThemePicker), { enabled: false, pref: "lamp.50.0.night" });
    expect(off).not.toContain("zk-switch-style");
    expect(none).not.toContain("zk-switch-style");
    expect(render(createElement(ThemePicker), { enabled: true })).toContain("zk-switch-style");
  });

  it("every Arabic string it uses exists (no key shows raw)", () => {
    const html = picker({ pref: "sky.100.0.night" });
    expect(html).not.toMatch(/themeSwitch\./);
    expect(textOf(html)).not.toMatch(/[A-Za-z]{2,}/);
  });
});

describe("the source: lazy, light, and inside the theme system", () => {
  const SRC = path.join(ROOT, "src");
  const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8").replace(/\r\n/g, "\n");
  const files = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) files(full, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  };

  it("the effect code (switch-fx/) is imported only dynamically from outside its folder: nobody downloads it by default", () => {
    const own = path.join(SRC, "components", "theme", "switch-fx") + path.sep;
    for (const file of files(SRC)) {
      if (file.startsWith(own)) continue;
      const text = readFileSync(file, "utf8");
      for (const line of text.split(/\r?\n/)) {
        if (/^\s*(?:import|export)\b[^(]*from\s+["'][^"']*switch-fx\//.test(line)) throw new Error(`${path.relative(SRC, file)} imports the effect code statically: ${line.trim()}`);
      }
    }
    expect(read("components/theme/theme-switch.tsx")).toMatch(/dynamic\(\(\) => import\("\.\/switch-fx\/fx-control"\)/);
    expect(read("components/theme/theme-switch.tsx")).toMatch(/ssr:\s*false/);
    expect(read("components/theme/use-theme-toggle.ts")).toMatch(/import\("\.\/switch-fx\/reveal"\)/);
    expect(read("components/theme/switch-fx/reveal.ts")).toContain("PARTICLE_CAP");
  });

  it("the (app) layout keeps AppShell as its root element (the database layout tests read its props) and hands it the cookie and the feature switch", () => {
    const layout = read("app/(app)/layout.tsx");
    expect(layout).toMatch(/return \(\s*<AppShell\b/);
    expect(layout).toContain("themeSwitch={cookies().get(SWITCH_COOKIE)?.value}");
    expect(layout).toContain("themeSwitchFx={on.themeSwitchFx}");
    const shell = read("components/app-shell.tsx");
    expect(shell).toContain("<SwitchFxProvider initial={props.themeSwitch} enabled={props.themeSwitchFx ?? false}");
  });

  it("the stylesheet comes with the lazy chunk, not with the page everybody downloads", () => {
    expect(read("components/theme/switch-fx/fx-control.tsx")).toContain('import "./switch-fx.css"');
    expect(read("app/globals.css")).not.toContain("zk-glass");
  });

  it("the stylesheets hold no colour of their own: theme variables only, and logical directions only", () => {
    for (const sheet of ["components/theme/switch-fx/switch-fx.css", "app/globals.css"]) {
      const css = read(sheet).replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css, sheet).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css, sheet).not.toMatch(/\brgba?\(\s*\d/);
      expect(css, sheet).not.toMatch(/\bhsla?\(/);
    }
    const fx = read("components/theme/switch-fx/switch-fx.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(fx).not.toMatch(/(?:^|[\s{;])(?:left|right|margin-left|margin-right|padding-left|padding-right)\s*:/);
    expect(fx).toContain("inset-inline-start");
    expect(fx).toContain("--zx-dir");
  });

  it("animation work is bounded: requestAnimationFrame only inside a drag, a settling knob or a reveal, cancelled on the way out; never a timer loop", () => {
    const kit = read("components/theme/fx/kit.ts");
    expect(kit).toContain("cancelAnimationFrame");
    expect(kit).toMatch(/useEffect\(\(\) => stop, \[stop\]\)/);
    const reveal = read("components/theme/switch-fx/reveal.ts");
    expect(reveal).toContain("cancelAnimationFrame");
    expect(reveal).toContain("cancelReveal");
    for (const file of ["components/theme/switch-fx/fx-control.tsx", "components/theme/fx/kit.ts", "components/theme/fx/sheds.tsx", "components/theme/switch-fx/reveal.ts", "components/theme/switch-fx-provider.tsx"]) {
      expect(read(file), file).not.toMatch(/setInterval\(/);
      expect(read(file), file).not.toMatch(/Math\.random\(/);
    }
    expect(read("lib/themes/switch-motion.ts")).toContain("PARTICLE_CAP");
  });

  it("no network call but the saving of the choice itself", () => {
    for (const file of files(path.join(SRC, "components", "theme", "switch-fx"))) expect(readFileSync(file, "utf8"), file).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
    const provider = read("components/theme/switch-fx-provider.tsx");
    expect([...provider.matchAll(/fetch\("([^"]+)"/g)].map((m) => m[1])).toEqual(["/api/me/switch"]);
  });

  it("the effects honour reduced motion in the stylesheet as well as in the code", () => {
    const css = read("components/theme/switch-fx/switch-fx.css");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(read("components/theme/switch-fx-provider.tsx")).toContain("(prefers-reduced-motion: reduce)");
  });
});
