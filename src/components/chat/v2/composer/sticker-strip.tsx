"use client";

import React from "react";
import "@/components/chat/v2/phone/tg-messages.css";
import { ct } from "@/lib/chat/text";
import { tgMotionVars } from "@/lib/chat/v2/phone/motion";
import { zakiNameOf, zakiSrc } from "@/lib/chat/zaki-emoji";

/** «تيليجرام على التلفون»: over the box while it holds one emoji, our stickers that mean the same; a tap sends the sticker in its place. */
export function StickerStrip({ ids, onPick }: { ids: readonly string[]; onPick: (id: string) => void }) {
  if (ids.length === 0) return null;
  return (
    <div data-sticker-strip="" role="group" aria-label={ct("tgmsg.suggest.label")} style={tgMotionVars(["barSlideMs"]) as React.CSSProperties} className="zk-tg-slide-up strip-scroll mx-auto mb-2 flex w-full max-w-[904px] gap-1 overflow-x-auto rounded-2xl bg-surface-1 p-1.5 shadow-card">
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          data-sticker-suggestion={id}
          aria-label={ct("tgmsg.suggest.send", { name: zakiNameOf(id) })}
          // the box keeps its focus (and the phone its keyboard) while a sticker is pressed
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => onPick(id)}
          className="flex size-16 shrink-0 items-center justify-center rounded-xl active:bg-surface-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a small local picture of the owner's pack */}
          <img src={zakiSrc(id)} alt="" draggable={false} className="size-14 object-contain" />
        </button>
      ))}
    </div>
  );
}
