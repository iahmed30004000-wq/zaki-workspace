import { SOUND_EVENTS, isSoundChoice, type SoundChoices, type SoundEvent } from "./choice";

/**
 * This device's COPY of the account's sound choices (`User.chatPrefs.sounds`), in `localStorage` `zk-sounds`: a call rings at once, with no request to wait
 * for. The account stays the truth: the copy is rewritten whenever the account's answer is applied (`use-person-prefs.ts`).
 *
 * The choices are a part of «تيليجرام على التلفون»: they count only on a phone-wide screen whose app frame carries `data-tg-phone` (the switch `tgPhone`).
 * A computer, or the switch off, hears exactly what it always heard.
 */
export const SOUND_MIRROR_KEY = "zk-sounds";

interface MirrorStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): MirrorStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Only the five events, and only values that are choices. */
export function cleanSoundChoices(raw: unknown): SoundChoices {
  const out: SoundChoices = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const event of SOUND_EVENTS) {
    const value = (raw as Record<string, unknown>)[event];
    if (isSoundChoice(value)) out[event] = value;
  }
  return out;
}

export function readSoundMirror(storage: MirrorStorage | null = defaultStorage()): SoundChoices {
  try {
    const text = storage?.getItem(SOUND_MIRROR_KEY);
    return text ? cleanSoundChoices(JSON.parse(text)) : {};
  } catch {
    return {};
  }
}

export function saveSoundMirror(choices: unknown, storage: MirrorStorage | null = defaultStorage()): void {
  const clean = cleanSoundChoices(choices);
  try {
    if (Object.keys(clean).length === 0) storage?.removeItem(SOUND_MIRROR_KEY);
    else storage?.setItem(SOUND_MIRROR_KEY, JSON.stringify(clean));
  } catch {
    /* a private window: the choice lasts until the page closes */
  }
}

/** The choices after one event's: `null` is «افتراضي», which forgets the event. */
export function withSoundChoice(choices: SoundChoices, event: SoundEvent, choice: string | null): SoundChoices {
  const next: SoundChoices = { ...choices };
  if (choice === null) delete next[event];
  else next[event] = choice;
  return next;
}

/** Is this a phone with Telegram's look on, right now? */
export function tgPhoneNow(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return typeof document.querySelector === "function" && document.querySelector("[data-tg-phone]") !== null && window.matchMedia("(max-width: 767px)").matches;
}

/** The choices that count here and now (empty: every event is «افتراضي»). */
export const activeSoundChoices = (): SoundChoices => (tgPhoneNow() ? readSoundMirror() : {});
