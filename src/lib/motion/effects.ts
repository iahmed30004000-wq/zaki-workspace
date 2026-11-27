/**
 * «التأثيرات الحركية»: what THIS device draws. A weak phone is a fact about the phone, so the choices live with the other device choices
 * (`zk-device-prefs`, field `effectsOff`: the ones switched off) and are written on `<html data-fx-off="…">`, before the first paint by the boot script
 * (`src/lib/themes/boot.ts`) and again whenever the person changes one. CSS reads the attribute; code that animates by itself (canvas, Web Animations)
 * asks `effectOn(key)` first, because no style rule stops those.
 */
export const EFFECT_KEYS = ["stickers", "emoji", "wallpaper", "blur", "zoom", "dust", "particles", "transitions"] as const;
export type EffectKey = (typeof EFFECT_KEYS)[number];

export function isEffectKey(value: unknown): value is EffectKey {
  return typeof value === "string" && (EFFECT_KEYS as readonly string[]).includes(value);
}

/** The attribute on `<html>`: the switched-off effects, separated by spaces. */
export const EFFECTS_ATTR = "data-fx-off";
/** Told to the page when a choice changes, so what is mounted follows at once. */
export const EFFECTS_EVENT = "zk-effects";

/** What a request for less motion stops. «blur» stays: a blurred bar does not move. */
export const MOTION_EFFECTS: ReadonlySet<EffectKey> = new Set(["stickers", "emoji", "wallpaper", "zoom", "dust", "particles", "transitions"]);
/** What the company's «وضع التوفير» stops: the expensive drawing. */
export const ECONOMY_EFFECTS: ReadonlySet<EffectKey> = new Set(["wallpaper", "blur", "dust", "particles"]);

export interface EffectFacts {
  /** the keys switched off on this device */
  off: readonly string[];
  reducedMotion: boolean;
  economy: boolean;
}

/** The one rule, with every fact handed to it. */
export function effectAllowed(key: EffectKey, facts: EffectFacts): boolean {
  if (facts.off.includes(key)) return false;
  if (facts.reducedMotion && MOTION_EFFECTS.has(key)) return false;
  if (facts.economy && ECONOMY_EFFECTS.has(key)) return false;
  return true;
}

/** The facts as the page knows them now. With no page (the server, a test without one) everything is as the spec says. */
export function effectFacts(): EffectFacts {
  if (typeof document === "undefined" || typeof window === "undefined") return { off: [], reducedMotion: false, economy: false };
  const root = document.documentElement;
  return {
    off: (root?.getAttribute(EFFECTS_ATTR) ?? "").split(" ").filter(Boolean),
    reducedMotion: typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    economy: root?.hasAttribute("data-decor-economy") === true,
  };
}

export const effectOn = (key: EffectKey): boolean => effectAllowed(key, effectFacts());

/** Writes the switched-off effects on `<html>` and tells the page. */
export function applyEffectsOff(off: readonly string[]): void {
  if (typeof document === "undefined") return;
  const list = off.filter(isEffectKey);
  if (list.length > 0) document.documentElement.setAttribute(EFFECTS_ATTR, list.join(" "));
  else document.documentElement.removeAttribute(EFFECTS_ATTR);
  window.dispatchEvent(new Event(EFFECTS_EVENT));
}
