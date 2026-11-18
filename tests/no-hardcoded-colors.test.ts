import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Colours come from the theme tokens (src/lib/themes/palettes.ts), so every theme can restyle every
 * screen: `text-danger`, `bg-ok/10`, `border-warn/40`, `bg-surface-1`, `text-fg-muted` ...
 * Tailwind's default palette (`text-red-500`, `bg-emerald-500/10`, `dark:text-sky-400`) and hex
 * values in the source would ignore the chosen theme, so they fail here.
 */

const SRC = path.resolve(__dirname, "../src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((f) => ({ file: path.relative(SRC, f).replace(/\\/g, "/"), text: readFileSync(f, "utf8") }));

const PALETTE_CLASS =
  /(?<![\w-])(?:text|bg|border|ring|from|to|via|fill|stroke|divide|outline|decoration|accent|shadow|placeholder)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}(?![\w-])/;

/** Where a colour is DATA or brand art, not a styling decision. */
const HEX_ALLOWED = [
  "lib/themes/", // the palettes themselves
  "components/logo.tsx", // the «Z» mark (brand art)
  "server/services/tasks.ts", // the colour a new board column is created with (stored in the database)
  "app/api/labels/route.ts", // the colour a new label is created with (stored in the database)
  "app/api/boards/[id]/columns/route.ts", // the colour a new column is created with (stored in the database)
  "lib/cards/collage-layout.ts", // the white of the collage canvas: the colour of the exported picture, not of the screen
  "lib/cards/media-client.ts", // the canvas the browser draws the exported picture on
];
const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/;
const RAW_RGB = /\brgba?\(\s*\d/;
const RAW_HSL = /\bhsla?\(/;
/** The avatar hue is computed from the person's name: a data colour, not a styling decision. */
const HSL_ALLOWED = ["components/ui/avatar.tsx", "lib/format.ts", "components/chat-view.tsx" /* rebuilt in the chat phase */];

function offenders(pattern: RegExp, allowed: string[] = []): string[] {
  const out: string[] = [];
  for (const { file, text } of files) {
    if (allowed.some((a) => file.includes(a))) continue;
    text.split(/\r?\n/).forEach((line, i) => {
      if (pattern.test(line)) out.push(`${file}:${i + 1}  ${line.trim().slice(0, 100)}`);
    });
  }
  return out;
}

describe("colours come from the theme tokens", () => {
  it("scans the source (so the checks below are not vacuous)", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("no Tailwind default-palette class (text-red-500, bg-emerald-500/10, dark:text-sky-400 ...)", () => {
    // the palette module explains the old class names in a comment
    expect(offenders(PALETTE_CLASS, ["lib/themes/palettes.ts"])).toEqual([]);
  });

  it("no hex colour outside the palettes, the brand mark and the colours stored as data", () => {
    expect(offenders(HEX, HEX_ALLOWED)).toEqual([]);
  });

  it("no raw rgb()/rgba() with numbers: use rgb(var(--token))", () => {
    expect(offenders(RAW_RGB, ["lib/themes/"])).toEqual([]);
  });

  it("no hsl() except the name-derived avatar hue", () => {
    expect(offenders(RAW_HSL, HSL_ALLOWED)).toEqual([]);
  });

  // WP-UI2 item 13: black/white are a theme's job too — a dark theme must be able to restyle them
  it("no bg-white / bg-black / text-white / text-black — the scrim, the switch knob and the on-colour text use tokens", () => {
    expect(offenders(/\b(?:bg|text)-(?:white|black)\b(?![\w-])/)).toEqual([]);
  });
});
