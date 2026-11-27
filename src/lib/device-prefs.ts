import { DEFAULT_FONT_STEP, FONT_SCALES, QUICK_REACTION_COUNT, SEND_KEYS, WALLPAPERS, isOneEmoji, type ChatPrefs, type SendKey, type Wallpaper } from "@/lib/chat/prefs";
import { isEffectKey, type EffectKey } from "@/lib/motion/effects";

/**
 * C4.1 — the choices that belong to ONE DEVICE, kept in `localStorage` under `zk-device-prefs` (like Telegram's data settings: a phone on mobile data and a
 * laptop on the office wifi want different things). Pure and client-only: no React, no server import; every reader takes the storage it should use, so a test
 * hands it a plain object and a browser without storage (private window, a webview) simply gets the defaults.
 *
 *   textSize       a text size step (0-4) that OVERRIDES the person's own on this device (null / absent: use the person's)
 *   imageQuality   «عادية» (the 1600 px resize the composer always did) or «عالية» (3200 px, a better quality)
 *   autoDownload   which kinds download by themselves on wifi and on mobile data
 *   effectsOff     «التأثيرات الحركية»: the effects switched off on this device (`src/lib/motion/effects.ts`)
 *   mirror         a COPY of the person's own choices (the ones saved on the account in `User.chatPrefs`) that the page can read before any request has
 *                  answered, so the text size and the wallpaper are right on the first paint and the composer knows the send key. The account stays the
 *                  truth: the settings screen and the chat shell rewrite the mirror whenever they read it.
 *
 * Reading is forgiving (whatever is wrong is dropped, the rest is kept) and never throws.
 */
export const DEVICE_PREFS_KEY = "zk-device-prefs";
/** How long a mirror is trusted before the page asks the account again. */
export const MIRROR_FRESH_MS = 6 * 60 * 60 * 1000;

export const MEDIA_KINDS = ["images", "video", "files"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export type Connection = "wifi" | "mobile";
export type AutoDownload = Record<Connection, Record<MediaKind, boolean>>;

/** What downloads by itself until the person says otherwise: pictures on both, everything on wifi, nothing big on mobile data. */
export const DEFAULT_AUTO_DOWNLOAD: AutoDownload = {
  wifi: { images: true, video: true, files: true },
  mobile: { images: true, video: false, files: false },
};

export const IMAGE_QUALITIES = ["normal", "high"] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

export interface DeviceMirror {
  fontStep?: number;
  wallpaper?: Wallpaper;
  sendKey?: SendKey;
  quickReactions?: string[];
  doubleTap?: string;
  themeAuto?: boolean;
  /** the company's switch `themeV2Default` as this person's account last saw it (the boot script of the layout reads it) */
  themeV2?: boolean;
  /** when the mirror was last written (ms since 1970) */
  at?: number;
}

export interface DevicePrefs {
  textSize?: number;
  imageQuality?: ImageQuality;
  autoDownload?: Partial<Record<Connection, Partial<Record<MediaKind, boolean>>>>;
  mirror?: DeviceMirror;
  effectsOff?: EffectKey[];
}

export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): PrefsStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const isPlain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isStep = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value < FONT_SCALES.length;

/** Cleans anything read from storage (or about to be written) into a valid `DevicePrefs`. */
export function cleanDevicePrefs(raw: unknown): DevicePrefs {
  if (!isPlain(raw)) return {};
  const out: DevicePrefs = {};
  if (isStep(raw["textSize"])) out.textSize = raw["textSize"];
  if (typeof raw["imageQuality"] === "string" && (IMAGE_QUALITIES as readonly string[]).includes(raw["imageQuality"])) out.imageQuality = raw["imageQuality"] as ImageQuality;

  if (isPlain(raw["autoDownload"])) {
    const auto: Partial<Record<Connection, Partial<Record<MediaKind, boolean>>>> = {};
    for (const connection of ["wifi", "mobile"] as const) {
      const row = raw["autoDownload"][connection];
      if (!isPlain(row)) continue;
      const kinds: Partial<Record<MediaKind, boolean>> = {};
      for (const kind of MEDIA_KINDS) if (typeof row[kind] === "boolean") kinds[kind] = row[kind] as boolean;
      if (Object.keys(kinds).length > 0) auto[connection] = kinds;
    }
    if (Object.keys(auto).length > 0) out.autoDownload = auto;
  }

  if (Array.isArray(raw["effectsOff"])) {
    const off = [...new Set(raw["effectsOff"].filter(isEffectKey))];
    if (off.length > 0) out.effectsOff = off;
  }

  if (isPlain(raw["mirror"])) {
    const m = raw["mirror"];
    const mirror: DeviceMirror = {};
    if (isStep(m["fontStep"])) mirror.fontStep = m["fontStep"];
    if (typeof m["wallpaper"] === "string" && (WALLPAPERS as readonly string[]).includes(m["wallpaper"])) mirror.wallpaper = m["wallpaper"] as Wallpaper;
    if (typeof m["sendKey"] === "string" && (SEND_KEYS as readonly string[]).includes(m["sendKey"])) mirror.sendKey = m["sendKey"] as SendKey;
    const quick = m["quickReactions"];
    if (Array.isArray(quick) && quick.length === QUICK_REACTION_COUNT && quick.every(isOneEmoji) && new Set(quick).size === QUICK_REACTION_COUNT) mirror.quickReactions = [...(quick as string[])];
    if (isOneEmoji(m["doubleTap"])) mirror.doubleTap = m["doubleTap"];
    if (typeof m["themeAuto"] === "boolean") mirror.themeAuto = m["themeAuto"];
    if (typeof m["themeV2"] === "boolean") mirror.themeV2 = m["themeV2"];
    if (typeof m["at"] === "number" && Number.isFinite(m["at"])) mirror.at = m["at"];
    if (Object.keys(mirror).length > 0) out.mirror = mirror;
  }
  return out;
}

