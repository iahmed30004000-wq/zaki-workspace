import { isAbsolute, join, resolve, sep } from "node:path";

/**
 * THE SERVER'S COPY OF A FILE THAT WAS MOVED TO DRIVE. When the owner moves old files to Drive, a row's `path` becomes
 * `gdrive:<id>` and the file on the server's disk is NOT touched: the row remembers it in `meta.serverCopy` (where it was,
 * its size and its SHA-256 at the moment it was moved). The owner removes these copies in a separate, explicit step, and
 * only a copy whose Drive twin reads back with exactly this size and hash is removed. Nothing here needs a migration:
 * `StoredFile.meta` is JSON that every other reader picks its own keys from.
 */
export interface ServerCopy {
  path: string;
  sha256: string;
  size: number;
}

/** The `serverCopy` of a row's `meta`, or null when it has none (or something that is not one). */
export function serverCopyOf(meta: unknown): ServerCopy | null {
  if (!meta || typeof meta !== "object") return null;
  const raw = (meta as Record<string, unknown>)["serverCopy"];
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c["path"] !== "string" || !c["path"]) return null;
  if (typeof c["sha256"] !== "string" || !/^[0-9a-f]{64}$/.test(c["sha256"])) return null;
  if (typeof c["size"] !== "number" || !Number.isInteger(c["size"]) || c["size"] < 0) return null;
  return { path: c["path"], sha256: c["sha256"], size: c["size"] };
}

/**
 * The absolute path of a stored file inside the library folder, or null when the stored path would leave it
 * (a stored path is data; it never reaches outside `root`, whatever a row says).
 */
export function insideLibrary(root: string, stored: string): string | null {
  if (!stored || isAbsolute(stored) || stored.includes("\0")) return null;
  const base = resolve(root);
  const full = resolve(join(base, stored));
  return full.startsWith(base + sep) ? full : null;
}
