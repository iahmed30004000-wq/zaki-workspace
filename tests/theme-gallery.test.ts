import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
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

import { ThemeGallery } from "@/components/theme/gallery/theme-gallery";
import { GALLERY_VARIANTS, STAGE_H, STAGE_W } from "@/components/theme/gallery/scene-types";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import { FX_COLORS, FX_TOKENS } from "@/lib/themes/palettes";
import { SKY_KEY_MINUTES, skyMoment } from "@/lib/themes/switch-motion";

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8").replace(/\r\n/g, "\n");
const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const html = renderToStaticMarkup(createElement(Translations, { initial: "ar" }, createElement(ThemeGallery, { economy: false })));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("the gallery's control pill", () => {
  it("starts on «06 · glass», keeps the reference's numbering and names it in Arabic", () => {
    expect(html).toContain(`06 · ${AR["gallery.v.glass"]}`);
    expect(GALLERY_VARIANTS.map((v) => v.n)).toEqual(["01", "02", "03", "04", "05", "06"]);
    expect(new Set(GALLERY_VARIANTS.map((v) => v.key)).size).toBe(6);
  });

  it("has the two arrows, the Toggle button and the three key hints (Space toggles, H hides, Esc exits)", () => {
    expect(html).toContain(`aria-label="${AR["gallery.prev"]}"`);
    expect(html).toContain(`aria-label="${AR["gallery.next"]}"`);
    expect(html).toContain(`>${AR["gallery.toggle"]}</button>`);
    for (const key of ["gallery.key.space", "gallery.hint.toggle", "gallery.hint.hide", "gallery.hint.exit"]) expect(html).toContain(AR[key] ?? "missing");
    expect(html).toContain("<kbd>H</kbd>");
    expect(html).toContain("<kbd>Esc</kbd>");
    expect((html.match(/<kbd>/g) ?? []).length).toBe(3);
  });

  it("is right-to-left, a region with a name, and the arrows point the right way round (previous on the right)", () => {
    expect(html).toContain('class="fx-pill" dir="rtl"');
    expect(html).toContain(`aria-label="${AR["gallery.title"]}"`);
    expect(html.indexOf(AR["gallery.prev"] ?? "")).toBeLessThan(html.indexOf(AR["gallery.next"] ?? ""));
  });

  it("every Arabic string a scene or the pill asks for exists (static and dynamic keys)", () => {
    const keys = ["title", ...GALLERY_VARIANTS.map((v) => `v.${v.key}`), "sky.drag", "sky.midnight", "sky.moonset", "sky.goldenhour", "sky.morning", "sky.noon", "temp.cool", "temp.neutral", "temp.warm", "glass.word", "glass.caption", "lamp.label", "lumen.repainting", "reading.title"];
    for (const k of keys) expect(AR[`gallery.${k}`], k).toBeTruthy();
    expect(AR["themeSwitch.repainting"]).toContain("{n}");
    expect(AR["gallery.lumen.repainting"]).toContain("{n}");
  });

  it("the sky's five moments all have words", () => {
    const seen = new Set(SKY_KEY_MINUTES.map((m) => skyMoment(m)));
    for (const moment of seen) expect(AR[`gallery.sky.${moment}`], moment).toBeTruthy();
  });
});

describe("the stage", () => {
  it("is the reference recording's size (the scenes are drawn at 1720 x 1080 and scaled to the window)", () => {
    expect([STAGE_W, STAGE_H]).toEqual([1720, 1080]);
    expect(read("components/theme/gallery/theme-gallery.tsx")).toContain("Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H)");
  });
});

