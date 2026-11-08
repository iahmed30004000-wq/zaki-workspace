"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { prefCookieString } from "@/lib/themes/registry";
import {
  DEFAULT_SWITCH_PREF,
  SWITCH_COOKIE,
  clampBrightness,
  clampWarmth,
  darkThemeOf,
  isSwitchStyle,
  parseSwitchPref,
  serializeSwitchPref,
  tintStyle,
  type FxGate,
  type SwitchPref,
  motionAllowed,
} from "@/lib/themes/switch-fx";

/**
 * «مظهر المفتاح» on the client: the person's choice (style, brightness, warmth, the dark theme to come back to), the gate that
 * decides whether any effect may run (the feature switch, «وضع التوفير», prefers-reduced-motion), and the tint laid over the app.
 *
 * The SERVER already painted the right first frame: the overlay below is rendered with the cookie's values, so a warm tint is
 * there before any script runs. After that the tint is owned by the DOM: a drag writes three CSS variables straight onto the
 * overlay (`preview`, no React render at all), and a release (`commit`) writes the final ones, the cookie, and — a moment later,
 * once per burst — the account (`POST /api/me/switch`, best-effort like the theme's: the cookie already holds the choice).
 */

export interface SwitchFxContextValue {
  pref: SwitchPref;
  gate: FxGate;
  /** Is decorative motion allowed right now (feature on, not economy, no reduced-motion request)? */
  motion: boolean;
  /** Apply, remember and save (a release, a key press, a click). */
  commit: (change: Partial<SwitchPref>) => void;
  /** Only show it (a drag in progress): the tint changes, nothing is stored. */
  preview: (change: Partial<SwitchPref>) => void;
}

// ── saving ──────────────────────────────────────────────────────────────────

const SAVE_DELAY_MS = 400;
let pending: Partial<SwitchPref> = {};
let timer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> = Promise.resolve();

function send(body: Partial<SwitchPref>): void {
  saving = saving.then(async () => {
    try {
      await fetch("/api/me/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
    } catch {
      // best-effort: the cookie already holds the choice on this device
    }
  });
}

function flush(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  const body = pending;
  pending = {};
  if (Object.keys(body).length > 0) send(body);
}

function queueSave(change: Partial<SwitchPref>): void {
  pending = { ...pending, ...change };
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, SAVE_DELAY_MS);
}

/** Resolves when every choice made so far has been sent (tests, and anything that must wait for it). */
export function savedSwitchPreferences(): Promise<void> {
  flush();
  return saving;
}

function remember(pref: SwitchPref): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:";
  document.cookie = prefCookieString(SWITCH_COOKIE, serializeSwitchPref(pref), secure);
}

/** Merge a change into a choice, every value kept inside its range. */
export function mergeSwitchPref(base: SwitchPref, change: Partial<SwitchPref>): SwitchPref {
  return {
    style: change.style !== undefined && isSwitchStyle(change.style) ? change.style : base.style,
    brightness: change.brightness !== undefined ? clampBrightness(change.brightness) : base.brightness,
    warmth: change.warmth !== undefined ? clampWarmth(change.warmth) : base.warmth,
    dark: change.dark !== undefined ? darkThemeOf(change.dark) : base.dark,
  };
}

/** Write the overlay's three variables (or take them away when there is nothing to draw). */
export function applyTint(el: HTMLElement | null, pref: SwitchPref): void {
  if (!el) return;
  const vars = tintStyle(pref);
  for (const name of ["--zk-dim", "--zk-warm", "--zk-cool"] as const) {
    if (vars) el.style.setProperty(name, vars[name]);
    else el.style.removeProperty(name);
  }
}

// ── the gate ────────────────────────────────────────────────────────────────

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

// ── the context ─────────────────────────────────────────────────────────────

/** Outside a provider (an isolated render, the door) the switch is the plain one and a choice is only remembered and saved. */
const SwitchFxContext = createContext<SwitchFxContextValue>({
  pref: DEFAULT_SWITCH_PREF,
  gate: { fxOn: false, economy: false, reducedMotion: false },
  motion: false,
  commit: (change) => {
    const next = mergeSwitchPref(DEFAULT_SWITCH_PREF, change);
    remember(next);
    queueSave(change);
  },
  preview: () => {},
});

export function SwitchFxProvider({
  initial,
  enabled,
  economy = false,
  children,
}: {
  /** The `zk-switch` cookie the server read: anything unknown is the default. */
  initial?: string;
  /** The company's `themeSwitchFx` switch. */
  enabled: boolean;
  /** The company's «وضع التوفير». */
  economy?: boolean;
  children: ReactNode;
}) {
  const [pref, setPref] = useState<SwitchPref>(() => parseSwitchPref(initial));
  const prefRef = useRef(pref);
  const tintRef = useRef<HTMLDivElement>(null);
  // the overlay's first frame comes from the server's values; afterwards the DOM owns it (see the note above)
  const [firstTint] = useState<CSSProperties | undefined>(() => tintStyle(parseSwitchPref(initial)) as CSSProperties | undefined);
  const reducedMotion = useReducedMotion();
  const gate = useMemo<FxGate>(() => ({ fxOn: enabled, economy, reducedMotion }), [enabled, economy, reducedMotion]);

  const commit = useCallback((change: Partial<SwitchPref>) => {
    const next = mergeSwitchPref(prefRef.current, change);
    prefRef.current = next;
    setPref(next);
    applyTint(tintRef.current, next);
    remember(next);
    queueSave(change);
  }, []);

  const preview = useCallback((change: Partial<SwitchPref>) => {
    applyTint(tintRef.current, mergeSwitchPref(prefRef.current, change));
  }, []);

  // a choice still waiting for its save goes out when the page is hidden or the shell goes away
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      flush();
    };
  }, []);

  const value = useMemo<SwitchFxContextValue>(() => ({ pref, gate, motion: motionAllowed(gate), commit, preview }), [pref, gate, commit, preview]);
  return (
    <SwitchFxContext.Provider value={value}>
      {children}
      {enabled ? <div ref={tintRef} data-zk-tint="" aria-hidden="true" style={firstTint} /> : null}
    </SwitchFxContext.Provider>
  );
}

/** The person's switch choice, the gate on effects, and how to change the choice. */
export function useSwitchFx(): SwitchFxContextValue {
  return useContext(SwitchFxContext);
}
