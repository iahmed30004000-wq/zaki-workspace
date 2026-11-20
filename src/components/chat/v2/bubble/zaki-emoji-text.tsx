"use client";

import React from "react";
import { isStickerOnly, splitZakiEmoji, zakiNameOf, zakiSrc } from "@/lib/chat/zaki-emoji";

/**
 * The Zaki emoji pack inside a message: a known code (`:zaki_smile:`) is drawn as its small picture in the line (24 px), a message that is ONLY one to three
 * of them as a big sticker (96 px). Anything else is handed back untouched to `render` (the mention highlight and the order chips of the bubble), so no
 * word of a message ever changes. The picture has a name for a screen reader and is never the only copy of the words: the text code is what is saved.
 */
export function ZakiEmojiText({ text, render, sticker = false }: { text: string; render: (plain: string) => React.ReactNode; sticker?: boolean }) {
  const pieces = splitZakiEmoji(text);
  if (!pieces.some((p) => p.emoji !== undefined)) return <>{render(text)}</>;
  return (
    <>
      {pieces.map((p, i) =>
        p.emoji !== undefined ? (
          <img
            key={i}
            src={zakiSrc(p.emoji)}
            alt={zakiNameOf(p.emoji)}
            data-zaki-emoji={p.emoji}
            loading="lazy"
            decoding="async"
            draggable={false}
            className={sticker ? "inline-block size-24 align-middle" : "inline-block size-6 align-text-bottom"}
          />
        ) : (
          <React.Fragment key={i}>{render(p.text)}</React.Fragment>
        ),
      )}
    </>
  );
}

export { isStickerOnly };
