"use client";

import "./switch-fx.css";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { Moon, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { arrowToDark } from "@/lib/themes/switch-fx";
import { useKnob, type KnobMode } from "../fx/kit";
import { useLook } from "../scrub/use-look";
import { useSwitchFx } from "../switch-fx-provider";
import { useThemeToggle } from "../use-theme-toggle";

/**
 * The default look of the top bar's switch, with a knob you can DRAG (the reference recording's behaviour): the same pill and the same
 * knob as the plain switch (theme-switch.tsx), but pulled along under the pointer, and the page changes while it moves. It is a
 * separate lazy chunk — the plain switch itself stays in the shell and is what shows until this one has arrived.
 *
 *   drag      the knob follows the pointer; the whole app is mixed between «نهار» and the person's dark theme by its position; on
 *             release it glides to the nearer end and only then is the theme committed.
 *   tap       a press without travel is the plain switch's own click: the torn-ink «repainting NN%» reveal from the pointer.
 *   keys      Enter / Space press it (the reveal from the knob); the arrow toward the end of the line turns the light off, the other
 *             on, Home / End are the two ends — those glide and scrub like a drag.
 *   Escape    (or the window losing focus) in the middle of a drag puts the committed theme back.
 *
 * In the app's own right-to-left direction «نهار» is on the right (the start) and the dark end on the left, like the plain switch.
 */

const vars = (o: Record<string, string | number>): CSSProperties => o as CSSProperties;

export function PlainScrub() {
  const { t } = useI18n();
  const { dark, setDark } = useThemeToggle();
  const { motion } = useSwitchFx();
  const { scrub, mid, follow } = useLook("plain");
  const root = useRef<HTMLSpanElement>(null);
  const rail = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [mirror, setMirror] = useState(false);
  const scrubbing = useRef(false);
  const latest = useRef({ dark, setDark, mirror });
  latest.current = { dark, setDark, mirror };

  useEffect(() => {
    if (button.current) setMirror(getComputedStyle(button.current).direction === "ltr");
  }, []);

  const paint = (p: number, _dt: number, mode: KnobMode) => {
    const r = root.current;
    if (!r) return;
    r.style.setProperty("--q", p.toFixed(4));
    r.style.setProperty("--p", (latest.current.mirror ? 1 - p : p).toFixed(4));
    if (mode === "drag" && knob.travelled()) scrubbing.current = true;
    if (scrubbing.current) follow(p, mode);
  };
  const knob = useKnob(rail, {
    initial: dark ? 0 : 1,
    snap: true,
    instant: !motion,
    mid,
    mirror,
    grab: "travel",
    onFrame: paint,
    tap: (at) => latest.current.setDark(!latest.current.dark, at),
    onCancel: () => {
      scrubbing.current = false;
      scrub.cancel();
      knob.set(latest.current.dark ? 0 : 1);
    },
    onSettled: (_p, end) => {
      if (end === null || !scrubbing.current) return;
      scrubbing.current = false;
      scrub.settle(end === 0);
    },
  });
  useEffect(() => {
    // the theme changed (a tap's reveal, the picker, another tab): the knob glides to where that theme rests
    const end = dark ? 0 : 1;
    if (!knob.moving() && Math.abs(knob.get() - end) > 0.001) knob.goTo(end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dark]);

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    // a pointer press was already handled on release (a tap or a drag); this is Enter / Space
    if (e.detail !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    latest.current.setDark(!latest.current.dark, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const dir = getComputedStyle(e.currentTarget).direction === "rtl" ? "rtl" : "ltr";
    const toDark = arrowToDark(e.key, dir);
    if (toDark === null) return;
    e.preventDefault();
    scrubbing.current = true;
    knob.goTo(toDark ? 0 : 1);
  };

  return (
    <button
      ref={button}
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={t("themeSwitch.aria")}
      title={t(dark ? "themeSwitch.toggle_to_day" : "themeSwitch.toggle_to_dark")}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onPointerEnter={scrub.warm}
      onFocus={scrub.warm}
      onPointerDown={knob.bind.onPointerDown}
      onPointerMove={knob.bind.onPointerMove}
      onPointerUp={knob.bind.onPointerUp}
      onPointerCancel={knob.bind.onPointerCancel}
      className={cn("inline-flex min-h-11 min-w-11 shrink-0 touch-none select-none items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent")}
    >
      <span ref={root} aria-hidden="true" dir="ltr" className="zx zx-plain" data-style="plain" data-motion={motion} style={vars({ "--p": dark !== mirror ? 0 : 1, "--q": dark ? 0 : 1 })}>
        <span ref={rail} className="zx-pill">
          <span className="zx-plain-knob">
            <Sun className="zx-plain-sun size-3.5" />
            <Moon className="zx-plain-moon size-3.5" />
          </span>
        </span>
      </span>
    </button>
  );
}
