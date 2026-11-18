import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_KEYS } from "@/lib/themes/registry";
import { ART_SLOTS, COMPOSED, PATTERN, PHOTOGRAPHIC, PLAIN, allDecorFiles, decorFilesOf, patternTileUrl, renderDecorCss } from "@/lib/themes/decor";
import { DECOR_DIR, ROOT, luminance, parseCss, read, type Rgb } from "./themes-decor-helpers";

/**
 * THE PICTURES ON THE DISK ARE THE PICTURES THE CODE ASKS FOR — AND NOTHING ELSE.
 *
 * `public/brand/decor/` holds the owner's own artwork: six WebP files, three masks for «إسلامي ملحمي» and three
 * photographs for «ساحل النيون» («ليل» and «نهار» draw their field of stars in code, from no file). The
 * repository is public and a phone downloads
 * these, so the folder is held to: every file is referenced, every reference exists, each file is under
 * 150 KB, a mask has an alpha channel (a mask without one paints a solid rectangle) and a photograph does not.
 */

const ART_DIR = path.join(ROOT, "public", "brand", "art");
const KB = 1024;

const onDisk = (): string[] => readdirSync(DECOR_DIR).filter((f) => !f.startsWith(".")).sort();
const PHOTOS = new Set(PHOTOGRAPHIC["neon-coast"] ? [PHOTOGRAPHIC["neon-coast"].door, PHOTOGRAPHIC["neon-coast"].doorTall, PHOTOGRAPHIC["neon-coast"].strip] : []);

describe("the files in public/brand/decor are exactly the files decor.ts lists", () => {
  it("— every file in the folder is referenced, and every reference exists", () => {
    expect(onDisk(), "a picture nobody asks for, or one that was never added").toEqual([...allDecorFiles()].sort());
  });

  it("— a theme with files owns three, a pattern theme none, and no two themes share a file", () => {
    const seen = new Map<string, string>();
    for (const theme of THEME_KEYS) {
      const files = decorFilesOf(theme);
      expect(files.length, theme).toBe(theme in PATTERN || (PLAIN as readonly string[]).includes(theme) ? 0 : 3);
      for (const f of files) {
        expect(seen.get(f), `${f} is owned by two themes`).toBeUndefined();
        seen.set(f, theme);
        expect(f.startsWith(theme), `${f} does not carry its theme's name`).toBe(true);
      }
    }
    expect(decorFilesOf("islamic-epic")).toHaveLength(3);
    expect(decorFilesOf("neon-coast")).toHaveLength(3);
    expect(decorFilesOf("night")).toEqual([]);
    expect(decorFilesOf("day")).toEqual([]);
    expect(decorFilesOf("sky")).toEqual([]);
    expect(decorFilesOf("blue-night")).toEqual([]);
  });

  it("— every theme has exactly one voice, and the list of themes that wear photographs is closed", () => {
    /*
     * «Shape only, never colour» is broken for ONE theme, on purpose (the owner's own photographs of a night coast).
     * A second photographic theme, or a theme with no voice, is a decision for the owner, taken by editing this
     * claim — not something that happens because a file was added.
     */
    const voices = [...Object.keys(COMPOSED), ...Object.keys(PHOTOGRAPHIC), ...Object.keys(PATTERN), ...PLAIN].sort();
    expect(voices, "every theme wears exactly one kind of decoration").toEqual([...THEME_KEYS].sort());
    expect(Object.keys(PHOTOGRAPHIC), "a second theme with photographs").toEqual(["neon-coast"]);
    expect(Object.keys(COMPOSED)).toEqual(["islamic-epic"]);
    expect(Object.keys(PATTERN)).toEqual(["night", "day"]);
  });

  it("— every url() in the generated stylesheet points at a file that exists under public/, or is the star tile drawn in code", () => {
    const { rules } = parseCss(renderDecorCss());
    const urls = rules.flatMap((r) => r.decls.flatMap(([, v]) => [...v.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1] as string)));
    expect(urls.length).toBeGreaterThan(20);
    const tiles = new Set(Object.values(PATTERN).map((p) => patternTileUrl(p.tile)));
    for (const u of urls) {
      if (u.startsWith("data:")) expect(tiles.has(u), "a data: URL that is not the star tile").toBe(true);
      else expect(existsSync(path.join(ROOT, "public", u)), u).toBe(true);
    }
  });
});

