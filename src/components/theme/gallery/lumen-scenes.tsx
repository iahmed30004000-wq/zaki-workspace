"use client";

import "../fx/exact.css";
import "./lumen.css";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Bookmark, Moon, Search, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { dayBars } from "@/lib/themes/switch-motion";
import { prefersReducedMotion, paintPairs, useFxReader } from "../fx/kit";
import type { SceneHandle } from "./scene-types";

/**
 * «03 · Lumen» and «04 · Tonight's reading»: a dashboard and an article list that repaint when their toggle is pressed.
 * The page changes through the same torn-ink reveal as the product's switch (switch-fx/reveal.ts): shards and a trail of sparks
 * running ahead of the edge with a «repainting NN%» pill for the dashboard, an ink blot for the reading list.
 * The numbers and names are FAKE (they only exist inside the gallery).
 */

const PAIRS = ["lm-bg", "lm-panel", "lm-ink", "lm-mute", "lm-accent", "lm-accent2", "lm-field", "lm-spark"] as const;
const BARS = dayBars(24).slice(3, 20);

interface SceneProps {
  economy?: boolean;
}

function useRepaint(look: "shards" | "ink", economy: boolean) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const reader = useFxReader(root);
  const [dark, setDark] = useState(false);
  const busy = useRef(false);

  const paint = (m: number) => {
    const read = reader();
    if (root.current && read) {
      paintPairs(root.current, read, PAIRS, m);
      root.current.dataset.dark = m > 0.5 ? "true" : "false";
    }
  };
  useEffect(() => {
    paint(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flip = (x?: number, y?: number) => {
    if (busy.current) return;
    busy.current = true;
    const toDark = !dark;
    const r = toggle.current?.getBoundingClientRect();
    const origin = { x: x ?? (r ? r.left + r.width / 2 : window.innerWidth - 100), y: y ?? (r ? r.top + r.height / 2 : 80) };
    const apply = () => {
      paint(toDark ? 1 : 0);
      setDark(toDark);
    };
    import("../switch-fx/reveal")
      .then((m) =>
        m.changeThemeWithReveal(apply, {
          origin,
          gate: { fxOn: true, economy, reducedMotion: prefersReducedMotion() },
          look,
          toDark,
          seed: (Date.now() & 0xffff) + 3,
          label: look === "shards" ? (n) => t("gallery.lumen.repainting", { n }) : undefined,
        }),
      )
      .catch(apply)
      .finally(() => {
        busy.current = false;
      });
  };
  return { root, toggle, dark, flip };
}

function Toggle({ dark, toggleRef, onFlip, label }: { dark: boolean; toggleRef: React.RefObject<HTMLButtonElement>; onFlip: (x: number, y: number) => void; label: string }) {
  return (
    <button ref={toggleRef} type="button" role="switch" aria-checked={dark} aria-label={label} className="fx-lm-toggle" onClick={(e) => onFlip(e.clientX || 0, e.clientY || 0)}>
      <span className="knob">{dark ? <Moon size={26} /> : <Sun size={26} />}</span>
    </button>
  );
}

export const RepaintScene = forwardRef<SceneHandle, SceneProps>(function RepaintScene({ economy = false }, handle) {
  const { t } = useI18n();
  const { root, toggle, dark, flip } = useRepaint("shards", economy);
  useImperativeHandle(handle, () => ({ toggle: () => flip() }), [flip]);
  const rows = [
    { c: "red", n: t("gallery.lumen.a1"), s: t("gallery.lumen.a1_text"), a: t("gallery.lumen.t1") },
    { c: "blue", n: t("gallery.lumen.a2"), s: t("gallery.lumen.a2_text"), a: t("gallery.lumen.t2") },
    { c: "green", n: t("gallery.lumen.a3"), s: t("gallery.lumen.a3_text"), a: t("gallery.lumen.t3") },
  ];
  return (
    <div ref={root} className="fx-sc fx-lm" dir="ltr" data-scene="repaint">
      <div className="fx-sc-stage">
        <i className="dotlogo" aria-hidden="true" />
        <span className="brand">{t("gallery.lumen.name")}</span>
        <div className="search">
          <Search size={26} aria-hidden="true" />
          <span>{t("gallery.lumen.search")}</span>
        </div>
        <Toggle dark={dark} toggleRef={toggle} onFlip={(x, y) => flip(x, y)} label={t("themeSwitch.aria")} />
        <div className="rail" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <b key={i} className={i === 0 ? "on" : ""} />
          ))}
        </div>
        <div className="card day">
          <p className="h">{t("gallery.lumen.daylight")}</p>
          <p className="s">{t("gallery.lumen.daylight_sub")}</p>
          <p className="up">+12%</p>
          <div className="bars">
            {BARS.map((b, i) => (
              <i key={i} style={{ height: `${Math.min(100, 28 + b * 74)}%` }} />
            ))}
          </div>
        </div>
        <div className="card sun">
          <p className="s">{t("gallery.lumen.sunrise")}</p>
          <p className="big">06:12</p>
          <svg className="arc" viewBox="0 0 60 36" aria-hidden="true">
            <path d="M4 32 A26 26 0 0 1 56 32" fill="none" strokeWidth="3.4" strokeLinecap="round" />
          </svg>
        </div>
        <div className="card lux">
          <p className="s">{t("gallery.lumen.lux")}</p>
          <p className="big">84k</p>
          <svg className="ring" viewBox="0 0 60 60" aria-hidden="true">
            <circle cx="30" cy="30" r="22" fill="none" strokeWidth="6" className="track" />
            <circle cx="30" cy="30" r="22" fill="none" strokeWidth="6" strokeLinecap="round" strokeDasharray="100 38" transform="rotate(-70 30 30)" />
          </svg>
        </div>
        <div className="card feed">
          {rows.map((r, i) => (
            <div key={r.c} className="row" style={{ top: 26 + i * 96 }}>
              <b className={r.c} />
              <strong>{r.n}</strong>
              <span>{r.s}</span>
              <em>{r.a}</em>
              {i < 2 ? <hr /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export const InkScene = forwardRef<SceneHandle, SceneProps>(function InkScene({ economy = false }, handle) {
  const { t } = useI18n();
  const { root, toggle, dark, flip } = useRepaint("ink", economy);
  useImperativeHandle(handle, () => ({ toggle: () => flip() }), [flip]);
  const items = [
    { k: 1, a: t("gallery.reading.r1"), b: t("gallery.reading.r1_sub"), on: false },
    { k: 2, a: t("gallery.reading.r2"), b: t("gallery.reading.r2_sub"), on: true },
    { k: 3, a: t("gallery.reading.r3"), b: t("gallery.reading.r3_sub"), on: false },
    { k: 4, a: t("gallery.reading.r4"), b: t("gallery.reading.r4_sub"), on: false },
  ];
  return (
    <div ref={root} className="fx-sc fx-lm fx-rd" dir="ltr" data-scene="ink">
      <div className="fx-sc-stage">
        <h2 className="title" dir="rtl">
          {t("gallery.reading.title")}
        </h2>
        <p className="sub" dir="rtl">
          {t("gallery.reading.sub")}
        </p>
        <Toggle dark={dark} toggleRef={toggle} onFlip={(x, y) => flip(x, y)} label={t("themeSwitch.aria")} />
        {items.map((it, i) => (
          <div key={it.k} className="item" style={{ top: 228 + i * 168 }}>
            <b className={`ic i${it.k}`}>
              <i />
              <i />
              <i />
              <i />
            </b>
            <strong>{it.a}</strong>
            <span>{it.b}</span>
            <Bookmark size={30} className={it.on ? "mark on" : "mark"} aria-label={t("gallery.reading.bookmark")} />
          </div>
        ))}
      </div>
    </div>
  );
});
