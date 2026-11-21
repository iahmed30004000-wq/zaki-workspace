"use client";

import { buildIdFrom, shellFilesFrom } from "@/lib/pwa/build-id";

/**
 * M1a — the service worker (`public/sw.js`) is registered for everybody who is signed in, not only from the call and bell buttons: the offline page, the
 * cached shell and the grouped notifications all need it. Idempotent (one registration per page life) and quiet (a browser without service workers, a
 * private window or a refusal change nothing: the site works exactly as without it).
 *
 * The URL is `/sw.js` with NO query, like `ensurePush` (src/components/calls/push-client.ts) registers it: two callers with two addresses would replace each
 * other's worker on every visit. The build id travels in a message instead (`zaki-shell`), once the worker is active.
 */
let started = false;

/** Test hook: forget that this page already registered. */
export function resetRegistrationForTests(): void {
  started = false;
}

export function serviceWorkersSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator;
}

/** The addresses of everything this page has loaded so far (scripts, styles, fonts, images). */
function loadedUrls(): string[] {
  const urls = new Set<string>();
  for (const node of Array.from(document.querySelectorAll("script[src], link[href]"))) {
    const value = node.getAttribute("src") ?? node.getAttribute("href");
    if (value) urls.add(value);
  }
  for (const entry of performance.getEntriesByType("resource")) urls.add(entry.name);
  return [...urls];
}

/** Waits until the page has finished loading and a moment more, so the shell's files do not compete with the page's own first paint. */
function afterLoad(): Promise<void> {
  return new Promise((resolve) => {
    const settle = () => window.setTimeout(resolve, 1500);
    if (document.readyState === "complete") settle();
    else window.addEventListener("load", settle, { once: true });
  });
}

/** Registers the worker and hands it the build's shell once. Never throws. */
export async function registerServiceWorker(): Promise<void> {
  if (started || !serviceWorkersSupported()) return;
  started = true;
  try {
    await navigator.serviceWorker.register("/sw.js");
    const reg = await navigator.serviceWorker.ready;
    await afterLoad();
    const urls = loadedUrls();
    const build = buildIdFrom(urls);
    // development has no build fingerprint: nothing to version, nothing to cache
    if (!build) return;
    reg.active?.postMessage({ type: "zaki-shell", build, files: shellFilesFrom(urls, window.location.origin) });
  } catch {
    // no service worker here (a private window, a policy), or a blip of the network: the site works as it always did, and the next caller may try again
    started = false;
  }
}
