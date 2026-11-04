import { NextResponse, type NextRequest } from "next/server";
import { originAllowed } from "@/lib/origin-guard";
import { securityHeaders } from "@/lib/security-headers";
import { verifySessionTokenWith } from "@/lib/session-token";
import { safeNextPath } from "@/lib/safe-next";

/**
 * Runs in the Edge runtime: nothing here may import Prisma or a Node-only module
 * (tests/middleware-onboarding.test.ts pins the imports).
 *
 * 1. Writes to the JSON API must come from this app's own pages (see origin-guard.ts). A request
 *    is an API call when its raw OR its canonical path says so (see canonicalPath).
 *    Machine-to-machine endpoints are exempt — only when BOTH spellings are one: they
 *    authenticate with their own token/signature and are not called from a browser.
 * 2. Pages: the session cookie is VERIFIED (signature and expiry, with AUTH_SECRET). No valid
 *    token -> /login?next=<page>. A valid token that still owes a password change or the
 *    transparency notice (`mcp` / `tp`) -> /onboarding?next=<page>. Whether the session is still
 *    honoured (suspended, password reset, ...) needs the database: server code decides that.
 * 3. API routes enforce auth themselves (`requireUser` answers 403 auth.onboarding_required for
 *    somebody who has not finished the onboarding).
 */
const MACHINE_PATHS = ["/api/integrations/n8n/inbound", "/api/v1", "/api/health"];
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/register/check-email",
  "/register/confirm",
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/register/confirm",
];
const COOKIE = "zaki_session";

/**
 * The path the way Next's ROUTER reads it. The router resolves a static route from the DECODED
 * path as well (`/%61pi/me/transparency` and `/api%2Fme/transparency` reach /api/me/transparency),
 * so every decision here is taken on the canonical spelling, never on the raw one: percent-escapes
 * decoded (up to three layers: a double-encoded spelling must not slip through), backslashes read
 * as slashes, empty and dot segments resolved. `malformed` = an escape that cannot be decoded: the
 * caller treats such a request as a possible API call.
 */
export function canonicalPath(pathname: string): { path: string; malformed: boolean } {
  let p = pathname;
  let malformed = false;
  for (let i = 0; i < 3; i++) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(p);
    } catch {
      malformed = true;
      break;
    }
    if (decoded === p) break;
    p = decoded;
  }
  p = p.replace(/\\/g, "/");
  const out: string[] = [];
  for (const segment of p.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return { path: "/" + out.join("/"), malformed };
}

/** Exact path or a sub-path ("/api/v1/ideas"); a look-alike such as "/api/healthx" is NOT a machine endpoint. */
function isMachinePath(pathname: string): boolean {
  return MACHINE_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

/**
 * Files the browser fetches on its own (the app icon, the manifest, the fonts and pictures of public/): never
 * redirected. ONLY those: a page address that merely ENDS like a file (`/tasks/abc.png` = the task page with the id
 * "abc.png") is a page and goes through the sign-in and onboarding rules below. A dot segment never counts as a
 * public folder. `/sw.js` is the service worker (it shows a ring when the site is closed: src/server/calls/push.ts).
 * `/.well-known/assetlinks.json` is how Chrome proves the Android app owns this site (public/.well-known/assetlinks.json): it must answer a stranger.
 * `/noise/` is the call noise filter's model and worklet (src/components/calls/noise-filter.ts).
 * `/sounds/` is the ring of a call (src/lib/calls/ring-sound.ts): it must play on the sign-in page's side of a redirect too.
 */
const STATIC_DIRS = ["/icons/", "/brand/", "/fonts/", "/noise/", "/sounds/"];
const STATIC_ROOT_FILES = new Set(["/icon.svg", "/apple-icon.png", "/manifest.webmanifest", "/favicon.ico", "/robots.txt", "/sw.js", "/.well-known/assetlinks.json"]);
const STATIC_EXT = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|txt|xml|webmanifest|woff2?|css|js|map|wasm|mp3)$/i;
function isStaticFile(pathname: string): boolean {
  if (STATIC_ROOT_FILES.has(pathname)) return true;
  if (/(^|\/)\.\.?(\/|$)/.test(pathname)) return false;
  return STATIC_DIRS.some((dir) => pathname.startsWith(dir)) && STATIC_EXT.test(pathname);
}

