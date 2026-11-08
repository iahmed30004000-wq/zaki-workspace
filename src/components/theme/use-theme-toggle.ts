"use client";

import { useCallback } from "react";
import { useI18n } from "@/lib/i18n";
import { isDarkTheme, type ThemeKey } from "@/lib/themes/registry";
import { motionAllowed } from "@/lib/themes/switch-fx";
import { useTheme } from "./theme-provider";
import { useSwitchFx } from "./switch-fx-provider";

/** Fetch the reveal code ahead of the press (hover, focus): it is only ever downloaded by somebody who uses the switch. */
export function prefetchReveal(): void {
  void import("./switch-fx/reveal").catch(() => undefined);
}

/**
 * «نهار» <-> the person's own dark theme, shared by every look of the switch.
 *
 * Going dark means the dark theme the person last used (`pref.dark`: «ليل» until they pick another); leaving a dark theme for «نهار»
 * remembers which one it was, so the way back is the same. The change itself is the torn-ink «repainting NN%» reveal from `origin`
 * when effects are allowed, and an instant swap otherwise (feature off, «وضع التوفير», reduced motion, no View Transitions).
 */
export function useThemeToggle(): {
  theme: ThemeKey;
  dark: boolean;
  /** Turn the light off (dark) or on («نهار»). `instant` skips the reveal (a drag scrubbing through the threshold). */
  setDark: (toDark: boolean, origin?: { x: number; y: number }, instant?: boolean) => void;
} {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const { pref, gate, commit } = useSwitchFx();
  const dark = isDarkTheme(theme);

  const setDark = useCallback(
    (toDark: boolean, origin?: { x: number; y: number }, instant = false) => {
      if (toDark === dark) return;
      const next: ThemeKey = toDark ? pref.dark : "day";
      if (!toDark && theme !== pref.dark) commit({ dark: theme });
      if (instant || !motionAllowed(gate)) {
        setTheme(next);
        return;
      }
      const from = origin ?? { x: window.innerWidth / 2, y: 0 };
      import("./switch-fx/reveal")
        .then((m) => m.changeThemeWithReveal(() => setTheme(next), { origin: from, gate, seed: Date.now() & 0xffff, look: "shards", toDark, particles: 60, label: (n) => t("themeSwitch.repainting", { n }) }))
        .catch(() => setTheme(next));
    },
    [dark, theme, pref.dark, gate, commit, setTheme, t],
  );

  return { theme, dark, setDark };
}
