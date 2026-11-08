"use client";

import { forwardRef, useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";
import { BEVEL_REACH, DISPERSION, MAG_REACH, makeGlassMaps } from "./glass-maps";

/**
 * The glass knob. Where the browser can bend what is behind an element (Chromium: an SVG filter inside `backdrop-filter`) it is real
 * refraction — 0.72x magnification, a 22% circular bevel and a red/blue split of ±22% at the edge — otherwise a flat frosted square
 * (the rest of the look: tint, Fresnel rim, caustic glow, stays the same). The knob's size is given in px; its position and glow are
 * driven from outside through the CSS variables `--kx` (left), `--lx`/`--ly` (where the light is, 0..100%).
 */

const CHANNELS = [
  { name: "r", k: 1 + DISPERSION, matrix: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" },
  { name: "g", k: 1, matrix: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" },
  { name: "b", k: 1 - DISPERSION, matrix: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" },
] as const;

export function isChromium(): boolean {
  if (typeof navigator === "undefined") return false;
  const brands = (navigator as Navigator & { userAgentData?: { brands?: Array<{ brand: string }> } }).userAgentData?.brands;
  return Boolean(brands?.some((b) => /chromium/i.test(b.brand)));
}

export const GlassKnob = forwardRef<HTMLSpanElement, { size: number; refract: boolean; className?: string; style?: CSSProperties; children?: ReactNode }>(function GlassKnob(
  { size, refract, className, style, children },
  ref,
) {
  const id = `zkgl${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [maps, setMaps] = useState<{ mag: string; bevel: string } | null>(null);
  useEffect(() => {
    if (refract) setMaps(makeGlassMaps());
  }, [refract]);
  const live = refract && maps !== null;
  // primitiveUnits="objectBoundingBox": the maps cover the knob exactly and a scale is a share of its size (so any size works)
  const magScale = Math.round(2 * MAG_REACH * 1000) / 1000;
  const bevScale = Math.round(2 * BEVEL_REACH * 1000) / 1000;
  const filter = live ? `url(#${id}) saturate(1.35) brightness(1.04)` : undefined;
  return (
    <>
      <span
        ref={ref}
        data-refract={live}
        className={`fx-glass ${className ?? ""}`}
        style={{ ...style, width: size, height: size, backdropFilter: filter ?? "blur(7px) saturate(1.3)", WebkitBackdropFilter: filter ?? "blur(7px) saturate(1.3)" }}
      >
        <span className="fx-glass-tint" aria-hidden="true" />
        <span className="fx-glass-caustic" aria-hidden="true" />
        <span className="fx-glass-rim" aria-hidden="true" />
        {children}
      </span>
      {live && maps ? (
        <svg width="0" height="0" aria-hidden="true" focusable="false" className="fx-defs">
          <filter id={id} x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
            <feImage href={maps.mag} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="mm" />
            <feDisplacementMap in="SourceGraphic" in2="mm" scale={magScale} xChannelSelector="R" yChannelSelector="G" result="mag" />
            <feImage href={maps.bevel} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="mb" />
            {CHANNELS.map((c) => (
              <feDisplacementMap key={c.name} in="mag" in2="mb" scale={Math.round(bevScale * c.k * 1000) / 1000} xChannelSelector="R" yChannelSelector="G" result={`d${c.name}`} />
            ))}
            {CHANNELS.map((c) => (
              <feColorMatrix key={c.name} in={`d${c.name}`} type="matrix" values={c.matrix} result={c.name} />
            ))}
            <feBlend in="r" in2="g" mode="screen" result="rg" />
            <feBlend in="rg" in2="b" mode="screen" />
          </filter>
        </svg>
      ) : null}
    </>
  );
});
