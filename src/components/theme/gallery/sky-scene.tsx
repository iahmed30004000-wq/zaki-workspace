"use client";

import "../fx/exact.css";
import "./sky.css";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useI18n } from "@/lib/i18n";
import { mixRgb, rgbOf, skyClock, skyMinute, skyMoment } from "@/lib/themes/switch-motion";
import { flipCurve } from "@/lib/themes/scrub";
import { prefersReducedMotion, useFxReader, useKnob } from "../fx/kit";
import { SkyArt, type SkyArtHandle } from "../fx/sky-art";
import type { SceneHandle } from "./scene-types";

/**
 * «05 · drag the sky»: a horizontal pill with a landscape that scrubs through the hours 00:00 .. 12:00 as the pointer drags across
 * it (no snapping: it stays where it was dropped), with the caption of the moment (midnight, moonset, golden hour, morning, high
 * noon) and the page behind it changing colour with the time. The pointer is a small ring while it drags.
 */
export const SkyScene = forwardRef<SceneHandle>(function SkyScene(_props, handle) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLDivElement>(null);
  const art = useRef<SkyArtHandle>(null);
  const title = useRef<HTMLParagraphElement>(null);
  const sub = useRef<HTMLParagraphElement>(null);
  const ring = useRef<HTMLSpanElement>(null);
  const reader = useFxReader(root);
  const lastKey = useRef("");

  const paint = (p: number) => {
    const minute = skyMinute(p);
    const r = root.current;
    const read = reader();
    if (!r || !art.current || !read) return;
    const res = art.current.paint(minute);
    r.style.background = rgbOf(res.page);
    const ink = mixRgb(read("tp-ink-d"), read("tp-ink-l"), 1 - flipCurve(1 - res.day)); // the caption flips across the middle (readable on the brown page)
    r.style.setProperty("--ink", `${ink[0]} ${ink[1]} ${ink[2]}`);
    const key = `${skyMoment(minute)}|${skyClock(minute)}`;
    if (key !== lastKey.current) {
      lastKey.current = key;
      if (title.current) title.current.textContent = t(`gallery.sky.${skyMoment(minute)}`);
      if (sub.current) sub.current.textContent = `${skyClock(minute)} · ${t("gallery.sky.drag")}`;
    }
  };

  const knob = useKnob(pill, {
    initial: 1,
    snap: false,
    instant: typeof window !== "undefined" && prefersReducedMotion(),
    tau: 90,
    onFrame: (p) => paint(p),
    onPointer: ({ x, y, dragging }) => {
      const stage = root.current?.querySelector<HTMLElement>(".fx-sc-stage");
      const dot = ring.current;
      if (!stage || !dot) return;
      const rect = stage.getBoundingClientRect();
      const s = rect.width / 1720 || 1;
      dot.style.transform = `translate(${(x - rect.left) / s - 22}px, ${(y - rect.top) / s - 22}px)`;
      dot.style.opacity = dragging ? "1" : "0";
    },
  });

  useEffect(() => {
    knob.set(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useImperativeHandle(handle, () => ({ toggle: knob.toggle }), [knob.toggle]);

  return (
    <div ref={root} className="fx-sc fx-sk" dir="ltr" data-scene="sky" onPointerMove={knob.bind.onPointerMove} onPointerUp={knob.bind.onPointerUp}>
      <div className="fx-sc-stage">
        <div ref={pill} className="fx-sk-pill" {...knob.bind}>
          <SkyArt ref={art} className="fx-sk-art" />
          <span className="fx-sk-shine" aria-hidden="true" />
        </div>
        <p ref={title} className="fx-sk-title" dir="rtl" />
        <p ref={sub} className="fx-sk-sub" dir="rtl" />
        <span ref={ring} className="fx-sk-ring" aria-hidden="true" />
      </div>
    </div>
  );
});
