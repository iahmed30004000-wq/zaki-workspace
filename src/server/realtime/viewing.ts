import { isOnline } from "./presence";
import { streamsViewingOf } from "./hub";

/** A tab that reported «visible» (or whose heartbeat found it so) counts for this long. */
export const VIEWING_WINDOW_MS = 60_000;

/**
 * Is the person LOOKING at the app right now? Used ONLY to hold a push back (F0.5): `isOnline` still draws the green dot.
 * Online by presence, and — when the person has streams — at least one whose tab is visible and fresh. An open stream used to
 * mean «online», so a person whose only tab sat hidden swallowed every notification.
 */
export async function isViewing(userId: string, now: number = Date.now()): Promise<boolean> {
  if (!(await isOnline(userId))) return false;
  const streams = streamsViewingOf(userId);
  if (streams.length === 0) return true; // online by presence alone (another process holds the stream): as before
  return streams.some((s) => s.viewing && now - s.viewingAt <= VIEWING_WINDOW_MS);
}
