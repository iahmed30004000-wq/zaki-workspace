"use client";

import React from "react";
import { createPortal } from "react-dom";
import "@/components/chat/v2/phone/tg-messages.css";
import { ct } from "@/lib/chat/text";
import { effectPieces, effectWordKeys } from "@/lib/chat/v2/phone/emoji-effect";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";

/**
 * «تيليجرام على التلفون» — a big emoji played over the whole screen: copies of it fly up and spin, and a laughing face brings the laugh in words. Mounted
 * only for the 3.3 seconds of a play (a new play is a new mount); it takes no touch, and a screen reader hears nothing of it.
 */
export function EmojiEffectPieces({ glyph, picture }: { glyph: string; /** a sticker of our pack: its picture flies instead of a glyph */ picture?: string }) {
  const words = picture ? [] : effectWordKeys(glyph);
  const [pieces] = React.useState(() => effectPieces({ totalMs: TG_MOTION.emojiEffectMs, words: words.length }));
  return (
    <div aria-hidden="true" data-emoji-effect="" dir="ltr" className="pointer-events-none fixed inset-0 z-[75] overflow-hidden">
      {pieces.map((p, i) => (
        <span
          key={i}
          style={
            {
              insetInlineStart: `${p.x}%`,
              top: `${p.y}%`,
              "--tg-dx": `${p.driftX}vw`,
              "--tg-dy": `${p.driftY}vh`,
              "--tg-scale": String(p.scale),
              "--tg-spin": `${p.spinDeg}deg`,
              "--tg-delay": `${p.delayMs}ms`,
              "--tg-duration": `${p.durationMs}ms`,
            } as React.CSSProperties
          }
          className="zk-tg-effect-piece absolute text-5xl leading-none opacity-0"
        >
          {p.word !== null ? (
            <span dir="rtl" className="text-3xl font-black text-accent">
              {ct(words[p.word]!)}
            </span>
          ) : picture ? (
            // eslint-disable-next-line @next/next/no-img-element -- a small local picture of the owner's pack
            <img src={picture} alt="" draggable={false} className="size-14 object-contain" />
          ) : (
            glyph
          )}
        </span>
      ))}
    </div>
  );
}

export function EmojiEffect({ glyph, picture }: { glyph: string; picture?: string }) {
  if (typeof document === "undefined") return null;
  return createPortal(<EmojiEffectPieces glyph={glyph} {...(picture ? { picture } : {})} />, document.body);
}
