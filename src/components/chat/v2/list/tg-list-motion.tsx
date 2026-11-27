"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { TG_MOTION } from "@/lib/chat/v2/phone/motion";
import { scrollDirection } from "@/lib/chat/v2/list-scroll";

/**
 * «تيليجرام على التلفون»: the two movements of the chat list. Another folder slides in from its side and its pictures fade in after it; scrolling down puts
 * the search pill and the round button away, scrolling back up returns them. The stylesheet (`app/tg-phone.css`) draws both; this only says when.
 */

/** Which way the folders turned last, for as long as the slide and the fade take; null the rest of the time (so a row scrolled into view never replays). */
export function useFolderTurn(at: number, on: boolean): "next" | "prev" | null {
  const before = useRef(at);
  const [way, setWay] = useState<"next" | "prev" | null>(null);
  useEffect(() => {
    const from = before.current;
    before.current = at;
    if (!on || from === at || from < 0 || at < 0) return;
    setWay(at > from ? "next" : "prev");
    const timer = setTimeout(() => setWay(null), TG_MOTION.folderSwitchMs + TG_MOTION.folderAvatarsMs);
    return () => clearTimeout(timer);
  }, [at, on]);
  return way;
}

/** The box that slides. With the switch off it is no box at all. */
export function FolderTurn({ on, folder, way, children }: { on: boolean; folder: string; way: "next" | "prev" | null; children: React.ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-x-clip">
      <div key={folder} className="flex min-h-0 flex-1 flex-col" {...(way ? { "data-tg-folder-way": way } : {})}>
        {children}
      </div>
    </div>
  );
}

/** Is the list scrolled down and still going that way? Another folder starts at its top. */
export function useListScroll(on: boolean, folder: string): { down: boolean; onScroll: (event: React.UIEvent) => void } {
  const [down, setDown] = useState(false);
  const last = useRef(0);
  useEffect(() => {
    last.current = 0;
    setDown(false);
  }, [folder]);
  const onScroll = useCallback(
    (event: React.UIEvent) => {
      const target = event.target as HTMLElement;
      if (!on || !target.hasAttribute?.("data-chat-rows")) return;
      const next = scrollDirection(last.current, target.scrollTop);
      if (next === null) return;
      last.current = target.scrollTop;
      setDown(next);
    },
    [on],
  );
  return { down: on && down, onScroll };
}
