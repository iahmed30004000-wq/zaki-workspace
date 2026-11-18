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

/**
 * I1.1b: the limits of `POST /api/v2/messages` (docs/contracts/workspace-door.v2.md), apart from v1's: a card sender is chattier than a task sender.
 * The minute window is in this process; the daily cap is counted from the records of the answers (the database), so a restart does not forget it.
 */
export const DOOR_V2_LIMITS = {
  perToken: { limit: 120, windowMs: 60_000 },
  /** Cards one token may post in 24 hours (a retry answered from its record is not a new card). */
  perTokenPerDay: 2000,
} as const;

export const messageLimiter = new FixedWindowLimiter(DOOR_V2_LIMITS.perToken);
