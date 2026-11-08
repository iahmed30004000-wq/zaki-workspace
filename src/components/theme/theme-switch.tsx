"use client";

import type { KeyboardEvent, MouseEvent } from "react";
import dynamic from "next/dynamic";
import { Moon, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { arrowToDark, effectiveStyle, type SwitchStyle } from "@/lib/themes/switch-fx";
import { useSwitchFx } from "./switch-fx-provider";
import { prefetchReveal, useThemeToggle } from "./use-theme-toggle";

/**
 * «ليل / نهار» in the top bar: ONE compact switch (role="switch", checked = dark) that toggles between «نهار» and the
 * person's own dark theme. Space and Enter are the button's own click; the arrows toward the end of the line turn it on,
 * the other turns it off (RTL-correct: the end is the left), Home / End are the two ends. The target is 44 px.
 *
 * The person may have chosen another look in «مظهر المفتاح» (زجاج، لمبة، سما، حرارة اللون): that code is a separate chunk,
 * fetched only by somebody who chose it (`ssr: false`), and the plain switch is what shows until it arrives and whenever the
 * feature switch is off. The four themes and the decoration level stay in the avatar menu (theme-picker.tsx).
 */

/** The effect looks: one lazy chunk (its stylesheet comes with it). */
export const LazyFxControl = dynamic(() => import("./switch-fx/fx-control").then((m) => m.FxControl), {
  ssr: false,
  loading: () => <PlainSwitch />,
});

export function PlainSwitch({ className }: { className?: string }) {
  const { t } = useI18n();
  const { dark, setDark } = useThemeToggle();
  const { gate } = useSwitchFx();

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    // a press from the keyboard has no pointer position: grow from the knob instead
    const origin = e.detail > 0 ? { x: e.clientX, y: e.clientY } : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    setDark(!dark, origin);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const dir = getComputedStyle(e.currentTarget).direction === "rtl" ? "rtl" : "ltr";
    const toDark = arrowToDark(e.key, dir);
    if (toDark === null) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setDark(toDark, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={t("themeSwitch.aria")}
      title={t(dark ? "themeSwitch.toggle_to_day" : "themeSwitch.toggle_to_dark")}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onPointerEnter={gate.fxOn ? prefetchReveal : undefined}
      onFocus={gate.fxOn ? prefetchReveal : undefined}
      className={cn(
        "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        className,
      )}
    >
      <span aria-hidden="true" className={cn("flex h-7 w-12 items-center rounded-full border p-0.5 transition-colors", dark ? "border-accent/50 bg-surface-2" : "border-border bg-surface-2")}>
        <span
          className={cn(
            "grid size-6 place-items-center rounded-full bg-accent text-accent-fg shadow-card transition-transform duration-200",
            dark ? "translate-x-[18px] rtl:-translate-x-[18px]" : "",
          )}
        >
          {dark ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
        </span>
      </span>
    </button>
  );
}

/** The top bar's switch: the plain one, or the look the person chose while the feature is on. */
export function ThemeSwitch() {
  const { pref, gate } = useSwitchFx();
  const style: SwitchStyle = effectiveStyle(pref.style, gate);
  if (style === "plain") return <PlainSwitch />;
  return <LazyFxControl style={style} size="bar" />;
}
