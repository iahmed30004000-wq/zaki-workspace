import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "../src/middleware";
import { signSessionToken, type SessionClaims } from "../src/lib/session-token";

// New module of this phase, imported where it is used.
const safeNext = async () => (await import("../src/lib/safe-next")).safeNextPath;

const SECRET = process.env["AUTH_SECRET"] as string; // tests/setup.ts

function token(claims: SessionClaims, opts: { ttl?: number; secret?: string } = {}) {
  return signSessionToken(claims, opts.secret ?? SECRET, opts.ttl ?? 3600);
}

function req(pathAndQuery: string, cookie?: string, method = "GET") {
  const headers = new Headers({ host: "localhost:3000" });
  if (cookie !== undefined) headers.set("cookie", `zaki_session=${cookie}`);
  return new NextRequest(`http://localhost:3000${pathAndQuery}`, { method, headers });
}

const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";
function location(res: Response): string {
  const loc = res.headers.get("location");
  if (!loc) throw new Error(`expected a redirect, got ${res.status}`);
  const u = new URL(loc);
  return u.pathname + u.search;
}

describe("middleware: the session cookie is verified, not just present", () => {
  it("a valid token lets a page through", async () => {
    const res = await middleware(req("/projects", await token({ userId: "u1", tv: 0 })));
    expect(passes(res)).toBe(true);
  });

  it("a garbage, foreign, expired or version-less token counts as no session (sign-in, with ?next=)", async () => {
    const legacy = await (async () => {
      const { SignJWT } = await import("jose");
      const key = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SECRET)));
      return new SignJWT({ userId: "u1" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(key);
    })();
    const bad = [
      "abc",
      await token({ userId: "u1", tv: 0 }, { secret: "another-secret-of-16+chars" }),
      await token({ userId: "u1", tv: 0 }, { ttl: -60 }),
      legacy,
    ];
    for (const cookie of bad) {
      const res = await middleware(req("/projects", cookie));
      expect(res.status, cookie.slice(0, 12)).toBe(307);
      expect(location(res)).toBe("/login?next=%2Fprojects");
    }
  });

  it("keeps the query string of the page that was asked for", async () => {
    const res = await middleware(req("/projects?workspace=abc"));
    expect(location(res)).toBe("/login?next=%2Fprojects%3Fworkspace%3Dabc");
  });

  it("does not send the browser's own icon request to the sign-in page", async () => {
    expect(passes(await middleware(req("/icon.svg")))).toBe(true);
  });
});

