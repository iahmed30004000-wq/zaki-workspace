"use client";

import { useEffect } from "react";
import { setTypeSoundsOn } from "@/lib/sound-library/device";

/** The company's switch `chatTypeSounds`, handed to the page by the app's layout: the code that plays an arrival is no component and takes no prop. Draws nothing. */
export function TypeSoundsFlag({ on }: { on: boolean }): null {
  useEffect(() => {
    setTypeSoundsOn(on);
    return () => setTypeSoundsOn(false);
  }, [on]);
  return null;
}
