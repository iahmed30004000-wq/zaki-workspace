import { describe, expect, it } from "vitest";
import { THEME_KEYS, type ThemeKey } from "@/lib/themes/registry";
import { ART_SCENES, COMPOSED, DECOR_ECONOMY_ATTR, DECOR_HIDDEN_ATTR, DECOR_KINDS, PATTERN, PHOTOGRAPHIC, PLAIN, allDecorFiles, decorFilesOf, holdDecorEconomy, renderDecorCss, syncDecorEconomy } from "@/lib/themes/decor";
import { DECOR_CSS_FILE, normalizeText, parseCss, read, stripComments, valueOf } from "./themes-decor-helpers";

/**
 * F1.7 — CALM DECORATION. The two flat themes of D1 draw nothing and move nothing; the four old themes keep their
 * decoration, paused while the tab is hidden (as before) and now still under «وضع التوفير».
 */

const css = renderDecorCss();
const { rules } = parseCss(css);
const OLD = THEME_KEYS.filter((key) => !(PLAIN as readonly string[]).includes(key));
const mentions = (selector: string, theme: ThemeKey) => selector.includes(`[data-theme="${theme}"]`);
const animated = rules.filter((r) => r.decls.some(([p, v]) => p === "animation" && !/^none\b/.test(v)));

describe("the flat themes of D1 draw nothing and move nothing", () => {
  for (const key of PLAIN) {
    it(`${key}: each of the four places is display:none, no file is asked for`, () => {
      for (const kind of DECOR_KINDS) {
        const mine = rules.filter((r) => mentions(r.selector, key) && r.selector.endsWith(`.zk-decor-${kind}`));
        expect(mine.length, `${key} has no rule for «${kind}»`).toBeGreaterThan(0);
        for (const r of mine) expect(valueOf(r, "display"), `${key} ${kind}`).toBe("none");
      }
      expect(decorFilesOf(key)).toEqual([]);
    });

    it(`${key}: no infinite animation and no will-change anywhere in the stylesheet reaches it`, () => {
      expect(Object.keys(COMPOSED)).not.toContain(key);
      expect(Object.keys(PATTERN)).not.toContain(key);
      expect(Object.keys(PHOTOGRAPHIC)).not.toContain(key);
      expect(animated.filter((r) => mentions(r.selector, key)).map((r) => r.selector)).toEqual([]);
      expect(rules.filter((r) => mentions(r.selector, key) && r.decls.some(([p]) => p === "will-change"))).toEqual([]);
    });
  }

  it("the files the flat themes would own are not on the list of files", () => {
    expect(allDecorFiles().filter((file) => PLAIN.some((key) => file.startsWith(`${key}.`)))).toEqual([]);
  });
});

describe("the old themes keep their decoration", () => {
  it("the four old themes are still the four old themes", () => {
    expect([...OLD].sort()).toEqual(["day", "islamic-epic", "neon-coast", "night"]);
  });

  it("each of them still draws in the four places (a rule per place); the two with pictures still own their files", () => {
    for (const key of OLD) {
      for (const kind of DECOR_KINDS) {
        const mine = rules.filter((r) => mentions(r.selector, key) && r.selector.includes(`.zk-decor-${kind}`) && !r.selector.startsWith("[data-decor"));
        expect(mine.length, `${key} lost «${kind}»`).toBeGreaterThan(0);
        for (const r of mine) expect(valueOf(r, "display"), `${key} ${kind}`).not.toBe("none");
      }
    }
    for (const key of ["islamic-epic", "neon-coast"] as const) expect(decorFilesOf(key).length, key).toBeGreaterThan(0);
  });

  it("each of them still has its slow motion at the full level, and only at the full level", () => {
    for (const key of OLD) {
      const moving = animated.filter((r) => mentions(r.selector, key));
      expect(moving.length, `${key} lost its motion`).toBeGreaterThan(0);
      for (const r of moving) expect(r.selector.startsWith('[data-decor="full"]'), r.selector).toBe(true);
    }
  });
});