describe("each file is the size and the kind the CSS expects", () => {
  it("— a real WebP, under 150 KB (a phone downloads it)", () => {
    for (const f of onDisk()) {
      const buf = readFileSync(path.join(DECOR_DIR, f));
      expect(buf.subarray(0, 4).toString("ascii"), `${f} is not a RIFF file`).toBe("RIFF");
      expect(buf.subarray(8, 12).toString("ascii"), `${f} is not WebP`).toBe("WEBP");
      expect(statSync(path.join(DECOR_DIR, f)).size / KB, `${f} is heavy`).toBeLessThanOrEqual(150);
    }
  });

  it("— a mask carries its coverage in the ALPHA channel; a photograph has none", () => {
    /*
     * The bug a browser found once in the OMS: a mask without an alpha channel is, to `mask-image`, a rectangle in
     * which every pixel is covered — a solid accent-coloured box across the whole door. A lossy WebP with alpha is a
     * VP8X chunk with bit 4 of its flags set; a lossless one says so in the first bits of its VP8L stream.
     */
    for (const f of onDisk()) {
      const buf = readFileSync(path.join(DECOR_DIR, f));
      const kind = buf.subarray(12, 16).toString("ascii");
      let hasAlpha = false;
      if (kind === "VP8X") hasAlpha = ((buf[20] as number) & 0x10) !== 0;
      else if (kind === "VP8L") hasAlpha = ((buf[24] as number) & 0x10) !== 0;
      expect(hasAlpha, `${f} (${kind}): ${PHOTOS.has(f) ? "a photograph must be opaque" : "a mask needs an alpha channel"}`).toBe(!PHOTOS.has(f));
    }
  });

  it("— the photographs are 16:9, 9:16 and 5:1, big enough for a desktop door under a veil", async () => {
    const sharp = (await import("sharp")).default;
    const p = PHOTOGRAPHIC["neon-coast"];
    const dims = async (name: string) => {
      const m = await sharp(path.join(DECOR_DIR, name)).metadata();
      return { w: m.width as number, h: m.height as number };
    };
    const wide = await dims(p.door);
    const tall = await dims(p.doorTall);
    const strip = await dims(p.strip);
    expect(wide.w / wide.h).toBeCloseTo(16 / 9, 1);
    expect(tall.w / tall.h).toBeCloseTo(9 / 16, 1);
    expect(strip.w / strip.h).toBeCloseTo(5, 3);
    expect(wide.w).toBeGreaterThanOrEqual(1280);
    expect(tall.h).toBeGreaterThanOrEqual(1280);
    expect(strip.w).toBeGreaterThanOrEqual(600);
  });

  it("— and they are the night pictures the veil and the palette were made for: the median is dark", async () => {
    // not a taste check: a pale replacement would have the numbers of the veil fighting it
    const sharp = (await import("sharp")).default;
    for (const name of decorFilesOf("neon-coast")) {
      const { data, info } = await sharp(path.join(DECOR_DIR, name)).resize(160, 90, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
      const ls: number[] = [];
      for (let i = 0; i < data.length; i += info.channels) ls.push(luminance([data[i], data[i + 1], data[i + 2]] as unknown as Rgb));
      ls.sort((a, b) => a - b);
      expect(ls[Math.floor(ls.length / 2)] as number, `${name}: the median is bright`).toBeLessThan(0.2);
    }
  });

  it("— the corner of a composed theme is ONE file, drawn three times (right, left turned, header turned)", () => {
    for (const theme of ["islamic-epic"]) {
      expect(onDisk().filter((f) => f.startsWith(`${theme}.corner`))).toEqual([`${theme}.corner.webp`]);
    }
  });
});

describe("every file in the repository's brand folders says where it came from", () => {
  const credits = read("public", "brand", "CREDITS.md");

  it("— CREDITS.md names each theme's drawings", () => {
    for (const theme of THEME_KEYS.filter((t) => decorFilesOf(t).length > 0)) expect(credits, theme).toContain(`brand/decor/${theme}.`);
    // and a file that left the folder leaves the list
    for (const gone of ["islamic-calm", "day.webp"]) expect(credits, gone).not.toContain(`brand/decor/${gone}`);
  });
});

describe("the artwork the owner adds later is picked up by name, so the names are held now", () => {
  it("— every file in public/brand/art, if the folder exists, is a known slot, WebP, under 150 KB", () => {
    if (!existsSync(ART_DIR)) return; // arrives later — a missing file is not a failure, the slot hides itself
    const slots = new Set<string>(ART_SLOTS);
    for (const f of readdirSync(ART_DIR).filter((n) => !n.startsWith("."))) {
      expect(f.endsWith(".webp"), `${f}: art is WebP`).toBe(true);
      expect(slots.has(f.replace(/\.webp$/, "")), `${f} is not an agreed slot name (see ART_SLOTS in decor.ts)`).toBe(true);
      expect(statSync(path.join(ART_DIR, f)).size / KB, `${f} is heavy`).toBeLessThanOrEqual(150);
    }
  });
});
