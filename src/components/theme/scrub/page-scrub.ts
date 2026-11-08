/**
 * The page-scrub engine: while a knob is dragged (or gliding to an end) the REAL app's colours follow it. It writes the mixed palette
 * (src/lib/themes/scrub.ts) as inline custom properties on <html> — they win over the `[data-theme]` rule, so every screen, card,
 * chart and sidebar repaints from the same tokens it always uses — and it takes them away again when the knob has settled and the
 * theme has been committed through the normal mechanism (data-theme, cookie, account).
 *
 * Loaded lazily (a dynamic import from use-page-scrub.ts), so it is never in a shared chunk and costs nothing until a knob is dragged.
 *
 * Performance: the plan (every token parsed to OKLab) is built once per drag; `move` writes AT MOST ONE pass per animation frame
 * (a second call in the same frame is kept for the next one), skips a pass whose numbers did not change, and `html[data-theme-scrub]`
 * turns CSS transitions off (globals.css) so nothing lags behind the knob.
 */
import { scrubSideAt, scrubValues, sameWrites, type ScrubPlan, type ScrubWrite } from "@/lib/themes/scrub";

/** The part of <html> the engine touches: small enough for a test to fake. */
export interface ScrubRoot {
  style: {
    setProperty(name: string, value: string): void;
    removeProperty(name: string): string | void;
    getPropertyValue(name: string): string;
  };
  classList: { toggle(token: string, force?: boolean): boolean; contains(token: string): boolean };
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export interface PageScrub {
  /** The position the page was last painted at (0 light .. 1 dark). */
  t(): number;
  /** Follow the knob (0 = the light theme, 1 = the dark one). At most one write pass per animation frame. */
  move(t: number): void;
  /** The knob settled on an end: paint it exactly, run `apply` (which commits the theme through the normal mechanism) and drop the overrides, in one task. */
  commit(end: 0 | 1, apply: () => void): void;
  /** Drop the overrides and show the committed theme again (Escape, blur, unmount). */
  cancel(): void;
  active(): boolean;
}

export const SCRUB_ATTRIBUTE = "data-theme-scrub";

type Schedule = (fn: () => void) => number;
type Unschedule = (handle: number) => void;

export function beginPageScrub(
  plan: ScrubPlan,
  root: ScrubRoot,
  start: number,
  schedule: Schedule = (fn) => requestAnimationFrame(fn),
  unschedule: Unschedule = (h) => cancelAnimationFrame(h),
): PageScrub {
  const names = [...plan.colors.map((c) => `--${c.name}`), ...plan.style.map((s) => `--${s.name}`), "color-scheme"];
  const before = new Map<string, string>();
  for (const n of names) before.set(n, root.style.getPropertyValue(n));
  const hadDark = root.classList.contains("dark");
  root.setAttribute(SCRUB_ATTRIBUTE, "");

  let current = start;
  let last: ScrubWrite[] | null = null;
  let lastDark: boolean | null = null;
  let wroteThisFrame = false;
  let waiting: number | null = null;
  let handle = 0;
  let over = false;

  const write = (t: number): void => {
    current = t;
    const values = scrubValues(plan, t);
    if (!sameWrites(last, values)) {
      for (const [name, value] of values) root.style.setProperty(name, value);
      last = values;
    }
    const side = scrubSideAt(plan, t);
    if (side.dark !== lastDark) {
      lastDark = side.dark;
      root.classList.toggle("dark", side.dark);
      root.style.setProperty("color-scheme", side.dark ? "dark" : "light");
    }
  };

  const frame = (): void => {
    handle = 0;
    wroteThisFrame = false;
    if (over || waiting === null) return;
    const t = waiting;
    waiting = null;
    write(t);
    wroteThisFrame = true;
    handle = schedule(frame);
  };

  const stopFrames = (): void => {
    if (handle) unschedule(handle);
    handle = 0;
    waiting = null;
    wroteThisFrame = false;
  };

  const clear = (restoreClass: boolean): void => {
    over = true;
    stopFrames();
    for (const [name, value] of before) {
      if (value === "") root.style.removeProperty(name);
      else root.style.setProperty(name, value);
    }
    if (restoreClass) root.classList.toggle("dark", hadDark);
    root.removeAttribute(SCRUB_ATTRIBUTE);
  };

  return {
    t: () => current,
    active: () => !over,
    move(t) {
      if (over) return;
      const k = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
      if (!wroteThisFrame) {
        write(k);
        wroteThisFrame = true;
        if (!handle) handle = schedule(frame);
      } else waiting = k;
    },
    commit(end, apply) {
      if (over) {
        apply();
        return;
      }
      stopFrames();
      write(end);
      apply();
      clear(false);
    },
    cancel() {
      if (over) return;
      clear(true);
    },
  };
}
