"use client";

import "../fx/gallery.css";
import { useCallback, useEffect, useRef, useState, type ComponentType, type Ref } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { GALLERY_VARIANTS, STAGE_H, STAGE_W, type SceneHandle, type VariantKey } from "./scene-types";

/**
 * «معرض مفاتيح المظهر»: the six numbered switch variants of the reference recording, full screen, one at a time.
 * A control pill at the top (arrows between variants, «بدّل», Space toggles, H hides the pill, Esc leaves) over a scene drawn on
 * a 1720 x 1080 stage scaled to the window. Each scene is its own lazy chunk — nothing of the effects code is in a shared chunk —
 * and the page itself exists only behind the `themeSwitchFx` switch (see the route). The numbers inside the scenes are fake.
 */

type SceneProps = { economy?: boolean };
type SceneComponent = ComponentType<SceneProps & { ref?: Ref<SceneHandle> }>;

const load = (pick: () => Promise<unknown>): SceneComponent => dynamic(pick as () => Promise<SceneComponent>, { ssr: false }) as SceneComponent;
const SCENES: Record<VariantKey, SceneComponent> = {
  temp: load(() => import("./temp-scene").then((m) => m.TempScene)),
  lamp: load(() => import("./lamp-scene").then((m) => m.LampScene)),
  repaint: load(() => import("./lumen-scenes").then((m) => m.RepaintScene)),
  ink: load(() => import("./lumen-scenes").then((m) => m.InkScene)),
  sky: load(() => import("./sky-scene").then((m) => m.SkyScene)),
  glass: load(() => import("./glass-scene").then((m) => m.GlassScene)),
};

/** The key caps of the pill, as printed on a keyboard (the hints beside them are Arabic). */
const KEYCAP = { hide: "H", esc: "Esc" } as const;

const START = GALLERY_VARIANTS.findIndex((v) => v.key === "glass");

export function ThemeGallery({ economy = false }: { economy?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [index, setIndex] = useState(START);
  const [hidden, setHidden] = useState(false);
  const frame = useRef<HTMLDivElement>(null);
  const handle = useRef<SceneHandle>(null);
  const variant = GALLERY_VARIANTS[index] ?? GALLERY_VARIANTS[START] ?? GALLERY_VARIANTS[0];
  const Scene = SCENES[variant.key];
  const count = GALLERY_VARIANTS.length;

  const go = useCallback((delta: number) => setIndex((i) => (i + delta + count) % count), [count]);
  const toggle = useCallback(() => handle.current?.toggle(), []);

  // the stage is drawn at the recording's size and scaled to fit the window
  useEffect(() => {
    const fit = () => frame.current?.style.setProperty("--sc", String(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const onControl = target?.closest("button, a, input, textarea, select, [role=switch]");
      if (e.key === "Escape") {
        e.preventDefault();
        router.push("/");
      } else if (e.key === " " && !onControl) {
        e.preventDefault();
        toggle();
      } else if ((e.key === "h" || e.key === "H") && !onControl) {
        e.preventDefault();
        setHidden((v) => !v);
      } else if (e.key === "ArrowRight" && !onControl) go(1);
      else if (e.key === "ArrowLeft" && !onControl) go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, toggle, go]);

  return (
    <div ref={frame} className="fx-gallery" data-variant={variant.key} role="region" aria-label={t("gallery.title")}>
      <Scene key={variant.key} ref={handle} economy={economy} />
      {hidden ? (
        <button type="button" className="fx-pill-show" onClick={() => setHidden(false)} aria-label={t("gallery.show")} />
      ) : (
        <div className="fx-pill" dir="rtl">
          <button type="button" className="nav" onClick={() => go(-1)} aria-label={t("gallery.prev")}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          <span className="name" aria-live="polite">
            {variant.n} · {t(`gallery.v.${variant.key}`)}
          </span>
          <button type="button" className="nav" onClick={() => go(1)} aria-label={t("gallery.next")}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button type="button" className="chip" onClick={toggle}>
            {t("gallery.toggle")}
          </button>
          <span className="keys">
            <kbd>{t("gallery.key.space")}</kbd> {t("gallery.hint.toggle")} · <kbd>{KEYCAP.hide}</kbd> {t("gallery.hint.hide")} · <kbd>{KEYCAP.esc}</kbd> {t("gallery.hint.exit")}
          </span>
        </div>
      )}
    </div>
  );
}