describe("the gallery page: staff only, behind the switch, lazy", () => {
  const page = read("app/(app)/theme-gallery/page.tsx");
  it("refuses an external partner, and is «not found» while the themeSwitchFx switch is off", () => {
    expect(page).toContain("actor.isExternal");
    expect(page).toContain('actorFeatureOn(actor, "themeSwitchFx")');
    expect(page).toContain("notFound()");
    expect(page.indexOf("actor.isExternal")).toBeLessThan(page.indexOf("await actorFeatureOn"));
    expect(page).toContain("pageActor()");
  });

  it("reaches the gallery only through a dynamic, client-only import (the page ships nothing of the effects)", () => {
    expect(read("components/theme/gallery/gallery-loader.tsx")).toMatch(/dynamic\(\(\) => import\("\.\/theme-gallery"\)[\s\S]*ssr:\s*false/);
    const own = path.join(SRC, "components", "theme", "gallery") + path.sep;
    for (const file of walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f))) {
      if (file.startsWith(own)) continue;
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        if (/^\s*(?:import|export)\b[^(]*from\s+["'][^"']*theme\/gallery\//.test(line) && !/gallery-loader/.test(line)) throw new Error(`${path.relative(SRC, file)} imports the gallery statically: ${line.trim()}`);
      }
    }
  });

  it("loads each scene as its own lazy chunk", () => {
    const gallery = read("components/theme/gallery/theme-gallery.tsx");
    for (const scene of ["temp-scene", "lamp-scene", "lumen-scenes", "sky-scene", "glass-scene"]) expect(gallery).toContain(`import("./${scene}")`);
    expect(gallery).not.toMatch(/^import .* from "\.\/(?:temp|lamp|sky|glass)-scene"/m);
  });

  it("Space toggles, H hides the pill, Esc exits (and a key pressed on a button is that button's own)", () => {
    const gallery = read("components/theme/gallery/theme-gallery.tsx");
    expect(gallery).toMatch(/e\.key === "Escape"[\s\S]*router\.push\("\/"\)/);
    expect(gallery).toMatch(/e\.key === " " && !onControl[\s\S]*toggle\(\)/);
    expect(gallery).toMatch(/e\.key === "h" \|\| e\.key === "H"\) && !onControl[\s\S]*setHidden/);
  });
});

describe("the showcase source: tokens only, bounded, quiet", () => {
  const files = [...walk(path.join(SRC, "components", "theme", "gallery")), ...walk(path.join(SRC, "components", "theme", "fx"))];
  const code = files.filter((f) => /\.(ts|tsx)$/.test(f));
  const sheets = files.filter((f) => f.endsWith(".css"));

  it("no hex, no rgb numbers, no hsl in a stylesheet or a component (colours are --fx-* / --s-* variables)", () => {
    for (const f of sheets) {
      const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(css, f).not.toMatch(/\brgba?\(\s*\d/);
      expect(css, f).not.toMatch(/\bhsla?\(/);
    }
    for (const f of code) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      expect(text, f).not.toMatch(/\brgba?\(\s*\d/);
    }
  });

  it("no Math.random, no timer loop, no network, no heavy dependency (three, gsap, framer-motion ...)", () => {
    for (const f of code) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/Math\.random\(/);
      expect(text, f).not.toMatch(/setInterval\(/);
      expect(text, f).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon/);
      expect(text, f).not.toMatch(/from "(?:three|gsap|framer-motion|pixi\.js|@react-three)/);
    }
  });

  it("every stylesheet that animates honours prefers-reduced-motion", () => {
    for (const f of sheets) {
      const css = readFileSync(f, "utf8");
      if (/animation\s*:/.test(css)) expect(css, f).toMatch(/prefers-reduced-motion: reduce/);
    }
  });

  it("the scenes bound their particles (PARTICLE_CAP) and stop their frame loops", () => {
    expect(read("components/theme/fx/kit.ts")).toContain("cancelAnimationFrame");
    for (const f of ["lamp-scene.tsx", "temp-scene.tsx"]) expect(read(`components/theme/gallery/${f}`), f).toContain("PARTICLE_CAP");
    expect(read("components/theme/fx/sheds.tsx")).toContain("cap <= 0");
  });
});

describe("the scene colours", () => {
  it("every theme carries every scene token as a 6-digit hex (so a theme can restyle none and still render)", () => {
    expect(FX_TOKENS.length).toBeGreaterThan(140);
    for (const [theme, colours] of Object.entries(FX_COLORS)) {
      for (const token of FX_TOKENS) expect(colours[token], `${theme} ${token}`).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("every light/dark pair the scenes mix has both ends, and every sky key frame has its five colours", () => {
    const tokens = new Set<string>(FX_TOKENS);
    for (const pair of ["gl-bg", "gl-ink", "gl-veil", "gl-tint", "lp-bg", "lp-card", "lp-ray", "lm-bg", "lm-panel", "lm-accent", "tp-bg", "tp-tint", "tp-ink"]) {
      expect(tokens.has(`fx-${pair}-l`), pair).toBe(true);
      expect(tokens.has(`fx-${pair}-d`), pair).toBe(true);
    }
    for (let i = 0; i < SKY_KEY_MINUTES.length; i++) for (const part of ["top", "low", "page", "far", "near"]) expect(tokens.has(`fx-sk${i}-${part}`), `sk${i}-${part}`).toBe(true);
    for (const mid of ["fx-gl-bg-x", "fx-lp-bg-x", "fx-tp-bg-x"]) expect(tokens.has(mid), mid).toBe(true);
  });
});
