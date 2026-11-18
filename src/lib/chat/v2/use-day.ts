"use client";

import { useEffect, useState } from "react";
import { dayKeyOf, msUntilNextDay } from "@/lib/chat/row-preview";

/** The local date as a key that changes at midnight (and so re-draws the rows' time labels): see `dayKeyOf`. */
export function useDayKey(): string {
  const [key, setKey] = useState(() => dayKeyOf());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(() => {
        setKey(dayKeyOf());
        arm();
      }, msUntilNextDay());
    };
    arm();
    return () => clearTimeout(timer);
  }, []);
  return key;
}
