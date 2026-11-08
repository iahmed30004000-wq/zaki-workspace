"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { DECOR_LEVELS, themeLabelKey, themeMoodKey, type ThemeKey } from "@/lib/themes/registry";
import { useTheme } from "./theme-provider";
import { useDigits } from "./digits-provider";
import { DIGIT_MODES, DIGIT_SAMPLES } from "@/lib/digits";
import { SwitchStylePicker } from "./switch-style-picker";

/**
 * The theme picker: four cards, each a native radio (so arrows move the choice, Tab enters and
 * leaves the group, and a screen reader says "1 of 4, selected"), and under it the decoration
 * level as three segmented radios. Every card shows a miniature of its theme painted with THAT
 * theme's own tokens: the preview carries `data-theme`, and themes.css defines every token for any
 * element with the attribute. A choice applies at once (see theme-provider.tsx).
 *
 * Used in the avatar menu (SHELL) and anywhere else a theme is chosen. `data-tour="theme"` is the
 * guide's stop for it.
 */
export function ThemePicker({ className }: { className?: string }) {
  const { t } = useI18n();
  const { theme, setTheme, decor, setDecor, themes } = useTheme();
  const { digits, setDigits } = useDigits();
  const id = useId();

  return (
    <div data-tour="theme" className={cn("space-y-5", className)}>
      <fieldset>
        <legend className="text-sm font-semibold text-fg">{t("theme.picker")}</legend>
        <p className="mt-0.5 text-xs text-fg-muted">{t("theme.picker_hint")}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {themes.map((info) => {
            const selected = info.key === theme;
            const moodId = `${id}-${info.key}-mood`;
            return (
              <label
                key={info.key}
                className={cn(
                  "relative flex min-h-24 cursor-pointer flex-col gap-2 rounded-xl border bg-surface-1 p-2 text-start transition-colors",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[:focus-visible]:ring-offset-1 has-[:focus-visible]:ring-offset-surface",
                  selected ? "border-accent bg-accent/5" : "border-border hover:border-accent/50",
                )}
              >
                <input
                  type="radio"
                  name="zk-theme"
                  className="sr-only"
                  aria-label={t(themeLabelKey(info.key))}
                  aria-describedby={moodId}
                  checked={selected}
                  value={info.key}
                  onChange={() => setTheme(info.key)}
                />
                <ThemePreview theme={info.key} />
                <span className="flex items-center justify-between gap-1">
                  <span className="text-sm font-semibold text-fg">{t(themeLabelKey(info.key))}</span>
                  <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-xs leading-none text-fg-muted">
                    {t(info.dark ? "theme.kind_dark" : "theme.kind_light")}
                  </span>
                </span>
                <span id={moodId} className="text-xs leading-snug text-fg-muted">
                  {t(themeMoodKey(info.key))}
                </span>
                {selected && (
                  <span aria-hidden="true" className="absolute end-3 top-3 grid size-5 place-items-center rounded-full bg-accent text-accent-fg shadow-card">
                    <Check className="size-3" strokeWidth={3} aria-hidden="true" />
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-semibold text-fg">{t("theme.decor")}</legend>
        <p className="mt-0.5 text-xs text-fg-muted">{t("theme.decor_hint")}</p>
        <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1">
          {DECOR_LEVELS.map((level) => {
            const selected = level === decor;
            return (
              <label
                key={level}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center justify-center rounded-lg px-2 text-center text-sm transition-colors",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                  selected ? "bg-surface font-semibold text-fg shadow-card" : "text-fg-muted hover:text-fg",
                )}
              >
                <input
                  type="radio"
                  name="zk-decor"
                  className="sr-only"
                  checked={selected}
                  value={level}
                  onChange={() => setDecor(level)}
                />
                {t(`theme.decor.${level}`)}
              </label>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs text-muted">{t("theme.decor_motion")}</p>
      </fieldset>

      {/* «الأرقام: 123 / ١٢٣» — how 0-9 are drawn (src/lib/digits.ts); fields, copies and searches stay 0-9 */}
      <fieldset>
        <legend className="text-sm font-semibold text-fg">{t("digits.picker")}</legend>
        <p className="mt-0.5 text-xs text-fg-muted">{t("digits.picker_hint")}</p>
        <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
          {DIGIT_MODES.map((mode) => {
            const selected = mode === digits;
            return (
              <label
                key={mode}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-2 text-center text-sm transition-colors",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                  selected ? "bg-surface font-semibold text-fg shadow-card" : "text-fg-muted hover:text-fg",
                )}
              >
                <input
                  type="radio"
                  name="zk-digits"
                  className="sr-only"
                  checked={selected}
                  value={mode}
                  aria-label={t(`digits.${mode}`)}
                  onChange={() => setDigits(mode)}
                />
                {/* the sample is spelled in its own code points, so it looks the same whatever is chosen */}
                <span aria-hidden="true" dir="ltr" className="zk-digits-sample">
                  {DIGIT_SAMPLES[mode]}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* «مظهر المفتاح» — the look of the top bar's light/dark switch (src/lib/themes/switch-fx.ts); drawn only while its feature switch is on */}
      <SwitchStylePicker />
    </div>
  );
}

/**
 * A miniature screen in the theme's own colours: a side bar, a title line, a card, the action
 * button, the status colours and the second accent. Decorative (the card's text names the theme).
 */
function ThemePreview({ theme }: { theme: ThemeKey }) {
  return (
    <span data-theme={theme} aria-hidden="true" className="flex h-16 overflow-hidden rounded-lg border border-border bg-surface">
      <span className="flex w-1/4 flex-col gap-1 border-e border-border bg-surface-1 p-1.5">
        <span className="h-1.5 rounded-full bg-accent" />
        <span className="h-1 rounded-full bg-fg-muted/40" />
        <span className="h-1 rounded-full bg-fg-muted/40" />
        <span className="h-1 rounded-full bg-fg-muted/40" />
      </span>
      <span className="flex flex-1 flex-col gap-1.5 p-1.5">
        <span className="h-1.5 w-2/3 rounded-full bg-fg" />
        <span className="flex h-4 items-center gap-1 rounded-md border border-border bg-surface-1 px-1 shadow-card">
          <span className="h-1 flex-1 rounded-full bg-fg-muted/50" />
          <span className="size-1.5 rounded-full bg-cat-1" />
          <span className="size-1.5 rounded-full bg-cat-4" />
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-6 rounded-full bg-accent" />
          <span className="size-1.5 rounded-full bg-ok" />
          <span className="size-1.5 rounded-full bg-warn" />
          <span className="size-1.5 rounded-full bg-danger" />
          <span className="ms-auto h-1.5 w-3 rounded-full bg-accent-2" />
        </span>
      </span>
    </span>
  );
}
