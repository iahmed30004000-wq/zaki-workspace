import { describe, expect, it } from "vitest";
import {
  CAT_TOKENS,
  COLOR_TOKENS,
  PALETTES,
  SCRIM_BACKDROP_ALPHA,
  SCRIM_PANEL_ALPHA,
  STYLE_TOKENS,
  themeColorOf,
  themeVariables,
} from "@/lib/themes/palettes";
import { DISTINCT_MIN, blend, checkPalette, contrastRatio, deltaEOK, hexToTriplet, relativeLuminance } from "@/lib/themes/contrast";
import { DEFAULT_THEME, THEME_KEYS, THEMES } from "@/lib/themes/registry";

/**
 * The palettes: every theme defines every token, and every pair a screen actually draws is
 * readable. A theme that fails here is not merged — that is the whole meaning of "registered".
 */

const HEX = /^#[0-9A-F]{6}$/;

describe("every theme defines the whole token set", () => {
  it("the token names are exactly the agreed contract", () => {
    expect([...COLOR_TOKENS]).toEqual([
      "surface", "surface-1", "surface-2", "border", "muted", "fg", "fg-muted", "accent", "accent-fg",
      "accent-2", "ok", "warn", "danger", "info", "ok-fg", "warn-fg", "danger-fg", "info-fg", "scrim",
      "cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6", "on-photo",
      "bubble-out", "bubble-out-fg", "bubble-in", "bubble-in-fg", "chat-wallpaper", "chat-pattern", "selected-row", "selected-row-fg", "badge-muted",
    ]);
    expect([...CAT_TOKENS]).toEqual(["cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6"]);
    expect([...STYLE_TOKENS]).toEqual(["font-display", "radius-card", "shadow-card"]);
  });

  it("there is a palette for each of the six themes and for nothing else", () => {
    expect(Object.keys(PALETTES).sort()).toEqual([...THEME_KEYS].sort());
  });

  for (const key of THEME_KEYS) {
    it(`${key}: every colour token is an upper-case #RRGGBB, every style token is set`, () => {
      const p = PALETTES[key];
      expect(Object.keys(p.colors).sort()).toEqual([...COLOR_TOKENS].sort());
      for (const token of COLOR_TOKENS) expect(p.colors[token], `${key} ${token}`).toMatch(HEX);
      for (const token of STYLE_TOKENS) expect(p.style[token].trim().length, `${key} ${token}`).toBeGreaterThan(0);
    });
  }

  it("each theme becomes CSS variables: colours as `R G B` triplets, then the style values", () => {
    const vars = themeVariables("night");
    expect(vars.map(([name]) => name)).toEqual([...COLOR_TOKENS.map((t) => `--${t}`), ...STYLE_TOKENS.map((t) => `--${t}`)]);
    expect(Object.fromEntries(vars)["--surface"]).toBe(hexToTriplet(PALETTES.night.colors.surface));
    for (const [, value] of vars.slice(0, COLOR_TOKENS.length)) expect(value).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
  });

  it("the browser chrome colour of a theme is its page colour", () => {
    for (const key of THEME_KEYS) expect(themeColorOf(key)).toBe(PALETTES[key].colors.surface);
  });
});

describe("each theme keeps its character", () => {
  const { colors: night } = PALETTES.night;
  const { colors: epic } = PALETTES["islamic-epic"];
  const { colors: neon } = PALETTES["neon-coast"];
  const { colors: day } = PALETTES.day;

  it("the default is «ليل» of «نجمة وطريق»: deep navy, a cyan action, the star's gold as the second accent", () => {
    expect(PALETTES[DEFAULT_THEME]).toBe(PALETTES.night);
    expect(night.surface).toBe("#050F1F");
    expect(night.accent).toBe("#36B5CC");
    expect(night["accent-2"]).toBe("#E3B04B");
    expect(night.fg).toBe("#E6F1F4");
  });

  it("«إسلامي ملحمي» is the OMS navy and gold — its identity untouched by «نجمة وطريق»", () => {
    expect(epic.surface).toBe("#0A1430");
    expect(epic["surface-1"]).toBe("#101C40");
    expect(epic["surface-2"]).toBe("#212C4D");
    expect(epic.accent).toBe("#D4AF5A");
    expect(epic["accent-2"]).toBe("#5CC6B9");
    expect(epic.fg).toBe("#EEECE7");
  });

  it("«ساحل النيون» is the OMS teal-black with the aqua neon and the rose neon", () => {
    expect(neon.surface).toBe("#061C28");
    expect(neon.accent).toBe("#4DD9DB");
    expect(deltaEOK(neon["accent-2"], "#E75FA6")).toBeLessThan(0.05);
  });

  it("«نهار» is «نجمة وطريق» by day: warm paper, petrol blue, a gold dark enough to see on paper", () => {
    expect(day.surface).toBe("#F6F2EA");
    expect(day.accent).toBe("#1A6382");
    expect(day["accent-2"]).toBe("#A8761F");
    expect(day.fg).toBe("#0C3252");
  });

  it("a caption over a picture (`on-photo`) is white in every theme", () => {
    for (const key of THEME_KEYS) expect(PALETTES[key].colors["on-photo"], key).toBe("#FFFFFF");
  });

  it("dark themes have dark pages and light text, light themes the other way round", () => {
    for (const key of THEME_KEYS) {
      const { colors } = PALETTES[key];
      const pageIsDark = contrastRatio(colors.surface, "#000000") < contrastRatio(colors.surface, "#FFFFFF");
      expect(pageIsDark, key).toBe(THEMES[key].dark);
    }
  });

  it("the Islamic themes title in Reem Kufi, the others in IBM Plex — and every stack ends in Plex", () => {
    for (const key of THEME_KEYS) {
      const font = PALETTES[key].style["font-display"];
      expect(font.includes("--font-reem"), key).toBe(THEMES[key].headingFont === "reem-kufi");
      expect(font, key).toContain("--font-plex");
      expect(font.trim().endsWith("sans-serif"), key).toBe(true);
    }
  });
});

