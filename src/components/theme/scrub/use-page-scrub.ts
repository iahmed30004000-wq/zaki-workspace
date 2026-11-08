"use client";

import { useEffect, useMemo, useRef } from "react";
import { planScrub, scrubAllowed } from "@/lib/themes/scrub";
import { useSwitchFx } from "../switch-fx-provider";
import { useThemeToggle } from "../use-theme-toggle";
import type { PageScrub } from "./page-scrub";

/**
 * The bridge between a knob and the page: a knob calls `move(t)` every frame while it is dragged or gliding (t = 0 the light theme,
 * 1 the person's dark one) and `settle(toDark)` when it has come to rest on an end; the page follows live in between.
 *
 * The engine (page-scrub.ts) is its own lazy chunk, fetched by `warm()` (the pointer arriving, the focus) or by the first `move`, and
 * only when the gate allows it (the feature on, no «وضع التوفير», no reduced-motion request: scrub.ts `scrubAllowed`). When it does
 * not — or has not arrived yet — the knob still moves and `settle` is one plain, instant swap through the normal mechanism
 * (useThemeToggle.setDark: data-theme, cookie, account). The theme is only ever COMMITTED at rest: a drag that is cancelled
 * (Escape, the window losing focus, the control leaving the page) puts the committed theme back and stores nothing.
 */
export interface PageScrubHandle {
  /** Fetch the engine's code ahead of the press. */
  warm: () => void;
  /** Is the page allowed to follow the knob right now? */
  allowed: () => boolean;
  /** The knob is at darkness `t` (0 light .. 1 dark): paint the page. */
  move: (t: number) => void;
  /** The knob came to rest on an end: commit that theme and drop the overrides. */
  settle: (toDark: boolean) => void;
  /** Drop everything and show the committed theme. */
  cancel: () => void;
  /** Is a scrub in progress (engine running)? */
  active: () => boolean;
}

let engine: Promise<typeof import("./page-scrub")> | null = null;
function loadEngine(): Promise<typeof import("./page-scrub")> {
  engine ??= import("./page-scrub");
  return engine;
}

export function usePageScrub(): PageScrubHandle {
  const { theme, dark, setDark } = useThemeToggle();
  const { pref, gate } = useSwitchFx();
  const latest = useRef({ theme, dark, setDark, darkTheme: pref.dark, allowed: scrubAllowed(gate) });
  latest.current = { theme, dark, setDark, darkTheme: pref.dark, allowed: scrubAllowed(gate) };

  const run = useRef<{ scrub: PageScrub | null; want: number | null; epoch: number; loading: boolean }>({ scrub: null, want: null, epoch: 0, loading: false });

  const handle = useMemo<PageScrubHandle>(() => {
    const s = run.current;
    const cancel = (): void => {
      s.epoch += 1;
      s.want = null;
      s.loading = false;
      s.scrub?.cancel();
      s.scrub = null;
    };
    return {
      warm: () => {
        if (latest.current.allowed) void loadEngine().catch(() => undefined);
      },
      allowed: () => latest.current.allowed,
      active: () => s.scrub !== null,
      move: (t) => {
        if (!latest.current.allowed || typeof document === "undefined") return;
        s.want = t;
        if (s.scrub) {
          s.scrub.move(t);
          return;
        }
        if (s.loading) return;
        s.loading = true;
        const epoch = s.epoch;
        loadEngine()
          .then((m) => {
            s.loading = false;
            if (epoch !== s.epoch || s.scrub || s.want === null) return;
            const l = latest.current;
            const plan = planScrub(l.dark ? l.theme : l.darkTheme);
            s.scrub = m.beginPageScrub(plan, document.documentElement, l.dark ? 1 : 0);
            s.scrub.move(s.want);
          })
          .catch(() => {
            s.loading = false;
          });
      },
      settle: (toDark) => {
        const apply = (): void => latest.current.setDark(toDark, undefined, true);
        const scrub = s.scrub;
        s.epoch += 1;
        s.want = null;
        s.loading = false;
        s.scrub = null;
        if (scrub) scrub.commit(toDark ? 1 : 0, apply);
        else apply();
      },
      cancel,
    };
  }, []);

  // the control leaves the page mid-drag: show the committed theme again
  useEffect(() => () => handle.cancel(), [handle]);
  return handle;
}
