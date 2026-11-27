import type { MetadataRoute } from "next";
import { PALETTES } from "@/lib/themes/palettes";
import { DEFAULT_THEME } from "@/lib/themes/registry";
import { NEW_MESSAGE_HREF } from "@/lib/nav/new-actions";

/**
 * The web app manifest: what the browser reads to install Zaki Workspace like an app. Next serves it at
 * /manifest.webmanifest and links it from every page, no extra wiring.
 *
 * - The splash screen and the title bar take the default theme's surface colour, so an installed app opens
 *   in the same paper colour as the page (the icons are drawn on it too: scripts/make-icons.mjs).
 * - Icons are PNGs under /icons/ (committed; `node scripts/make-icons.mjs` redraws them). The maskable one
 *   is a separate file made for the mask, never one file with two purposes.
 * - `scope: "/"` and `start_url: "/"`: the whole site opens inside the app window. Pages behind the
 *   sign-in redirect to /login as usual (the middleware lets /manifest.webmanifest and /icons/* through).
 * - M1a: `shortcuts` (long-press the icon: «رسالة جديدة» opens the chat with the new-chat dialog ready, «مهامي» opens the person's tasks) and `share_target`
 *   (the phone's share sheet lists the app; a GET to `/share` with `title`, `text`, `url`, which asks WHICH conversation and never sends by itself; files LATER).
 * - The service worker (public/sw.js, M1a) caches the app's shell and shows an offline page; it never caches `/api/`.
 *
 * ⚠️ `start_url` is still `/` (where the site opens today). The owner's decision D-N1 («الموقع والتطبيق بيفتحوا على الدردشة») is unanswered, and
 * tests/pwa-manifest.test.ts pins it. 🔧 When he answers yes: `start_url: "/chat?src=app"` here and the same line in that test, nothing else.
 */
export default function manifest(): MetadataRoute.Manifest {
  const surface = PALETTES[DEFAULT_THEME].colors.surface;
  return {
    id: "/",
    name: "Zaki Workspace",
    short_name: "ذكي",
    description: "نظام عمل الفريق: المساحات والمشاريع والمهام والدردشة والملفات في مكان واحد.",
    lang: "ar",
    dir: "rtl",
    start_url: "/",
    scope: "/",
    display: "standalone",
    // no `orientation`: a workspace is used on any device, in any direction — locking it would turn
    // a tablet sideways into letterboxing
    background_color: surface,
    theme_color: surface,
    categories: ["business", "productivity"],
    shortcuts: [
      { name: "رسالة جديدة", short_name: "رسالة جديدة", url: NEW_MESSAGE_HREF, icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "مهامي", short_name: "مهامي", url: "/my-work", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
    // Next's type for this member is not the spec's shape (`params` is an object there: title, text, url); the browser reads the spec's
    share_target: { action: "/share", method: "GET", enctype: "application/x-www-form-urlencoded", params: { title: "title", text: "text", url: "url" } } as unknown as NonNullable<MetadataRoute.Manifest["share_target"]>,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
