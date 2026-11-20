import { DEFAULT_WALLPAPER, WALLPAPERS, fontScaleOf, isPhotoWallpaper, type Wallpaper } from "@/lib/chat/prefs";
import { effectiveFontStep, type DevicePrefs } from "@/lib/device-prefs";

/**
 * C4.1 — the two choices of «الدردشة» that must show AT ONCE, without a reload: the text size and the wallpaper. Plain functions over a document (a test hands
 * one in), no React.
 *
 *   text size   `--chat-font-scale` on <html> (globals.css scales the chat and list sizes by it); the device's own override wins over the account's.
 *   wallpaper   one of the six in-house patterns (public/brand/wallpapers/*.svg, black strokes) drawn behind the messages of the open conversation, tinted by the
 *               theme's `--chat-pattern` (re-tinted when the theme changes); «plain» draws nothing and removes the rule.
 */
export const FONT_SCALE_VAR = "--chat-font-scale";
export const WALLPAPER_VAR = "--chat-wallpaper-image";
export const WALLPAPER_TALL_VAR = "--chat-wallpaper-image-tall";
export const WALLPAPER_STYLE_ID = "zk-chat-wallpaper";
const WALLPAPER_PATH = "/brand/wallpapers/";

/** The rule that draws the pattern behind the messages of the new chat screen. Only the theme's tokens are read: no colour is written here. */
export function wallpaperRule(): string {
  const log = `[role="log"][data-conversation-id]`;
  const photo = `html[data-chat-wallpaper-kind="photo"] ${log}`;
  // a pattern repeats small; a picture covers the conversation (the tall file on a phone)
  return `${log}{background-color:rgb(var(--chat-wallpaper));background-image:var(${WALLPAPER_VAR},none);background-size:96px 96px}${photo}{background-size:cover;background-position:center}@media (max-width:767px){${photo}{background-image:var(${WALLPAPER_TALL_VAR},var(${WALLPAPER_VAR},none))}}`;
}

/** An SVG of the set with its strokes (drawn black in the files) painted in the given colour (the theme's `--chat-pattern`, «r g b»). */
export function tintSvg(svg: string, channels: string): string {
  const rgb = channels.trim().split(/\s+/).slice(0, 3).join(",");
  return /^\d{1,3},\d{1,3},\d{1,3}$/.test(rgb) ? svg.replace(/stroke="[^"]*"/g, `stroke="rgb(${rgb})"`) : svg;
}

export function svgDataUrl(svg: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function isWallpaper(value: unknown): value is Wallpaper {
  return typeof value === "string" && (WALLPAPERS as readonly string[]).includes(value);
}

interface DocLike {
  documentElement: { style: { setProperty(name: string, value: string): void; removeProperty(name: string): void }; setAttribute(name: string, value: string): void; removeAttribute(name: string): void };
  getElementById(id: string): { textContent: string | null; remove(): void } | null;
  createElement(tag: string): { id: string; textContent: string | null };
  head: { appendChild(node: unknown): unknown };
}

/** Sets the text size now. `null` puts it back to the stylesheet's own (1). */
export function applyFontScale(doc: Pick<DocLike, "documentElement">, scale: number | null): void {
  if (scale === null) doc.documentElement.style.removeProperty(FONT_SCALE_VAR);
  else doc.documentElement.style.setProperty(FONT_SCALE_VAR, String(scale));
}

/**
 * Draws (or removes) the wallpaper now. `channels` is the theme's pattern colour; `fetchSvg` gets the pattern's text (same site, cached by the browser).
 * Resolves when the pattern is in place. A failed read leaves the wallpaper off (the rule is removed): never a half-drawn page.
 */
export async function applyWallpaper(doc: DocLike, wallpaper: Wallpaper | undefined, channels: string, fetchSvg: (url: string) => Promise<string>): Promise<void> {
  const html = doc.documentElement;
  const rule = doc.getElementById(WALLPAPER_STYLE_ID);
  const clear = () => {
    html.removeAttribute("data-chat-wallpaper");
    html.removeAttribute("data-chat-wallpaper-kind");
    html.style.removeProperty(WALLPAPER_VAR);
    html.style.removeProperty(WALLPAPER_TALL_VAR);
  };
  if (!wallpaper || wallpaper === "plain") {
    clear();
    rule?.remove();
    return;
  }
  const ensureRule = () => {
    const current = doc.getElementById(WALLPAPER_STYLE_ID);
    if (current) {
      current.textContent = wallpaperRule();
      return;
    }
    const style = doc.createElement("style");
    style.id = WALLPAPER_STYLE_ID;
    style.textContent = wallpaperRule();
    doc.head.appendChild(style);
  };
  if (isPhotoWallpaper(wallpaper)) {
    // a picture: the file is the image (no fetch, no tint); a phone gets the tall one
    clear();
    html.style.setProperty(WALLPAPER_VAR, `url("${WALLPAPER_PATH}photo/${wallpaper}.webp")`);
    html.style.setProperty(WALLPAPER_TALL_VAR, `url("${WALLPAPER_PATH}photo/${wallpaper}-tall.webp")`);
    html.setAttribute("data-chat-wallpaper", wallpaper);
    html.setAttribute("data-chat-wallpaper-kind", "photo");
    ensureRule();
    return;
  }
  try {
    const svg = await fetchSvg(`${WALLPAPER_PATH}${wallpaper}.svg`);
    html.removeAttribute("data-chat-wallpaper-kind");
    html.style.removeProperty(WALLPAPER_TALL_VAR);
    html.style.setProperty(WALLPAPER_VAR, svgDataUrl(tintSvg(svg, channels)));
    html.setAttribute("data-chat-wallpaper", wallpaper);
    ensureRule();
  } catch {
    clear();
    rule?.remove();
  }
}

let watching = false;
/** The wallpaper in force on this page: the theme observer re-tints THIS one, whenever the choice last changed. */
let active: Wallpaper | undefined;

function paint(): void {
  const channels = getComputedStyle(document.documentElement).getPropertyValue("--chat-pattern");
  void applyWallpaper(document as unknown as DocLike, active, channels, async (url) => {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(String(res.status));
    return res.text();
  });
}

/** The browser: applies both choices from what this device holds (and keeps the wallpaper tinted when the theme changes). Safe to call again. */
export function applyAppearance(device: DevicePrefs): void {
  if (typeof document === "undefined") return;
  applyFontScale(document, fontScaleOf(effectiveFontStep(device)));
  active = device.mirror?.wallpaper ?? DEFAULT_WALLPAPER;
  paint();
  if (!watching && typeof MutationObserver !== "undefined") {
    watching = true;
    new MutationObserver(() => {
      if (active && active !== "plain") paint();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
}
