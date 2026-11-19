"use client";

import React from "react";
import { POP_MS, reactionSignature } from "@/lib/chat/v2/phone/motion";
import { cn } from "@/lib/utils";

/**
 * C2.8 — the reactions under a message POP (150 ms) when they change: somebody reacted, a count moved, or I toggled mine. Not when the bubble first
 * appears (opening a chat must not make every reaction jump), and not under reduced motion (`motion-reduce:animate-none`). It wraps the chips and changes
 * nothing about them: the chips' own file belongs to the bubble parts. Renders nothing at all while there are no reactions.
 */
export function ReactionPop({ reactions, children }: { reactions: readonly { emoji: string; count: number; mine: boolean }[]; children: React.ReactNode }) {
  const signature = reactionSignature(reactions);
  const seen = React.useRef(signature);
  const [popping, setPopping] = React.useState(false);
  React.useEffect(() => {
    if (seen.current === signature) return;
    seen.current = signature;
    setPopping(true);
    const stop = setTimeout(() => setPopping(false), POP_MS + 20);
    return () => clearTimeout(stop);
  }, [signature]);
  if (reactions.length === 0) return null;
  return (
    <div data-reaction-pop={popping ? "on" : "off"} className={cn(popping && "animate-pop motion-reduce:animate-none") || undefined}>
      {children}
    </div>
  );
}
