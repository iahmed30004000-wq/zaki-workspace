"use client";

import { useId } from "react";
import { CloudSun, Droplets, Lightbulb, Thermometer, ToggleRight, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SWITCH_STYLES, effectiveStyle, type SwitchStyle } from "@/lib/themes/switch-fx";
import { useSwitchFx } from "./switch-fx-provider";
import { LazyFxControl, PlainSwitch } from "./theme-switch";

/**
 * «مظهر المفتاح» in the person's own look settings (inside the theme picker): five cards, each a native radio (arrows move the
 * choice, Tab enters and leaves the group), the honest ⚠️ note with its 🔧 fix right under them, and a live try-out of the chosen look.
 * Drawn only while the company's `themeSwitchFx` switch is on (the picker is also used where there is no switch, and then nothing shows).
 * A choice applies at once and is saved to the account (switch-fx-provider.tsx).
 */

const ICONS: Record<SwitchStyle, LucideIcon> = {
  plain: ToggleRight,
  glass: Droplets,
  lamp: Lightbulb,
  sky: CloudSun,
  warmth: Thermometer,
};

export function SwitchStylePicker({ className }: { className?: string }) {
  const { t } = useI18n();
  const { pref, gate, commit } = useSwitchFx();
  const id = useId();
  if (!gate.fxOn) return null;
  const chosen = effectiveStyle(pref.style, gate);

  return (
    <fieldset className={className}>
      <legend className="text-sm font-semibold text-fg">{t("themeSwitch.picker")}</legend>
      <p className="mt-0.5 text-xs text-fg-muted">{t("themeSwitch.picker_hint")}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {SWITCH_STYLES.map((style) => {
          const selected = style === chosen;
          const Icon = ICONS[style];
          const hintId = `${id}-${style}-hint`;
          return (
            <label
              key={style}
              className={cn(
                "relative flex min-h-20 cursor-pointer flex-col gap-1 rounded-xl border bg-surface-1 p-2 text-start transition-colors",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent has-[:focus-visible]:ring-offset-1 has-[:focus-visible]:ring-offset-surface",
                selected ? "border-accent bg-accent/5" : "border-border hover:border-accent/50",
              )}
            >
              <input
                type="radio"
                name="zk-switch-style"
                className="sr-only"
                aria-label={t(`themeSwitch.style.${style}`)}
                aria-describedby={hintId}
                checked={selected}
                value={style}
                onChange={() => commit({ style })}
              />
              <span className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                <Icon aria-hidden="true" className="size-4 shrink-0 text-accent" />
                {t(`themeSwitch.style.${style}`)}
              </span>
              <span id={hintId} className="text-xs text-fg-muted">
                {t(`themeSwitch.style.${style}.hint`)}
              </span>
            </label>
          );
        })}
      </div>

      <p className="mt-3 rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-2 text-xs text-fg">{t("themeSwitch.warn")}</p>
      <p className="mt-1.5 text-xs text-fg-muted">{t("themeSwitch.motion_note")}</p>

      <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-border bg-surface-2 p-3">
        <p className="text-xs font-semibold text-fg-muted">{t("themeSwitch.try")}</p>
        {chosen === "plain" ? <PlainSwitch /> : <LazyFxControl style={chosen} size="preview" />}
      </div>
    </fieldset>
  );
}
