import { deleteDeviceCaches } from "@/lib/chat/cache/device-store";
import { broadcastWipe, runWipeHooks } from "@/lib/chat/cache/registry";

/**
 * C1.5 — THE WIPE. One function, called:
 *   - at sign-out, from BOTH client logout paths (`avatar-menu.tsx`, `onboarding-form.tsx`);
 *   - when the stream says `signed_out` (the page goes to the sign-in page, where the driver finds nobody signed in and calls it);
 *   - when a DIFFERENT person signs in on this device (`runtime.ts`);
 *   - when the account is an external partner's (never kept at all, and anything an older version kept is removed);
 *   - from «امسح ذاكرة المحادثات» in the settings (C4.1).
 *
 * ⚠️ Message text is kept on the device so the chat opens at once. 🔧 This is the fix: it stops everything that could write (the
 * persister, the sync engine), drops every chat query from memory, then deletes EVERY `zaki-chat-*` database of the browser
 * (every person's, not only the current one) and the marker that says whose they were.
 *
 * It never throws and never waits for long: a browser that refuses IndexedDB has nothing to delete, and a database another tab holds
 * open is emptied at once and removed as soon as that tab lets go. A logout must not hang on it.
 */
export async function wipeChatCache(opts: { broadcast?: boolean } = {}): Promise<void> {
  // the other tabs of this browser are told FIRST, so none of them writes while the databases are being deleted
  // (not by a page that only found nobody signed in: every tab finds that for itself, and telling each other would never end)
  if (opts.broadcast !== false) broadcastWipe();
  try {
    await runWipeHooks();
  } catch {
    /* the databases are deleted regardless */
  }
  try {
    await deleteDeviceCaches();
  } catch {
    /* nothing more can be done: the databases carry the person's id, so another person never reads them */
  }
}
