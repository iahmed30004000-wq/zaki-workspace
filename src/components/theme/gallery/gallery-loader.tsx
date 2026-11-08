"use client";

import dynamic from "next/dynamic";

/** The gallery is one lazy chunk (client only): the page itself ships a few bytes, the effects ship when it is opened. */
const ThemeGallery = dynamic(() => import("./theme-gallery").then((m) => m.ThemeGallery), { ssr: false });

export function ThemeGalleryLoader({ economy }: { economy: boolean }) {
  return <ThemeGallery economy={economy} />;
}