describe("middleware: unfinished onboarding goes to /onboarding", () => {
  it("a token that still owes a password change sends pages to /onboarding?next=", async () => {
    const res = await middleware(req("/projects?tab=board", await token({ userId: "u1", tv: 2, mcp: true })));
    expect(res.status).toBe(307);
    expect(location(res)).toBe("/onboarding?next=%2Fprojects%3Ftab%3Dboard");
  });

  it("a token that still owes the notice does too; from / there is no ?next=", async () => {
    const res = await middleware(req("/", await token({ userId: "u1", tv: 0, tp: true })));
    expect(location(res)).toBe("/onboarding");
  });

  it("leaves /onboarding itself, the API, sign-in pages and static files alone (no loop, routes enforce auth)", async () => {
    const pending = await token({ userId: "u1", tv: 0, mcp: true, tp: true });
    for (const p of ["/onboarding", "/onboarding?next=%2Fprojects", "/api/me", "/api/me/password", "/api/tasks", "/login", "/register", "/icon.svg"]) {
      expect(passes(await middleware(req(p, pending))), p).toBe(true);
    }
    expect(passes(await middleware(req("/api/auth/logout", pending, "POST")))).toBe(true);
  });

  it("a finished person is not sent to /onboarding", async () => {
    const res = await middleware(req("/chat", await token({ userId: "u1", tv: 7 })));
    expect(passes(res)).toBe(true);
  });

  it("an anonymous visitor of /onboarding is sent to sign in (the sign-in decides about the onboarding itself)", async () => {
    const res = await middleware(req("/onboarding"));
    expect(res.status).toBe(307);
    expect(location(res)).toBe("/login");
  });

  it("behind a proxy or tunnel the redirect points at the PUBLIC host, not the internal one", async () => {
    // `req.nextUrl` carries the address the server was started on (localhost:3001), so a redirect built
    // from it sends a visitor of the tunnel to a dead address on their own machine.
    const publicHost = "simpsons-details-hewlett-including.trycloudflare.com";
    const cases: Array<Record<string, string>> = [
      { host: publicHost, "x-forwarded-host": publicHost, "x-forwarded-proto": "https" },
      { host: publicHost, "x-forwarded-proto": "https" },
    ];
    for (const headers of cases) {
      const h = new Headers(headers);
      const res = await middleware(new NextRequest(`http://localhost:3001/projects`, { headers: h }));
      const loc = new URL(res.headers.get("location") as string);
      expect(loc.host, JSON.stringify(headers)).toBe(publicHost);
      expect(loc.protocol).toBe("https:");
      expect(loc.pathname + loc.search).toBe("/login?next=%2Fprojects");
    }
  });

  it("with APP_URL set, a forwarded host that is not APP_URL's never becomes the redirect's host (review B5)", async () => {
    const saved = process.env["APP_URL"];
    process.env["APP_URL"] = "https://workspace.zakiai.io";
    try {
      // a hostile header: the redirect goes to APP_URL, never to the host the client wrote; and it is
      // ABSOLUTE, because Next's adapter answers 500 for a relative Location (the bug #14 shipped)
      const hostile = await middleware(
        new NextRequest("http://localhost:3001/projects", { headers: new Headers({ host: "localhost:3001", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" }) }),
      );
      expect(hostile.status).toBe(307);
      expect(hostile.headers.get("location")).toBe("https://workspace.zakiai.io/login?next=%2Fprojects");
      // the configured public host: an absolute redirect to it, as before
      const real = await middleware(
        new NextRequest("http://localhost:3001/projects", { headers: new Headers({ host: "localhost:3001", "x-forwarded-host": "workspace.zakiai.io", "x-forwarded-proto": "https" }) }),
      );
      const loc = new URL(real.headers.get("location") as string);
      expect(loc.origin).toBe("https://workspace.zakiai.io");
      expect(loc.pathname + loc.search).toBe("/login?next=%2Fprojects");
    } finally {
      if (saved === undefined) delete process.env["APP_URL"];
      else process.env["APP_URL"] = saved;
    }
  });

  it("every redirect's Location is an absolute URL, as Next's middleware adapter requires (new URL() with no base)", async () => {
    const saved = process.env["APP_URL"];
    try {
      for (const appUrl of [undefined, "https://workspace.zakiai.io", "http://localhost:3002"]) {
        if (appUrl === undefined) delete process.env["APP_URL"];
        else process.env["APP_URL"] = appUrl;
        const cases: Array<Record<string, string>> = [
          { host: "localhost:3001" },
          { host: "sara.localhost:3002" },
          { host: "127.0.0.1:3002" },
          { host: "localhost:3001", "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
          { host: "workspace.zakiai.io", "x-forwarded-proto": "https" },
        ];
        for (const headers of cases) {
          const res = await middleware(new NextRequest("http://localhost:3001/projects", { headers: new Headers(headers) }));
          const loc = res.headers.get("location");
          expect(loc, `${appUrl} ${JSON.stringify(headers)}`).not.toBeNull();
          expect(() => new URL(loc as string), `${appUrl} ${JSON.stringify(headers)} -> ${loc}`).not.toThrow();
          expect(new URL(loc as string).pathname).toBe("/login");
        }
      }
    } finally {
      if (saved === undefined) delete process.env["APP_URL"];
      else process.env["APP_URL"] = saved;
    }
  });

  it("a ?next= is only ever a path on this site", async () => {
    const res = await middleware(req("//evil.example/x"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") as string).host).toBe("localhost:3000");
    expect(location(res)).toBe("/login");
  });
});

describe("middleware: the files a browser fetches by itself pass without a session - and only those", () => {
  const ROOT = path.resolve(__dirname, "..");

  /** The real files of a folder of public/, as the addresses a browser asks for. */
  const served = (folder: string, extension: RegExp) =>
    readdirSync(path.join(ROOT, "public", folder))
      .filter((name) => extension.test(name))
      .map((name) => `/${folder}/${name}`);

  /** What the sign-in and onboarding screens, the home-screen icon and the installed app load before anybody is signed in. */
  const STATIC = [
    "/manifest.webmanifest", // drawn by Next from src/app/manifest.ts
    "/apple-icon.png", // src/app/apple-icon.png
    "/.well-known/assetlinks.json", // public/.well-known/: how Chrome proves the Android app owns the site
    "/icon.svg", // src/app/icon.svg
    ...served("icons", /\.png$/),
    ...served("brand/decor", /\.webp$/),
    ...served("fonts", /\.woff2$/),
    // the call noise filter (copied into public/noise/ by the build: scripts/copy-noise-assets.mjs)
    "/noise/rnnoise.wasm",
    "/noise/rnnoise_simd.wasm",
    "/noise/rnnoise-worklet.js",
  ];

  it("the list is real: Next's own files exist in src/app, the others are the files in public/", () => {
    for (const file of ["src/app/manifest.ts", "src/app/apple-icon.png", "src/app/icon.svg"]) {
      expect(existsSync(path.join(ROOT, file)), file).toBe(true);
    }
    expect(served("icons", /\.png$/).length).toBeGreaterThanOrEqual(3);
    expect(served("brand/decor", /\.webp$/).length).toBeGreaterThan(0);
    expect(served("fonts", /\.woff2$/).length).toBeGreaterThan(0);
  });

  it("an anonymous request for the manifest, an app icon, the Apple icon, a decoration or a font passes untouched", async () => {
    for (const p of STATIC) {
      const res = await middleware(req(p));
      expect(passes(res), p).toBe(true);
      expect(res.headers.get("location"), p).toBeNull();
    }
  });

  it("so does a request from somebody half-way through the onboarding (its own screen needs the font and the icons)", async () => {
    const pending = await token({ userId: "u1", tv: 0, mcp: true, tp: true });
    for (const p of STATIC) expect(passes(await middleware(req(p, pending))), p).toBe(true);
  });

  it("the file extension must end the path: a folder of files, or a name that only contains one, is a page and needs a session", async () => {
    for (const p of ["/icons", "/brand/decor", "/fonts", "/noise", "/manifest.json", "/icon.svg.html", "/fonts/reem-kufi-var.woff2x", "/noise/rnnoise.wasmx"]) {
      const res = await middleware(req(p));
      expect(res.status, p).toBe(307);
      expect(location(res), p).toBe(`/login?next=${encodeURIComponent(p)}`);
    }
  });

  it("an API path that merely looks like a file (/api/x.png) is still the API: the Origin guard refuses a cross-site write", async () => {
    for (const p of ["/api/x.png", "/api/tasks/abc.png", "/api/fonts/x.woff2", "/%61pi/x.png"]) {
      const crossSite = new NextRequest(`http://localhost:3000${p}`, {
        method: "POST",
        headers: new Headers({ host: "localhost:3000", origin: "https://evil.example", "sec-fetch-site": "cross-site" }),
      });
      const res = await middleware(crossSite);
      expect(res.status, p).toBe(403);
      expect(await res.json(), p).toEqual({ error: "forbidden", message: "origin.mismatch" });
    }
  });

  /**
   * A PAGE address whose last segment merely ends like a file (`/tasks/abc.png` is the task page with the id
   * "abc.png") is a page like any other: the middleware sends a stranger to sign in. Only what the browser
   * really fetches on its own is static: the public folders /icons/, /brand/, /fonts/ and the root names
   * /icon.svg, /apple-icon.png, /manifest.webmanifest (+ /favicon.ico, /robots.txt).
   */
  it("a page address that only ends like a file (/tasks/abc.png) is still sent to sign in", async () => {
    for (const p of ["/tasks/abc.png", "/u/abc.svg", "/projects/abc.webp", "/icons/%2e%2e/tasks/abc.png"]) {
      const res = await middleware(req(p));
      expect(res.status, p).toBe(307);
      // the URL parser already resolves an encoded dot segment ("/icons/%2e%2e/tasks/abc.png" IS /tasks/abc.png)
      expect(location(res), p).toBe(`/login?next=${encodeURIComponent(new URL(p, "http://localhost").pathname)}`);
    }
  });
});

describe("safeNextPath: ?next= never leaves this site", () => {
  it("keeps a plain path on this site, with its query", async () => {
    const safeNextPath = await safeNext();
    expect(safeNextPath("/projects")).toBe("/projects");
    expect(safeNextPath("/projects?tab=board#top")).toBe("/projects?tab=board#top");
    expect(safeNextPath("/u/abc")).toBe("/u/abc");
  });

  it("falls back to / for anything that could reach another site", async () => {
    const safeNextPath = await safeNext();
    for (const evil of [
      "//evil.example",
      "///evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/.//evil.example",
      "/a/..//evil.example",
      "https://evil.example",
      "http:/evil.example",
      "javascript:alert(1)",
      "evil.example",
      " /projects",
      "",
    ]) {
      expect(safeNextPath(evil), JSON.stringify(evil)).toBe("/");
    }
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath(["/a", "/b"])).toBe("/");
  });

  it("an encoded slash stays a harmless path on this site", async () => {
    const safeNextPath = await safeNext();
    const out = safeNextPath("/%2F%2Fevil.example");
    expect(out.startsWith("/")).toBe(true);
    expect(out.startsWith("//")).toBe(false);
    expect(new URL(out, "https://workspace.example").host).toBe("workspace.example");
  });

  it("never points back into the sign-in or onboarding pages or the API", async () => {
    const safeNextPath = await safeNext();
    for (const p of ["/login", "/login?next=/x", "/register", "/onboarding", "/onboarding?next=/x", "/api/me"]) {
      expect(safeNextPath(p), p).toBe("/");
    }
  });
});

describe("the middleware stays Edge-safe", () => {
  const ROOT = path.resolve(__dirname, "..");
  const importsOf = (file: string) =>
    [...readFileSync(path.join(ROOT, file), "utf8").matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]);

  it("imports nothing that needs Node or the database", () => {
    expect(importsOf("src/middleware.ts").sort()).toEqual(
      ["@/lib/origin-guard", "@/lib/safe-next", "@/lib/security-headers", "@/lib/session-token", "next/server"].sort(),
    );
    for (const file of ["src/lib/session-token.ts", "src/lib/safe-next.ts", "src/lib/origin-guard.ts", "src/lib/security-headers.ts"]) {
      for (const spec of importsOf(file)) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/^(node:|@\/server|@prisma|\.\.?\/)/);
      }
    }
  });
});
