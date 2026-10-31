import { FixedWindowLimiter } from "@/server/rate-limit";

/**
 * «الباب»: the rate limits of /api/v1, in one place so the tests and docs/contracts/workspace-door.v1.md read the same numbers.
 * State is in this process only (one container), like the sign-in limiter (src/server/rate-limit.ts).
 */
export const DOOR_LIMITS = {
  /** Requests a token may send per minute, reads and writes together. Over it: 429 + Retry-After. */
  perToken: { limit: 60, windowMs: 60_000 },
  /** Refused tokens from ONE address (a guess, a revoked token still looping): over it the address gets 429 for the rest of the window. */
  failuresPerIp: { limit: 20, windowMs: 10 * 60_000 },
} as const;

export const tokenLimiter = new FixedWindowLimiter(DOOR_LIMITS.perToken);
export const failureLimiter = new FixedWindowLimiter(DOOR_LIMITS.failuresPerIp);