export function readDevicePrefs(storage: PrefsStorage | null = defaultStorage()): DevicePrefs {
  try {
    const text = storage?.getItem(DEVICE_PREFS_KEY);
    return text ? cleanDevicePrefs(JSON.parse(text)) : {};
  } catch {
    return {};
  }
}

/** Replaces the whole stored object (cleaned first). An empty object removes the key. Never throws: a private window keeps the choice until the page closes. */
export function saveDevicePrefs(next: DevicePrefs, storage: PrefsStorage | null = defaultStorage()): DevicePrefs {
  const clean = cleanDevicePrefs(next);
  try {
    if (Object.keys(clean).length === 0) storage?.removeItem(DEVICE_PREFS_KEY);
    else storage?.setItem(DEVICE_PREFS_KEY, JSON.stringify(clean));
  } catch {
    /* no storage here */
  }
  return clean;
}

/** Changes some of the fields and keeps the rest; a field set to `undefined` is removed. */
export function patchDevicePrefs(patch: Partial<DevicePrefs>, storage: PrefsStorage | null = defaultStorage()): DevicePrefs {
  const merged: Record<string, unknown> = { ...readDevicePrefs(storage) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return saveDevicePrefs(merged as DevicePrefs, storage);
}

/** The text size step in force on this device: the device's own override, else the person's (mirrored), else today's. */
export function effectiveFontStep(prefs: DevicePrefs): number {
  return prefs.textSize ?? prefs.mirror?.fontStep ?? DEFAULT_FONT_STEP;
}

/** Does this kind of file download by itself on this connection? */
export function autoDownloadOn(prefs: DevicePrefs, connection: Connection, kind: MediaKind): boolean {
  return prefs.autoDownload?.[connection]?.[kind] ?? DEFAULT_AUTO_DOWNLOAD[connection][kind];
}

/** The copy of the person's account choices that this device keeps (`at` stamps it). */
export function mirrorOf(prefs: ChatPrefs, now: number): DeviceMirror {
  const chat = prefs.chat ?? {};
  const mirror: DeviceMirror = { at: now };
  if (isStep(chat.fontStep)) mirror.fontStep = chat.fontStep;
  if (typeof chat.wallpaper === "string" && (WALLPAPERS as readonly string[]).includes(chat.wallpaper)) mirror.wallpaper = chat.wallpaper as Wallpaper;
  if (chat.sendKey === "ctrl" || chat.sendKey === "enter") mirror.sendKey = chat.sendKey;
  if (Array.isArray(chat.quickReactions)) mirror.quickReactions = [...chat.quickReactions];
  if (typeof chat.doubleTap === "string") mirror.doubleTap = chat.doubleTap;
  if (typeof chat.themeAuto === "boolean") mirror.themeAuto = chat.themeAuto;
  return mirror;
}

/** The mirror is old (or there is none): the page asks the account again. */
export function mirrorStale(prefs: DevicePrefs, now: number): boolean {
  const at = prefs.mirror?.at;
  return typeof at !== "number" || now - at > MIRROR_FRESH_MS || now < at;
}

/**
 * Sign-out: the copy of the person's ACCOUNT choices (the mirror) goes, so the next person to use this browser starts from the defaults and not from somebody else's
 * theme, text size, send key or reactions. The device's own choices (the text size override, the picture quality, the automatic download) are about the device and stay.
 */
export function clearMirror(storage: PrefsStorage | null = defaultStorage()): void {
  patchDevicePrefs({ mirror: undefined }, storage);
}
