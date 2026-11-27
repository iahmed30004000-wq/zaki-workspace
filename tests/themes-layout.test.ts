import * as React from "react";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Metadata } from "next";

/**
 * The root layout paints the chosen theme on the SERVER, from the cookie: no script, no flash.
 * next/font only works inside the Next compiler, and next/headers only inside a request, so all
 * three are replaced here; what is under test is what the layout does with them.
 */
const { jar, localFont, googleFont } = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  localFont: { calls: [] as unknown[] },
  googleFont: { calls: [] as unknown[] },
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined) }),
  headers: () => new Headers(),
}));
vi.mock("next/font/google", () => ({
  IBM_Plex_Sans_Arabic: (opts: unknown) => {
    googleFont.calls.push(opts);
    return { variable: "plex-variable", className: "plex-class", style: { fontFamily: "plex" } };
  },
  Lalezar: (opts: unknown) => {
    googleFont.calls.push(opts);
    return { variable: "lalezar-variable", className: "lalezar-class", style: { fontFamily: "lalezar" } };
  },
}));
vi.mock("next/font/local", () => ({
  default: (opts: unknown) => {
    localFont.calls.push(opts);
    return { variable: "reem-variable", className: "reem-class", style: { fontFamily: "reem" } };
  },
}));

(globalThis as { React?: typeof React }).React = React;

const layout = await import("@/app/layout");
const RootLayout = layout.default;

type Html = ReactElement<{
  lang: string;
  dir: string;
  className: string;
  "data-theme": string;
  "data-decor": string;
  suppressHydrationWarning?: boolean;
  children: ReactElement<{ children: ReactElement<{ theme: string; decor: string }> }>;
}>;

function render(): Html {
  return RootLayout({ children: null }) as Html;
}

beforeEach(() => jar.clear());

describe("the root layout paints the theme from the cookie", () => {
  it("Arabic, right-to-left, the default theme «ليل» (dark: the dark class) when there is no cookie", () => {
    const html = render();
    expect(html.type).toBe("html");
    expect(html.props.lang).toBe("ar");
    expect(html.props.dir).toBe("rtl");
    expect(html.props["data-theme"]).toBe("night");
    expect(html.props["data-decor"]).toBe("light");
    expect(html.props.className.split(/\s+/)).toContain("dark");
  });

  it("a retired theme in the cookie («إسلامي هادي») is painted as «ليل», never as an attribute that matches nothing", () => {
    jar.set("zaki_theme", "islamic-calm");
    expect(render().props["data-theme"]).toBe("night");
  });

  it("a dark theme from the cookie carries the dark class (Tailwind's dark: variants)", () => {
    jar.set("zaki_theme", "neon-coast");
    const html = render();
    expect(html.props["data-theme"]).toBe("neon-coast");
    expect(html.props.className.split(/\s+/)).toContain("dark");
    jar.set("zaki_theme", "islamic-epic");
    expect(render().props.className.split(/\s+/)).toContain("dark");
  });

  it("a light theme from the cookie has no dark class", () => {
    jar.set("zaki_theme", "day");
    const html = render();
    expect(html.props["data-theme"]).toBe("day");
    expect(html.props.className.split(/\s+/)).not.toContain("dark");
  });

  it("an old or forged cookie value is the default theme, never an attribute that matches nothing", () => {
    for (const value of ["system", "dark", "neon", '"><script>', ""]) {
      jar.set("zaki_theme", value);
      expect(render().props["data-theme"], value).toBe("night");
    }
  });

  it("«الأرقام»: the zk-digits cookie is painted as data-digits (anything unknown, or nothing, is «latin»)", () => {
    expect((render().props as Record<string, unknown>)["data-digits"]).toBe("latin");
    jar.set("zk-digits", "arabic");
    expect((render().props as Record<string, unknown>)["data-digits"]).toBe("arabic");
    jar.set("zk-digits", "hindi");
    expect((render().props as Record<string, unknown>)["data-digits"]).toBe("latin");
  });

  it("the decoration level comes from the zk-decor cookie (anything unknown is the light touch)", () => {
    jar.set("zk-decor", "off");
    expect(render().props["data-decor"]).toBe("off");
    jar.set("zk-decor", "full");
    expect(render().props["data-decor"]).toBe("full");
    jar.set("zk-decor", "loud");
    expect(render().props["data-decor"]).toBe("light");
  });

  it("hands the same theme and level to the client providers (so the first client render matches)", () => {
    jar.set("zaki_theme", "islamic-epic");
    jar.set("zk-decor", "full");
    const body = render().props.children;
    expect(body.type).toBe("body");
    expect(body.props.children.props).toMatchObject({ theme: "islamic-epic", decor: "full" });
  });

  it("keeps the fonts' CSS variables on <html> and tolerates attributes added by browser extensions", () => {
    const html = render();
    expect(html.props.className.split(/\s+/)).toEqual(expect.arrayContaining(["plex-variable", "reem-variable", "lalezar-variable"]));
    expect(html.props.suppressHydrationWarning).toBe(true);
  });
});

describe("the fonts", () => {
  it("IBM Plex Sans Arabic stays the body face (--font-plex), carrying exactly the weights the interface uses", () => {
    expect(googleFont.calls[0]).toMatchObject({ variable: "--font-plex", display: "swap" });
    // 400 normal / 500 medium / 600 semibold / 700 bold — every weight the source asks for, no extra
    expect((googleFont.calls[0] as { weight: string[] }).weight).toEqual(["400", "500", "600", "700"]);
  });

  it("Lalezar is the wordmark face (--font-lalezar): Arabic, swapped in, not preloaded (only the wordmark wears it)", () => {
    expect(googleFont.calls[1]).toMatchObject({ variable: "--font-lalezar", display: "swap", subsets: ["arabic"], weight: "400", preload: false });
  });

  it("Reem Kufi is self-hosted from public/fonts, swapped in, PRELOADED (the titles are the first thing painted)", () => {
    const opts = localFont.calls[0] as { src: string; variable: string; display: string; preload: boolean };
    expect(opts).toMatchObject({ variable: "--font-reem", display: "swap", preload: true });
    // next/font/local resolves `src` from the layout's own folder
    expect(existsSync(path.resolve(__dirname, "../src/app", opts.src))).toBe(true);
    expect(opts.src.endsWith("public/fonts/reem-kufi-var.woff2")).toBe(true);
  });
});

describe("metadata and the browser chrome colour", () => {
  it("the installed app on a Mac/iPhone: standalone, titled «زكي», with iOS auto-detection off", () => {
    const meta = layout.metadata as Metadata;
    // apple-web-app meta tags: the installed page fills the screen and carries the app's own title
    expect(meta.appleWebApp).toMatchObject({ capable: true, title: "ذكي", statusBarStyle: "default" });
    // Safari must not turn numbers into phone links, addresses into maps, dates into calendar events
    expect(meta.formatDetection).toMatchObject({ telephone: false, address: false, email: false, date: false });
  });

  it("the browser bar takes the chosen theme's page colour", () => {
    expect(layout.generateViewport().themeColor).toBe("#050F1F");
    jar.set("zaki_theme", "neon-coast");
    expect(layout.generateViewport()).toMatchObject({ width: "device-width", initialScale: 1, themeColor: "#061C28" });
  });

  it("the title is Zaki Workspace, pages are '<page> · Zaki Workspace', the description is Arabic", () => {
    expect(layout.metadata.title).toEqual({ default: "Zaki Workspace", template: "%s · Zaki Workspace" });
    expect(String(layout.metadata.description)).toMatch(/^[؀-ۿ\s،.:—-]+$/);
  });
});