/** The page that was asked for, as a `?next=` value ("" for the home page). */
function nextOf(req: NextRequest): string {
  const params = new URLSearchParams(req.nextUrl.search);
  params.delete("_rsc"); // the router's cache-busting parameter, not part of the page
  const query = params.toString();
  const target = safeNextPath(`${req.nextUrl.pathname}${query ? `?${query}` : ""}`);
  return target === "/" ? "" : target;
}

/**
 * The address the BROWSER used. `req.nextUrl` holds the address the server was started on
 * (localhost:3001), so a redirect built from it sends a visitor of a tunnel or a reverse proxy to a
 * dead address on their own machine. The public host and scheme are the ones the proxy forwarded —
 * `x-forwarded-host` first (a proxy in front of another one rewrites `host`), then `host`.
 */
function publicBase(req: NextRequest): { origin: string; host: string; proto: string } | null {
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || req.headers.get("host")?.trim() || "";
  if (!host) return null;
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : req.nextUrl.protocol.replace(":", "");
  return { origin: `${proto}://${host}`, host, proto };
}

/** APP_URL (the public address the owner configured), or null when it is not set or unparsable. */
function appUrl(): URL | null {
  const raw = (process.env["APP_URL"] ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function redirectTo(req: NextRequest, pathname: string): NextResponse {
  const base = publicBase(req);
  const next = nextOf(req);
  const trusted = appUrl();
  // The forwarded host is written by whoever sends the request. With APP_URL set, it is trusted only
  // when it IS the configured public host; any other value redirects to APP_URL itself — never to a
  // host a client chose (review B5: header injection / cache poisoning). The Location must be ABSOLUTE:
  // Next's middleware adapter parses it with `new URL()` and answers 500 for a relative one (a relative
  // Location shipped in #14 and turned every redirect of a non-APP_URL address into an error page).
  // Without APP_URL (local development) the old rule stays.
  if (trusted && base && base.host.toLowerCase() !== trusted.host.toLowerCase()) {
    const url = new URL(pathname, trusted.origin);
    if (next) url.searchParams.set("next", next);
    return NextResponse.redirect(url, 307);
  }
  const url = base ? new URL(`${base.origin}${pathname}`) : req.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  if (next) url.searchParams.set("next", next);
  const res = NextResponse.redirect(url);
  // a session cookie set on the internal scheme would never come back from an https visitor
  if (base && base.proto === "https") res.headers.append("vary", "x-forwarded-proto, x-forwarded-host");
  return res;
}

export async function middleware(req: NextRequest) {
  const res = await handleRequest(req);
  const proto = publicBase(req)?.proto ?? req.nextUrl.protocol.replace(":", "");
  for (const [name, value] of securityHeaders({ https: proto === "https" })) res.headers.set(name, value);
  return res;
}

async function handleRequest(req: NextRequest): Promise<NextResponse> {
  const raw = req.nextUrl.pathname;
  const { path: pathname, malformed } = canonicalPath(raw);
  // Next resolves a STATIC route from the decoded path and matches a DYNAMIC route on the raw one
  // ("/api/tasks/..%2F..%2Flogin" is /api/tasks/[id] with id "../../login", although it reads as
  // "/login"): a request is an API call when EITHER spelling says so.
  const isApi = raw.startsWith("/api/") || pathname.startsWith("/api/");
  // ...and a machine endpoint only when BOTH spellings are one
  const isMachine = isMachinePath(raw) && isMachinePath(pathname);

  // a spelling that cannot be decoded might still be routed: guard it like an API call
  if ((isApi || malformed) && !isMachine) {
    const allowed = originAllowed({
      method: req.method,
      origin: req.headers.get("origin"),
      host: req.headers.get("host"),
      forwardedHost: req.headers.get("x-forwarded-host"),
      secFetchSite: req.headers.get("sec-fetch-site"),
      appUrl: process.env["APP_URL"],
    });
    if (!allowed) {
      return NextResponse.json({ error: "forbidden", message: "origin.mismatch" }, { status: 403 });
    }
  }

  if (PUBLIC_PATHS.includes(pathname) || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }
  if (isApi || isStaticFile(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE)?.value;
  const secret = process.env["AUTH_SECRET"];
  const session = token && secret ? await verifySessionTokenWith(token, secret) : null;
  if (!session) return redirectTo(req, "/login");
  if ((session.mcp || session.tp) && pathname !== "/onboarding") return redirectTo(req, "/onboarding");
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
