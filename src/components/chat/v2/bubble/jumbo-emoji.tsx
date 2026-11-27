"use client";

import React from "react";
import "./emoji-alive.css";
import "@/components/chat/v2/phone/tg-messages.css";
import { EmojiEffect } from "@/components/chat/v2/bubble/emoji-effect";
import { useTgPhone } from "@/components/shell/tg-phone";
import { TG_MOTION, tgMotionVars } from "@/lib/chat/v2/phone/motion";
import { effectOn } from "@/lib/motion/effects";
import { zakiNameOf, zakiSrc, type EmojiToken } from "@/lib/chat/zaki-emoji";
import { cn } from "@/lib/utils";

/**
 * S5.6 — a message of ONE to THREE emojis (unicode, Zaki pictures or both) drawn BIG, the way Telegram draws it: the fewer there are, the bigger each one is.
 *  - it POPS (a short scale-up) only when the message has just arrived: `fresh` is decided once by the bubble when it mounts (`isFreshArrival`), so a re-render, opening a
 *    chat or scrolling up never plays it again;
 *  - a TAP replays a short wiggle (the tap is decoration only: nothing is sent, nothing opens; a link, a button or a reaction is never inside it, so the bubble's double tap
 *    and long press keep working);
 *  - the keyframes are plain CSS in `emoji-alive.css` and are off under `prefers-reduced-motion`; the emojis stay fully visible without them.
 * The words of the message are not changed: the unicode emojis are drawn as they are and a Zaki one is its picture with its Arabic name.
 */
const TEXT_SIZE = ["text-6xl", "text-5xl", "text-4xl"] as const;
const PICTURE_SIZE = ["size-24", "size-20", "size-16"] as const;

export function JumboEmoji({ tokens, fresh }: { tokens: readonly EmojiToken[]; fresh: boolean }) {
  // 0: never tapped; every tap raises it, and the units below are keyed by it, so each tap restarts the wiggle
  const [taps, setTaps] = React.useState(0);
  const count = Math.min(Math.max(tokens.length, 1), 3);
  // «تيليجرام على التلفون»: ONE emoji is bigger, breathes while it sits there, shows its grey shadow for a moment when just sent, and a tap plays it over the screen
  const phone = useTgPhone();
  const alive = phone && tokens.length === 1;
  const [playing, setPlaying] = React.useState(0);
  React.useEffect(() => {
    if (playing === 0) return;
    const stop = setTimeout(() => setPlaying(0), TG_MOTION.emojiEffectMs);
    return () => clearTimeout(stop);
  }, [playing]);
  // the pop of before is the computer's and of two or three: the single one on the phone wakes from its shadow instead
  const animation = taps > 0 ? "zk-emoji-wiggle" : alive ? undefined : fresh ? "zk-emoji-pop" : undefined;
  const tap = (event: React.MouseEvent) => {
    setTaps((n) => n + 1);
    if (!alive || !effectOn("emoji") || !effectOn("particles")) return;
    // this tap plays the emoji: it does not also open the message's menu (the time under it, and a long press, are the message's)
    event.stopPropagation();
    setPlaying((n) => n + 1);
  };
  const units = tokens.map((token, i) =>
        token.zaki !== undefined ? (
          // eslint-disable-next-line @next/next/no-img-element -- a small local picture of the owner's pack
          <img
            key={`${taps}-${i}`}
            src={zakiSrc(token.zaki)}
            alt={zakiNameOf(token.zaki)}
            data-zaki-emoji={token.zaki}
            decoding="async"
            draggable={false}
            style={taps === 0 && fresh && !alive ? { animationDelay: `${i * 70}ms` } : undefined}
            className={cn("zk-jumbo-unit object-contain", alive ? "size-32" : PICTURE_SIZE[count - 1], animation)}
          />
        ) : (
          <span key={`${taps}-${i}`} style={taps === 0 && fresh && !alive ? { animationDelay: `${i * 70}ms` } : undefined} className={cn("zk-jumbo-unit", animation)}>
            {token.glyph}
          </span>
        ),
      );
  const first = tokens[0];
  return (
    <p
      data-jumbo-emoji
      data-count={count}
      data-pop={fresh ? "on" : "off"}
      {...(alive ? { style: tgMotionVars(["sendEmojiMs", "emojiIdleMs"]) as React.CSSProperties, "data-tg-alive": "" } : {})}
      className={cn("flex cursor-pointer select-none items-center gap-1 leading-none", alive ? "text-8xl" : TEXT_SIZE[count - 1], alive && fresh && "zk-tg-wake")}
      onClick={tap}
    >
      {alive ? (
        <span className="relative inline-flex">
          {fresh && first ? (
            <span aria-hidden="true" className="zk-tg-ghost pointer-events-none absolute inset-0 flex items-center justify-center grayscale">
              {first.zaki !== undefined ? (
                // eslint-disable-next-line @next/next/no-img-element -- a small local picture of the owner's pack
                <img src={zakiSrc(first.zaki)} alt="" draggable={false} className="size-32 object-contain" />
              ) : (
                first.glyph
              )}
            </span>
          ) : null}
          <span className="zk-tg-alive inline-flex">{units}</span>
        </span>
      ) : (
        units
      )}
      {playing > 0 && first ? <EmojiEffect key={playing} glyph={first.glyph ?? ""} {...(first.zaki !== undefined ? { picture: zakiSrc(first.zaki) } : {})} /> : null}
    </p>
  );
}
