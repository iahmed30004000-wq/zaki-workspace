/**
 * M1a — notifications grouped BY CONVERSATION. One notification per conversation (its `tag` IS the conversation's id) that is replaced, with a new alert,
 * by every message that follows (`renotify`), and goes away when the person opens that conversation. The service worker (`public/sw.js`) holds a copy of
 * `conversationOfUrl` (it is plain JavaScript and cannot import this file); tests/pwa-sw.test.ts runs both over the same addresses so they cannot drift.
 */

/**
 * The conversation a push's page is: `/chat/<id>` or `/chat/<id>?m=<message>`, also when the server wrapped it in `/go?space=…&next=/chat/<id>…` (a notification
 * of a space opens through `/go`). Null for any other page (a task, a ring) and for the forum view `/chat/s/<space>`, which is not a conversation.
 */
export function conversationOfUrl(url: string | null | undefined, origin = "https://zaki.invalid"): string | null {
  if (!url) return null;
  let target: URL;
  try {
    target = new URL(url, origin);
  } catch {
    return null;
  }
  if (target.pathname === "/go") {
    const next = target.searchParams.get("next");
    if (!next) return null;
    try {
      target = new URL(next, origin);
    } catch {
      return null;
    }
  }
  const parts = target.pathname.split("/").filter(Boolean);
  if (parts[0] !== "chat" || parts.length < 2 || parts[1] === "s") return null;
  try {
    return decodeURIComponent(parts[1]!) || null;
  } catch {
    return null;
  }
}

/** Takes the notification of a conversation off the screen (the person is looking at it now). Never throws. */
export async function closeChatNotifications(conversationId: string): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return;
    for (const shown of await reg.getNotifications({ tag: conversationId })) shown.close();
  } catch {
    // a notification that stays until the person swipes it away is the worst that happens
  }
}
