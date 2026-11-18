import { describe, expect, it } from "vitest";
import { DOOR_PERMISSIONS, bearerOf, generateToken, hashToken, parseToken, permits, tokenMatches } from "@/server/door/tokens";
import { FixedWindowLimiter } from "@/server/rate-limit";
import { DOOR_LIMITS } from "@/server/door/limits";

/** «الباب»: the token itself (src/server/door/tokens.ts) — pure, no database. */
describe("the token", () => {
  it("is 256 random bits, found by a public prefix, and never the same twice", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a.token).toMatch(/^zws_[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.prefix).not.toBe(b.prefix);
    expect(parseToken(a.token)).toEqual({ prefix: a.prefix });
  });

  it("is stored as a hash: the stored value is neither the token nor contains its secret", () => {
    const t = generateToken();
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.hash).toBe(hashToken(t.token));
    expect(t.hash).not.toContain(t.token.split(".")[1] as string);
  });

  it("matches only itself: a wrong secret, a changed character, another token and no row all fail", () => {
    const a = generateToken();
    const b = generateToken();
    expect(tokenMatches(a.token, a.hash)).toBe(true);
    expect(tokenMatches(b.token, a.hash)).toBe(false);
    expect(tokenMatches(a.token.slice(0, -1) + (a.token.endsWith("A") ? "B" : "A"), a.hash)).toBe(false);
    expect(tokenMatches(a.token, null)).toBe(false); // an unknown prefix: compared against a decoy, always false
    expect(tokenMatches(a.token, "not-hex")).toBe(false);
    expect(tokenMatches(a.token, a.hash.slice(2))).toBe(false);
  });

  it("is read only from `Authorization: Bearer <token>`: another scheme, extra words, an empty value are nothing", () => {
    const { token } = generateToken();
    expect(bearerOf(`Bearer ${token}`)).toBe(token);
    expect(bearerOf(`bearer ${token}`)).toBe(token);
    for (const bad of [null, "", `Basic ${token}`, `Bearer ${token} extra`, "Bearer", token, "Bearer  "]) expect(bearerOf(bad as string | null), String(bad)).toBeNull();
  });

  it("refuses a malformed token before any database is asked", () => {
    const secret = "A".repeat(43);
    for (const bad of ["", "zws_", "zws_abc.def", `abc_0123456789ab.${secret}`, `zws_0123456789ab.${"A".repeat(42)}`, `zws_0123456789ab.${"A".repeat(44)}`, `zws_0123456789AB.${secret}`]) {
      expect(parseToken(bad), bad).toBeNull();
    }
  });
});

describe("the permissions", () => {
  it("are four named ones; a token with none can do nothing", () => {
    expect([...DOOR_PERMISSIONS]).toEqual(["ideas.read", "ideas.write", "tasks.read", "tasks.write"]);
    for (const needed of DOOR_PERMISSIONS) expect(permits([], needed), needed).toBe(false);
  });

  it("a write permission also reads what the token sent in, and nothing else is implied", () => {
    expect(permits(["ideas.write"], "ideas.read")).toBe(true);
    expect(permits(["tasks.write"], "tasks.read")).toBe(true);
    expect(permits(["ideas.read"], "ideas.write")).toBe(false);
    expect(permits(["ideas.write"], "tasks.read")).toBe(false);
    expect(permits(["tasks.write"], "ideas.write")).toBe(false);
    expect(permits(["tasks.read"], "tasks.write")).toBe(false);
  });
});

describe("the rate limits", () => {
  it("are one number each, written where the contract reads them", () => {
    expect(DOOR_LIMITS.perToken).toEqual({ limit: 60, windowMs: 60_000 });
    expect(DOOR_LIMITS.failuresPerIp.limit).toBe(20);
  });

  it("a token over its limit waits for the window, and one token never uses another allowance", () => {
    let now = 1_000_000;
    const limiter = new FixedWindowLimiter(DOOR_LIMITS.perToken, () => now);
    for (let i = 0; i < DOOR_LIMITS.perToken.limit; i++) {
      expect(limiter.check("t:a").ok).toBe(true);
      limiter.hit("t:a");
    }
    const over = limiter.check("t:a");
    expect(over.ok).toBe(false);
    expect(over.retryAfterSec).toBeGreaterThan(0);
    expect(limiter.check("t:b").ok).toBe(true);
    now += DOOR_LIMITS.perToken.windowMs + 1;
    expect(limiter.check("t:a").ok).toBe(true);
  });
});
