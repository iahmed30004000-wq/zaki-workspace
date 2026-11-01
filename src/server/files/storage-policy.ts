import { DriveStoreError } from "@/server/files/drive-store";
import { getGoogleStatus } from "@/server/services/google";

/**
 * WHERE A NEW FILE IS WRITTEN (the owner's decision, 2026-11-01: «التخزين أولويته على جوجل درايف، بدناش المساحة تمتلي تبع
 * السيرفر»). Google Drive FIRST, whenever it is connected and healthy; the server's disk is only the fallback, and a file
 * is written to one of them, never both. This is for every new upload that is a file of the company: the library, chat
 * attachments and voice notes (an approval's files are chat uploads). A profile picture stays on the server: it is
 * tiny, served on every screen, and a Drive round trip per face would slow every page for nothing.
 *
 * ⚠️ The server's disk is a fallback, not a second copy: while Drive is not connected, new files fill the server.
 * 🔧 The library says so on screen, with the fix (connect Drive on «الأتمتة»), and the owner's storage panel counts it.
 */

/** Why a new file went to the server instead of Drive (null while it goes to Drive). */
export type ServerReason = "not_configured" | "not_connected" | "needs_reconnect" | "feature_off" | "unavailable";

export type StorageTarget = { target: "drive"; reason: null } | { target: "server"; reason: ServerReason };

/** Drive answered with something that means «not now» (down, token refused, rate limit), as opposed to one bad file. */
export function driveIsDown(err: unknown): boolean {
  if (!(err instanceof DriveStoreError)) return false;
  if (err.step.endsWith("_no_connection")) return true;
  const status = err.status;
  return status !== undefined && (status >= 500 || status === 401 || status === 403 || status === 429);
}

const PAUSE_MS = 60_000;
const pausedUntil = new Map<string, number>();

/**
 * After Drive failed for a reason that is about Drive and not about the file, the next minute's uploads go straight to the
 * server instead of each waiting for Drive to time out. A success (or the minute passing) puts Drive first again.
 */
export function pauseDrive(orgId: string, now = Date.now()): void {
  pausedUntil.set(orgId, now + PAUSE_MS);
}

export function resumeDrive(orgId: string): void {
  pausedUntil.delete(orgId);
}

export function driveIsPaused(orgId: string, now = Date.now()): boolean {
  const until = pausedUntil.get(orgId);
  if (until === undefined) return false;
  if (until <= now) {
    pausedUntil.delete(orgId);
    return false;
  }
  return true;
}

/** Where a new file of this company goes right now, and when it is the server, why. */
export async function storageTarget(orgId: string): Promise<StorageTarget> {
  const g = await getGoogleStatus(orgId);
  if (!g.configured) return { target: "server", reason: "not_configured" };
  if (!g.connected) return { target: "server", reason: "not_connected" };
  if (g.libraryOff) return { target: "server", reason: "feature_off" };
  if (!g.library) return { target: "server", reason: "needs_reconnect" };
  if (driveIsPaused(orgId)) return { target: "server", reason: "unavailable" };
  return { target: "drive", reason: null };
}