describe("the contrast gate", () => {
  for (const key of THEME_KEYS) {
    it(`${key}: every text pair >= 4.5:1, every UI pair >= 3:1, every categorical colour distinct`, () => {
      expect(checkPalette(PALETTES[key].colors)).toEqual([]);
    });
  }

  it("the gate is not vacuous: it catches each kind of failure", () => {
    const base = PALETTES.day.colors;
    const broken = (patch: Partial<typeof base>) => checkPalette({ ...base, ...patch }).map((p) => p.rule);
    // grey text that is too pale on the page
    expect(broken({ "fg-muted": "#9A9A9A" })).toContain("text");
    // white on a pale accent: the label of the main button
    expect(broken({ accent: "#7FC7BF" })).toContain("text");
    // a status colour that reads on the page but not inside its own tinted chip
    expect(broken({ ok: "#147D40" })).toContain("chip");
    // a chip that passes on the page and a card but not on a hover row (surface-2): review C item 15
    const onHoverRow = checkPalette({ ...base, ok: "#1A7336" });
    expect(onHoverRow.map((p) => p.pair)).toEqual(["ok on ok/10 over surface-2"]);
    // a gold too light under the «جديد» button's dark label (the scrim): day's own scrim before it was deepened
    expect(checkPalette({ ...base, scrim: "#0C1A2B" }).map((p) => p.pair)).toContain("scrim on accent-2 (the gold button's label)");
    // a caption colour over a picture that is not light enough
    expect(broken({ "on-photo": "#7A7A7A" })).toContain("scrim");
    // a second accent too pale to see as a shape
    expect(broken({ "accent-2": "#E8DDC0" })).toContain("ui");
    // two categories nobody can tell apart
    expect(broken({ "cat-3": base["cat-1"] })).toContain("distinct");
    // the warning colour a twin of the action colour
    expect(broken({ warn: base.accent })).toContain("distinct");
    // a scrim that does not dim: a white veil behind a dialog, under a white caption on a photo
    expect(broken({ scrim: "#FCFAF5" })).toContain("scrim");
    // a scrim too pale for a white caption over a white picture
    expect(broken({ scrim: "#5A6B69" })).toContain("scrim");
    // the same palette passes with its own scrim (the cases above are the scrim's fault)
    expect(checkPalette(base)).toEqual([]);
  });

  it("the categorical colours are told apart by more than a just-noticeable step", () => {
    expect(DISTINCT_MIN).toBeGreaterThanOrEqual(0.08);
    for (const key of THEME_KEYS) {
      const { colors } = PALETTES[key];
      for (let i = 0; i < CAT_TOKENS.length; i++) {
        for (let j = i + 1; j < CAT_TOKENS.length; j++) {
          const [a, b] = [CAT_TOKENS[i]!, CAT_TOKENS[j]!];
          expect(deltaEOK(colors[a], colors[b]), `${key} ${a}/${b}`).toBeGreaterThanOrEqual(DISTINCT_MIN);
        }
      }
    }
  });

  it("the scrim is a dark veil in every theme: it dims what is under it (a dialog's backdrop, a photo under a caption)", () => {
    for (const key of THEME_KEYS) {
      const { colors } = PALETTES[key];
      for (const ground of ["surface", "surface-1", "surface-2"] as const) {
        expect(relativeLuminance(colors.scrim), `${key} scrim vs ${ground}`).toBeLessThan(relativeLuminance(colors[ground]));
      }
    }
  });

  it("a white caption on the scrim at SCRIM_PANEL_ALPHA reads over a pure white picture (and the dark themes' own text too)", () => {
    expect(SCRIM_PANEL_ALPHA).toBeGreaterThanOrEqual(0.5);
    expect(SCRIM_PANEL_ALPHA).toBeLessThanOrEqual(0.8);
    for (const key of THEME_KEYS) {
      const { colors } = PALETTES[key];
      const panel = blend(colors.scrim, SCRIM_PANEL_ALPHA, "#FFFFFF");
      expect(contrastRatio("#FFFFFF", panel), key).toBeGreaterThanOrEqual(4.5);
      if (THEMES[key].dark) expect(contrastRatio(colors.fg, panel), key).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the dialog backdrop is the scrim at SCRIM_BACKDROP_ALPHA (bg-scrim/60): on a light theme the dialog's card stands out from the dimmed page, and on a dark theme its EDGE does", () => {
    expect(SCRIM_BACKDROP_ALPHA).toBe(0.6);
    for (const key of THEME_KEYS) {
      const { colors } = PALETTES[key];
      const dimmed = blend(colors.scrim, SCRIM_BACKDROP_ALPHA, colors.surface);
      // the panel draws `ring-1 ring-muted` too, in every theme; on the dark themes the fill is
      // ~1.2:1 and the edge carries the boundary (WCAG 1.4.11), on the light ones the fill already does.
      if (THEMES[key].dark) expect(contrastRatio(colors.muted, dimmed), `${key} edge`).toBeGreaterThanOrEqual(3);
      else expect(contrastRatio(colors["surface-1"], dimmed), key).toBeGreaterThanOrEqual(3);
    }
  });
});
