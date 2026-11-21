import { offlineHtml } from "@/lib/pwa/offline-page";

/** M1a — `GET /offline`: the page the service worker shows when there is no network (the document is built in `src/lib/pwa/offline-page.ts`). */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(offlineHtml(), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // the worker keeps its own copy per build; the browser asks again every time
      "cache-control": "no-cache",
    },
  });
}
