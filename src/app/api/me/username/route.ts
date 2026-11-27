import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { requireUser } from "@/server/auth";
import { changeOwnUsername, UsernameError } from "@/server/services/usernames";
import { ConcurrencyGate, FixedWindowLimiter, PASSWORD_CHANGE_MAX_CONCURRENT_CHECKS, RateLimitedError } from "@/server/rate-limit";

/** The same guard as the password change: this door checks the current password too, so it must not be a place to guess it. */
const attempts = new FixedWindowLimiter({ limit: 10, windowMs: 15 * 60_000 });
const checks = new ConcurrencyGate(PASSWORD_CHANGE_MAX_CONCURRENT_CHECKS);

const BODY = z.object({ username: z.string().max(100), currentPassword: z.string().min(1, "password.wrong_current").max(200) });

/** PATCH { username, currentPassword }: change my own sign-in name (src/server/services/usernames.ts). 200 { username }. */
export async function PATCH(req: Request) {
  return withApi(async () => {
    const input = await parseJson(BODY, req);
    const user = await requireUser();
    const key = `user:${user.id}`;
    const state = attempts.check(key);
    if (!state.ok) throw new RateLimitedError(state.retryAfterSec);
    const release = checks.tryAcquire();
    if (!release) throw new RateLimitedError(2);
    attempts.hit(key);
    try {
      const made = await changeOwnUsername(user.id, input.username, input.currentPassword);
      attempts.reset(key);
      return NextResponse.json({ username: made.username });
    } catch (err) {
      if (err instanceof UsernameError) return apiError("conflict", err.key);
      throw err;
    } finally {
      release();
    }
  });
}
