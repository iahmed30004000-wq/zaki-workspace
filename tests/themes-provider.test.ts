import { DIGIT_MODES } from "@/lib/digits";
import * as React from "react";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import { AR } from "@/lib/i18n/dict";
import {
  ThemeProvider,
  chooseDecor,
  chooseTheme,
  savedPreferences,
  useTheme,
  type ThemeContextValue,
} from "@/components/theme/theme-provider";
import { ThemePicker } from "@/components/theme/theme-picker";
import { PALETTES } from "@/lib/themes/palettes";
import { DECOR_LEVELS, PREF_COOKIE_MAX_AGE, THEME_KEYS, themeLabelKey, themeMoodKey } from "@/lib/themes/registry";

// The components are TSX; under vitest their JSX compiles to React.createElement, which needs a global React.
(globalThis as { React?: typeof React }).React = React;

const Translations = I18nProvider as unknown as FunctionComponent<{ initial: "ar"; children?: ReactNode }>;
const Themes = ThemeProvider as unknown as FunctionComponent<{ initialTheme: string; initialDecor: string; children?: ReactNode }>;

// ── a browser, as small as these functions need ─────────────────────────────

interface FakeDom {
  attrs: Map<string, string>;
  classes: Set<string>;
  cookies: string[];
  meta: { content: string };
  fetch: ReturnType<typeof vi.fn>;
}