describe("the stops: a hidden tab pauses, «وضع التوفير» removes", () => {
  it("— a hidden tab still pauses every layer", () => {
    expect(DECOR_HIDDEN_ATTR).toBe("data-decor-hidden");
    const paused = rules.filter((r) => r.selector.startsWith(`[${DECOR_HIDDEN_ATTR}]`));
    expect(paused.length).toBe(3);
    for (const r of paused) expect(valueOf(r, "animation-play-state")).toBe("paused !important");
  });

  it("— the economy stop hides the layers (as the level «off» does), after the motion rules and with !important", () => {
    expect(DECOR_ECONOMY_ATTR).toBe("data-decor-economy");
    const stops = rules.filter((r) => r.selector.startsWith(`[${DECOR_ECONOMY_ATTR}]`));
    expect(stops.map((r) => r.selector)).toEqual([`[${DECOR_ECONOMY_ATTR}] .zk-decor`, ...ART_SCENES.map((slot) => `[${DECOR_ECONOMY_ATTR}] [data-art-slot="${slot}"]`)]);
    for (const r of stops) expect(valueOf(r, "display"), r.selector).toBe("none !important");
    expect(css.indexOf(`[${DECOR_ECONOMY_ATTR}] .zk-decor,`)).toBeGreaterThan(css.indexOf("zk-decor-zoom 70s"));
  });

  it("— a layer hidden by economy cannot be shown again by a theme's own rule (!important), and the level «off» still works as before", () => {
    const off = rules.filter((r) => r.selector === '[data-decor="off"] .zk-decor');
    expect(off.length).toBeGreaterThan(0);
    expect(rules.filter((r) => r.selector.startsWith("[data-decor-economy]") && !valueOf(r, "display")?.endsWith("!important"))).toEqual([]);
  });

  it("— the committed stylesheet is the generated one", () => {
    expect(normalizeText(read("src", "components", "theme", "decor.css"))).toBe(normalizeText(css));
    expect(DECOR_CSS_FILE).toContain("decor.css");
  });
});

describe("syncDecorEconomy writes the attribute from the company's switch", () => {
  const fake = () => {
    const attrs = new Map<string, string>();
    return { attrs, el: { setAttribute: (n: string, v: string) => void attrs.set(n, v), removeAttribute: (n: string) => void attrs.delete(n) } };
  };

  it("on: the attribute is there; off: it is gone; again: nothing changes", () => {
    const { attrs, el } = fake();
    syncDecorEconomy(el, true);
    expect(attrs.get(DECOR_ECONOMY_ATTR)).toBe("1");
    syncDecorEconomy(el, true);
    expect(attrs.get(DECOR_ECONOMY_ATTR)).toBe("1");
    syncDecorEconomy(el, false);
    expect(attrs.has(DECOR_ECONOMY_ATTR)).toBe(false);
  });

  it("the last layer to go takes the attribute off <html>; one that goes while another stays leaves it", () => {
    const { attrs, el } = fake();
    const first = holdDecorEconomy(el);
    const second = holdDecorEconomy(el);
    syncDecorEconomy(el, true);
    first();
    first();
    expect(attrs.get(DECOR_ECONOMY_ATTR), "one layer is still on the page").toBe("1");
    second();
    expect(attrs.has(DECOR_ECONOMY_ATTR), "the last one took it away").toBe(false);
  });

  it("the layer's client leaf reads the economy of the screen and keeps the pause for a hidden tab as it was", () => {
    const leaf = stripComments(read("src", "components", "theme", "decor-visibility.tsx"));
    expect(leaf).toContain("watchDecorVisibility(document)");
    expect(leaf).toContain("syncDecorEconomy(document.documentElement, economyActive())");
    expect(leaf).toMatch(/from "@\/lib\/economy"/);
  });
});
