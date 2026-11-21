import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "../src/middleware";
import { signSessionToken } from "../src/lib/session-token";

/**
 * C4.2 — the Edge middleware verifies the SIGNATURE and expiry of the cookie only (no database in the Edge runtime: tests/middleware-onboarding.test.ts pins its
 * imports). Whether the session behind it was ended is decided by `currentUser()` on the server, for every page and every API route. What the middleware must
 * do with the new claim: let a cookie with a session id through exactly like one without (an old cookie, issued before the deploy, keeps working), and never
 * trust the claim for anything.
 */

const SECRET = process.env["AUTH_SECRET"] as string; // tests/setup.ts

function page(cookie: string) {
  return new NextRequest("http://localhost:3000/projects", { headers: new Headers({ host: "localhost:3000", cookie: `zaki_session=${cookie}` }) });
}
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("middleware and the session id", () => {
  it("a cookie with a session id and one without are both let through (an old cookie is not signed out by the deploy)", async () => {
    const withSid = await signSessionToken({ userId: "u1", tv: 0, sid: "cmabcdef1234567890" }, SECRET, 3600);
    const without = await signSessionToken({ userId: "u1", tv: 0 }, SECRET, 3600);
    expect(passes(await middleware(page(withSid)))).toBe(true);
    expect(passes(await middleware(page(without)))).toBe(true);
  });

  it("a cookie with a malformed session id counts as no session (sign-in), like any other bad token", async () => {
    const bad = await signSessionToken({ userId: "u1", tv: 0, sid: "no" }, SECRET, 3600);
    const res = await middleware(page(bad));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") as string).pathname).toBe("/login");
  });

  it("a session id never lets a page through on its own: an unsigned or foreign-signed token is refused", async () => {
    const foreign = await signSessionToken({ userId: "u1", tv: 0, sid: "cmabcdef1234567890" }, "another-secret-of-16+chars", 3600);
    expect((await middleware(page(foreign))).status).toBe(307);
  });
});
