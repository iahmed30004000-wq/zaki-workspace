"use client";

import React from "react";
import "./emoji-alive.css";
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
  const animation = taps > 0 ? "zk-emoji-wiggle" : fresh ? "zk-emoji-pop" : undefined;
  return (
    <p data-jumbo-emoji data-count={count} data-pop={fresh ? "on" : "off"} className={cn("flex cursor-pointer select-none items-center gap-1 leading-none", TEXT_SIZE[count - 1])} onClick={() => setTaps((n) => n + 1)}>
      {tokens.map((token, i) =>
        token.zaki !== undefined ? (
          // eslint-disable-next-line @next/next/no-img-element -- a small local picture of the owner's pack
          <img
            key={`${taps}-${i}`}
            src={zakiSrc(token.zaki)}
            alt={zakiNameOf(token.zaki)}
            data-zaki-emoji={token.zaki}
            decoding="async"
            draggable={false}
            style={taps === 0 && fresh ? { animationDelay: `${i * 70}ms` } : undefined}
            className={cn("zk-jumbo-unit object-contain", PICTURE_SIZE[count - 1], animation)}
          />
        ) : (
          <span key={`${taps}-${i}`} style={taps === 0 && fresh ? { animationDelay: `${i * 70}ms` } : undefined} className={cn("zk-jumbo-unit", animation)}>
            {token.glyph}
          </span>
        ),
      )}
    </p>
  );
}
