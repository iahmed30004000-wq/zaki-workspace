import { readFileSync } from "node:fs";
import path from "node:path";
import { SignJWT } from "jose";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSessionToken, verifySessionToken } from "@/server/session";
import { env } from "@/server/env";

/**
 * C4.2 — the session id (`sid`) a cookie carries, and the pure rules of `src/server/services/sessions.ts`. The database behaviour (a revoked session gets 401 on
 * its next request, the others keep working, an old cookie keeps working) is proved in tests/db/user-sessions.test.ts.
 */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("the cookie's session id", () => {
  it("round-trips with the user and the version", async () => {
    const token = await createSessionToken({ userId: "user_1", tv: 2, sid: "cmabcdef1234567890" });
    expect(await verifySessionToken(token)).toEqual({ userId: "user_1", tv: 2, sid: "cmabcdef1234567890" });
  });

  it("a token WITHOUT one (issued before C4.2) still verifies, as it did: no mass sign-out on the deploy", async () => {
    const token = await createSessionToken({ userId: "user_1", tv: 2 });
    const claims = await verifySessionToken(token);
    expect(claims).toEqual({ userId: "user_1", tv: 2 });
    expect(claims && "sid" in claims).toBe(false);
  });

  it("a token whose sid is not a plausible id is REFUSED, never read as an old token (which no revocation can reach)", async () => {
    const key = createHash("sha256").update(env().AUTH_SECRET).digest();
    for (const sid of ["", "short", "has space in it 123", "x".repeat(65), 12345678901, null, true, ["abcdefgh1234"]]) {
      const t = await new SignJWT({ userId: "u", tv: 0, sid: sid as never })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(key);
      expect(await verifySessionToken(t), JSON.stringify(sid)).toBeNull();
    }
  });

  it("the onboarding flags and the session id travel together", async () => {
    const token = await createSessionToken({ userId: "u", tv: 0, sid: "cmabcdef1234567890", mcp: true, tp: true });
    expect(await verifySessionToken(token)).toEqual({ userId: "u", tv: 0, sid: "cmabcdef1234567890", mcp: true, tp: true });
  });
});

describe("the user agent is stored trimmed", () => {
  it("collapses whitespace, drops control characters, caps the length, and says null for nothing", async () => {
    vi.resetModules();
    vi.doMock("@/server/db", () => ({ db: {} }));
    const { trimUserAgent, USER_AGENT_MAX } = await import("@/server/services/sessions");
    expect(trimUserAgent("  Mozilla/5.0 \r\n (X11;\tLinux)  ")).toBe("Mozilla/5.0 (X11; Linux)");
    expect(trimUserAgent("okhttp/4.12.0")).toBe("okhttp/4.12.0");
    expect(trimUserAgent("a\u0000b\u007fc")).toBe("a b c");
    expect(trimUserAgent("x".repeat(500))?.length).toBe(USER_AGENT_MAX);
    expect(trimUserAgent(`${"x".repeat(199)}   tail`)).toBe("x".repeat(199));
    for (const none of [null, undefined, "", "   ", "\r\n\t"]) expect(trimUserAgent(none as string | null)).toBeNull();
    vi.doUnmock("@/server/db");
    vi.resetModules();
  });
});

describe("last-seen is written at most once per window", () => {
  it("a recently written session costs no query at all; a stale one costs ONE conditional update", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    vi.resetModules();
    vi.doMock("@/server/db", () => ({ db: { userSession: { updateMany } } }));
    const { touchSession, LAST_SEEN_EVERY_MS } = await import("@/server/services/sessions");
    const now = new Date("2026-11-20T10:00:00Z");

    await touchSession({ id: "s1", lastSeenAt: new Date(now.getTime() - 1000) }, now);
    await touchSession({ id: "s1", lastSeenAt: new Date(now.getTime() - LAST_SEEN_EVERY_MS + 5000) }, now);
    expect(updateMany).not.toHaveBeenCalled();

    await touchSession({ id: "s1", lastSeenAt: new Date(now.getTime() - LAST_SEEN_EVERY_MS - 1000) }, now);
    expect(updateMany).toHaveBeenCalledTimes(1);
    const arg = updateMany.mock.calls[0]?.[0] as { where: { id: string; revokedAt: null; lastSeenAt: { lte: Date } }; data: { lastSeenAt: Date } };
    // the throttle is in the UPDATE too: requests that arrive together write once, and a revoked row is never touched
    expect(arg.where).toMatchObject({ id: "s1", revokedAt: null });
    expect(arg.where.lastSeenAt.lte.getTime()).toBe(now.getTime() - LAST_SEEN_EVERY_MS);
    expect(arg.data.lastSeenAt).toEqual(now);
    vi.doUnmock("@/server/db");
    vi.resetModules();
  });

  it("a failed write never refuses the request", async () => {
    vi.resetModules();
    vi.doMock("@/server/db", () => ({ db: { userSession: { updateMany: vi.fn().mockRejectedValue(new Error("db down")) } } }));
    const { touchSession } = await import("@/server/services/sessions");
    await expect(touchSession({ id: "s1", lastSeenAt: new Date(0) })).resolves.toBeUndefined();
    vi.doUnmock("@/server/db");
    vi.resetModules();
  });
});

describe("what the sources must keep", () => {
  it("the sessions service imports no auth code (auth.ts imports it), and logs nothing", () => {
    const src = read("src/server/services/sessions.ts");
    expect(src).not.toMatch(/from "@\/server\/auth"/);
    expect(src).not.toMatch(/\blog\.(info|warn|error|debug)\b|console\./);
  });

  it("the phone's live line authenticates by its own key, never by the cookie: ending a session cannot cut a ring", () => {
    const stream = read("src/app/api/device/stream/route.ts");
    expect(stream).not.toMatch(/currentUser|requireUser|zaki_session|getSessionUser|userSession/);
    expect(stream).toContain("bearerOf");
  });

  it("a cookie's session row is read in parallel with the user (no extra round trip) and last-seen goes through the throttle", () => {
    const auth = read("src/server/auth.ts");
    expect(auth).toMatch(/Promise\.all\(\[\s*db\.user\.findUnique/);
    expect(auth).toContain("touchSession(row)");
    expect(auth).not.toMatch(/userSession\.(update|updateMany)/);
  });

  it("the sign-in routes start a NEW session, a re-issue keeps the request's own", () => {
    expect(read("src/app/api/auth/login/route.ts")).toContain("fresh: true");
    expect(read("src/app/api/auth/register/confirm/route.ts")).toContain("fresh: true");
    expect(read("src/app/api/me/password/route.ts")).not.toContain("fresh: true");
    expect(read("src/app/api/me/transparency/route.ts")).not.toContain("fresh: true");
  });
});
