"use client";

import { useEffect } from "react";

/**
 * Inside the installed app (the Android app is the site in a full-screen window, display-mode standalone / fullscreen) the page keeps its
 * size: a pinch or a focus on a field must not leave the page zoomed in with its edges cut off, as it did on a phone. In a normal browser
 * tab nothing changes, so zooming a page there stays available. The lock is `maximum-scale=1` added to the viewport the server wrote
 * (src/app/layout.tsx); the phone's own font size still applies to the text.
 */
export function AppScaleLock() {
  useEffect(() => {
    try {
      const installed = ["standalone", "fullscreen", "minimal-ui"].some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
      if (!installed) return;
      const meta = document.querySelector('meta[name="viewport"]');
      const content = meta?.getAttribute("content");
      if (!meta || !content || /maximum-scale/.test(content)) return;
      meta.setAttribute("content", `${content}, maximum-scale=1`);
    } catch {
      /* a browser without matchMedia or a locked-down page: keep the viewport as written */
    }
  }, []);
  return null;
}
