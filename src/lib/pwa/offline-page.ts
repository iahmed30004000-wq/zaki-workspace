import { AR } from "@/lib/i18n/dict";

/**
 * M1a — «ما في نت»: the page the service worker (public/sw.js) shows when a navigation finds no network (served by `src/app/offline/route.ts`). It is stored in
 * the worker's shell cache once, and so it is ONE self-contained HTML document: its own small style (the browser's own colours: `Canvas` and `CanvasText`
 * follow the device's light or dark mode), no script file, no image, no font and nothing of the person (it is the same for everybody and is served from the
 * cache, signed in or not).
 *
 * The page itself says the words the owner asked for: the messages written offline are sent when the network is back (the chat's outbox keeps them). It tries
 * again by itself when the browser says it is online: it reloads the page that was asked for (the worker serves this document at that address), so a deep
 * link from a notification is not lost. The button goes to the home page.
 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function offlineHtml(): string {
  const message = escapeHtml(AR["mobile.offline.message"] ?? "");
  const open = escapeHtml(AR["mobile.offline.open"] ?? "");
  const title = escapeHtml(AR["mobile.offline.page_title"] ?? "");
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
:root { color-scheme: light dark; }
html, body { height: 100%; margin: 0; }
body { display: grid; place-items: center; padding: 24px; box-sizing: border-box; background: Canvas; color: CanvasText; font-family: system-ui, sans-serif; text-align: center; }
main { max-width: 22rem; }
p { margin: 0 0 24px; font-size: 1.125rem; line-height: 1.8; }
a { display: inline-block; min-width: 8rem; padding: 12px 24px; border-radius: 12px; border: 1px solid currentColor; color: inherit; font-weight: 600; text-decoration: none; }
</style>
</head>
<body>
<main>
<p>${message}</p>
<a href="/">${open}</a>
</main>
<script>window.addEventListener("online", function () { location.reload(); });</script>
</body>
</html>
`;
}