function installBrowser(opts: { protocol?: string; withMeta?: boolean } = {}): FakeDom {
  const attrs = new Map<string, string>();
  const classes = new Set<string>(["plex-variable"]);
  const cookies: string[] = [];
  const meta = { content: "#F6F1E7", setAttribute(name: string, value: string) { if (name === "content") this.content = value; } };
  const doc = {
    documentElement: {
      setAttribute: (name: string, value: string) => void attrs.set(name, value),
      getAttribute: (name: string) => attrs.get(name) ?? null,
      classList: {
        toggle: (name: string, force?: boolean) => {
          const on = force ?? !classes.has(name);
          if (on) classes.add(name);
          else classes.delete(name);
          return on;
        },
        contains: (name: string) => classes.has(name),
      },
    },
    querySelector: (selector: string) => (opts.withMeta !== false && selector === 'meta[name="theme-color"]' ? meta : null),
  };
  Object.defineProperty(doc, "cookie", {
    get: () => cookies.join("; "),
    set: (value: string) => void cookies.push(value),
  });
  const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("document", doc);
  vi.stubGlobal("location", { protocol: opts.protocol ?? "https:" });
  vi.stubGlobal("fetch", fetch);
  return { attrs, classes, cookies, meta, fetch };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("choosing a theme in the browser", () => {
  let dom: FakeDom;
  beforeEach(() => {
    dom = installBrowser();
  });

  it("repaints <html> at once: data-theme, the dark class, and the browser bar colour", async () => {
    chooseTheme("neon-coast");
    expect(dom.attrs.get("data-theme")).toBe("neon-coast");
    expect(dom.classes.has("dark")).toBe(true);
    expect(dom.classes.has("plex-variable")).toBe(true);
    expect(dom.meta.content).toBe(PALETTES["neon-coast"].colors.surface);

    chooseTheme("day");
    expect(dom.attrs.get("data-theme")).toBe("day");
    expect(dom.classes.has("dark")).toBe(false);
    await savedPreferences();
  });

  it("remembers it in the zaki_theme cookie for a year (Secure on https)", async () => {
    chooseTheme("islamic-epic");
    expect(dom.cookies).toContain(`zaki_theme=islamic-epic; Path=/; Max-Age=${PREF_COOKIE_MAX_AGE}; SameSite=Lax; Secure`);
    await savedPreferences();
  });

  it("on plain http (a local machine) the cookie is not marked Secure, or the browser would drop it", async () => {
    vi.unstubAllGlobals();
    dom = installBrowser({ protocol: "http:" });
    chooseTheme("day");
    expect(dom.cookies).toContain(`zaki_theme=day; Path=/; Max-Age=${PREF_COOKIE_MAX_AGE}; SameSite=Lax`);
    await savedPreferences();
  });

  it("saves it to the account with POST /api/me/theme", async () => {
    chooseTheme("neon-coast");
    await savedPreferences();
    expect(dom.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = dom.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/me/theme");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ theme: "neon-coast" });
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("a failed save (signed out, offline) changes nothing on screen and throws nothing", async () => {
    dom.fetch.mockImplementation(async () => {
      throw new TypeError("offline");
    });
    expect(() => chooseTheme("day")).not.toThrow();
    await expect(savedPreferences()).resolves.toBeUndefined();
    dom.fetch.mockImplementation(async () => new Response("{}", { status: 401 }));
    chooseTheme("night");
    await expect(savedPreferences()).resolves.toBeUndefined();
    expect(dom.attrs.get("data-theme")).toBe("night");
  });

  it("saves one choice after another, in order, so a slow answer cannot bring back an older theme", async () => {
    let release: () => void = () => {};
    dom.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(new Response("{}"));
        }),
    );
    chooseTheme("neon-coast");
    chooseTheme("day");
    await Promise.resolve();
    await Promise.resolve();
    expect(dom.fetch).toHaveBeenCalledTimes(1);
    release();
    await savedPreferences();
    expect(dom.fetch).toHaveBeenCalledTimes(2);
    const bodies = dom.fetch.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    expect(bodies).toEqual([{ theme: "neon-coast" }, { theme: "day" }]);
  });

  it("works before the page has a theme-color tag", async () => {
    vi.unstubAllGlobals();
    dom = installBrowser({ withMeta: false });
    expect(() => chooseTheme("islamic-epic")).not.toThrow();
    expect(dom.attrs.get("data-theme")).toBe("islamic-epic");
    await savedPreferences();
  });
});

describe("choosing a decoration level", () => {
  it("sets data-decor, the zk-decor cookie, and saves it", async () => {
    const dom = installBrowser();
    chooseDecor("off");
    expect(dom.attrs.get("data-decor")).toBe("off");
    expect(dom.cookies).toContain(`zk-decor=off; Path=/; Max-Age=${PREF_COOKIE_MAX_AGE}; SameSite=Lax; Secure`);
    await savedPreferences();
    expect(JSON.parse(String((dom.fetch.mock.calls[0]![1] as RequestInit).body))).toEqual({ decor: "off" });
  });
});

// ── the provider ────────────────────────────────────────────────────────────

function capture(initialTheme: string, initialDecor: string): ThemeContextValue {
  let seen: ThemeContextValue | null = null;
  const Probe = () => {
    seen = useTheme();
    return null;
  };
  renderToStaticMarkup(createElement(Themes, { initialTheme, initialDecor }, createElement(Probe)));
  if (!seen) throw new Error("the probe did not render");
  return seen;
}

describe("ThemeProvider / useTheme", () => {
  it("starts from what the server painted, and lists the four themes", () => {
    const ctx = capture("islamic-epic", "full");
    expect(ctx.theme).toBe("islamic-epic");
    expect(ctx.decor).toBe("full");
    expect(ctx.themes.map((t) => t.key)).toEqual([...THEME_KEYS]);
  });

  it("a garbage initial value from a forged cookie is the default", () => {
    const ctx = capture("system", "loud");
    expect(ctx.theme).toBe("night");
    expect(ctx.decor).toBe("light");
  });

  it("setTheme and setDecor apply, remember and save", async () => {
    const dom = installBrowser();
    const ctx = capture("night", "light");
    ctx.setTheme("neon-coast");
    ctx.setDecor("full");
    expect(dom.attrs.get("data-theme")).toBe("neon-coast");
    expect(dom.attrs.get("data-decor")).toBe("full");
    expect(dom.cookies.some((c) => c.startsWith("zaki_theme=neon-coast;"))).toBe(true);
    expect(dom.cookies.some((c) => c.startsWith("zk-decor=full;"))).toBe(true);
    await savedPreferences();
    expect(dom.fetch).toHaveBeenCalledTimes(2);
  });

  it("outside a provider it still answers (the default) instead of crashing the page", () => {
    let seen: ThemeContextValue | null = null;
    const Probe = () => {
      seen = useTheme();
      return null;
    };
    renderToStaticMarkup(createElement(Probe));
    expect(seen).toMatchObject({ theme: "night", decor: "light" });
  });
});

// ── the picker ──────────────────────────────────────────────────────────────

function renderPicker(theme: string, decor: string): string {
  return renderToStaticMarkup(
    createElement(Translations, { initial: "ar" }, createElement(Themes, { initialTheme: theme, initialDecor: decor }, createElement(ThemePicker))),
  );
}

const count = (markup: string, pattern: RegExp) => (markup.match(pattern) ?? []).length;

describe("ThemePicker", () => {
  const markup = renderPicker("neon-coast", "off");

  it("is the tour's theme stop and a labelled group of six radio cards", () => {
    expect(markup).toContain('data-tour="theme"');
    expect(markup).toMatch(/<fieldset[^>]*>[\s\S]*<legend[^>]*>[^<]*المظهر/);
    expect(count(markup, /type="radio" name="zk-theme"/g)).toBe(6);
    for (const key of THEME_KEYS) expect(markup).toContain(`value="${key}"`);
  });

  it("marks the current theme as the checked radio, and only it", () => {
    const radios = markup.match(/<input[^>]*name="zk-theme"[^>]*>/g) ?? [];
    const checked = radios.filter((r) => /\schecked(="")?/.test(r));
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain('value="neon-coast"');
  });

  it("each card previews its theme with that theme's own tokens (data-theme on the preview), hidden from screen readers", () => {
    for (const key of THEME_KEYS) {
      expect(markup).toMatch(new RegExp(`<[a-z]+[^>]*data-theme="${key}"[^>]*aria-hidden="true"|<[a-z]+[^>]*aria-hidden="true"[^>]*data-theme="${key}"`));
    }
  });

  it("shows each theme's Arabic name and mood", () => {
    expect(AR[themeLabelKey("night")]).toBe("ليل");
    expect(AR[themeLabelKey("day")]).toBe("نهار");
    expect(AR[themeLabelKey("islamic-epic")]).toBe("إسلامي ملحمي");
    expect(AR[themeLabelKey("neon-coast")]).toBe("ساحل النيون");
    // the retired theme's strings left with it
    expect(AR["theme.islamic-calm"]).toBeUndefined();
    for (const key of THEME_KEYS) {
      expect(markup).toContain(AR[themeLabelKey(key)]!);
      expect(AR[themeMoodKey(key)], key).toMatch(/[؀-ۿ]/);
      expect(markup).toContain(AR[themeMoodKey(key)]!);
    }
  });

  it("offers the three decoration levels, the current one checked", () => {
    expect(count(markup, /type="radio" name="zk-decor"/g)).toBe(DECOR_LEVELS.length);
    for (const label of ["بدون زخرفة", "خفيفة", "كاملة"]) expect(markup).toContain(label);
    const checked = (markup.match(/<input[^>]*name="zk-decor"[^>]*>/g) ?? []).filter((r) => /\schecked(="")?/.test(r));
    expect(checked).toHaveLength(1);
    expect(checked[0]).toContain('value="off"');
  });

  it("every target is at least 44px tall and shows a focus ring", () => {
    const labels = markup.match(/<label[^>]*>/g) ?? [];
    // the four themes, the three decoration levels and the two digit shapes («الأرقام»)
    expect(labels.length).toBe(THEME_KEYS.length + DECOR_LEVELS.length + DIGIT_MODES.length);
    for (const label of labels) {
      expect(label).toMatch(/min-h-11|min-h-\[44px\]|min-h-24/);
      expect(label).toMatch(/has-\[:focus-visible\]:ring-2/);
    }
  });

  it("has no English on screen", () => {
    const text = markup.replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/[A-Za-z]/);
  });
});
