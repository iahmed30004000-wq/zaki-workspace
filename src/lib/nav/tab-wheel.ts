/**
 * The place's tabs as a WHEEL on a phone (the owner, 2026-11-21: «زي المنبّه… بس يمين وشمال، 3 خيارات، والمحدد اللي بالنص، مع أنيميشن وصوت ويقدر يطفّيه»).
 * Like the alarm's picker turned on its side: the tabs run sideways under the thumb, the one in the middle is the chosen one, and the ones beside it shrink and
 * fade. Three choices, kept on this device: the wheel itself (off: the plain strip it always was), the motion (the shrinking and fading), the tick (a small sound
 * and a buzz each time a new tab reaches the middle; off until asked for). All of it is plain data here, so it is tested without a browser.
 */

export interface WheelPrefs {
  /** the wheel (off: the plain strip) */
  wheel: boolean;
  /** the shrinking and fading of the tabs beside the middle one, and the smooth glide */
  motion: boolean;
  /** a tick (sound and a buzz) for each tab that reaches the middle */
  sound: boolean;
}

export const DEFAULT_WHEEL_PREFS: WheelPrefs = { wheel: true, motion: true, sound: false };

export const WHEEL_KEY = "zk-tab-wheel";
/** Fired on `window` when the choice is saved, so a strip that is on screen follows a switch flipped in the settings at once. */
export const WHEEL_EVENT = "zk-tab-wheel-change";

/** The remembered choice, read tolerantly: whatever is missing or is not a true/false answer keeps its default. */
export function parseWheelPrefs(raw: unknown): WheelPrefs {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_WHEEL_PREFS };
    }
  }
  if (!value || typeof value !== "object") return { ...DEFAULT_WHEEL_PREFS };
  const o = value as Record<string, unknown>;
  const pick = (key: keyof WheelPrefs): boolean => (typeof o[key] === "boolean" ? (o[key] as boolean) : DEFAULT_WHEEL_PREFS[key]);
  return { wheel: pick("wheel"), motion: pick("motion"), sound: pick("sound") };
}

export function loadWheelPrefs(): WheelPrefs {
  try {
    return parseWheelPrefs(localStorage.getItem(WHEEL_KEY));
  } catch {
    return { ...DEFAULT_WHEEL_PREFS };
  }
}

export function saveWheelPrefs(prefs: WheelPrefs): void {
  try {
    localStorage.setItem(WHEEL_KEY, JSON.stringify(prefs));
  } catch {
    // storage blocked: the choice holds until the page is closed
  }
  try {
    window.dispatchEvent(new CustomEvent(WHEEL_EVENT, { detail: prefs }));
  } catch {
    // no window (a server test): nothing to tell
  }
}

/** The index of the tab whose centre is nearest `mid` (the middle of the strip), or -1 when there is no tab. */
export function centredIndex(centres: readonly number[], mid: number): number {
  let best = -1;
  let gap = Infinity;
  centres.forEach((centre, i) => {
    const d = Math.abs(centre - mid);
    if (d < gap) {
      gap = d;
      best = i;
    }
  });
  return best;
}

/**
 * How a tab looks `distance` pixels from the middle (`spread`: about one tab's width). The middle one is whole; each tab's width away, it fades and shrinks a little
 * more, never below a quarter of its light. With the motion off the sizes stay and only the far ones dim, so the picker is still readable.
 */
export function wheelLook(distance: number, spread: number, motion: boolean): { opacity: number; scale: number } {
  const d = Math.min(Math.abs(distance) / Math.max(spread, 1), 2.5);
  if (!motion) return { opacity: d < 0.6 ? 1 : 0.6, scale: 1 };
  return { opacity: Math.max(0.28, 1 - 0.36 * d), scale: Math.max(0.78, 1 - 0.09 * d) };
}
