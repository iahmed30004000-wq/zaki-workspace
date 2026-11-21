/**
 * M1a — the name of the build the page came from, and the files of its shell, for the service worker's versioned cache (`public/sw.js`).
 *
 * `public/sw.js` is a plain static file, so it cannot be given the build id when the site is built. The page can read it: the production HTML carries
 * the build's own scripts, `/_next/static/chunks/main-app-<hash>.js` and `webpack-<hash>.js`, and their file names change with every build. The hash
 * IS the build's fingerprint, so the cache is named from it (`zaki-shell-<hash>`) and the cache of an older build is deleted when a newer one arrives.
 * In development the names carry no hash: nothing is cached and nothing is versioned.
 */

const BUILD_FILE = /\/_next\/static\/chunks\/(?:main-app|webpack)-([A-Za-z0-9_-]{8,64})\.js(?:[?#]|$)/;

/** The build's fingerprint from the addresses of the scripts the page loaded, or null (development, an unknown shape). */
export function buildIdFrom(urls: readonly string[]): string | null {
  for (const url of urls) {
    const found = BUILD_FILE.exec(url);
    if (found) return found[1]!;
  }
  return null;
}

/** The only places the shell cache may take a file from: the build's own hashed files, the fonts and the icons (never a page, never `/api/`). */
export const SHELL_PREFIXES = ["/_next/static/", "/fonts/", "/icons/"] as const;

/** How many files one precache request carries at most. */
export const SHELL_MAX_FILES = 120;

/** The same-origin shell files among the addresses the page loaded, as paths (no query, no duplicates), at most `SHELL_MAX_FILES`. */
export function shellFilesFrom(urls: readonly string[], origin: string): string[] {
  const out = new Set<string>();
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw, origin);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    if (!SHELL_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) continue;
    out.add(url.pathname);
    if (out.size >= SHELL_MAX_FILES) break;
  }
  return [...out];
}
