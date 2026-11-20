import { NextResponse } from "next/server";
import { z } from "zod";
import { startSession } from "@/server/auth";
import { withApi } from "@/server/api";
import { parseJson } from "@/server/validation";
import { confirmRegistration } from "@/server/services/registration";
import { FixedWindowLimiter, REGISTER_CONFIRM_LIMIT, RateLimitedError, clientIp } from "@/server/rate-limit";

const confirmLimiter = new FixedWindowLimiter(REGISTER_CONFIRM_LIMIT);
const confirmSchema = z.object({ token: z.string().trim().min(20).max(200) });

/**
 * The mailed link was opened and «تأكيد» pressed (a POST, so a mail scanner that only follows
 * links never uses it up): create the company with its OWNER and sign them in. 404
 * `auth.registration_link_invalid` for an unknown, used or expired link.
 */
export async function POST(req: Request) {
  return withApi(async () => {
    const key = `ip:${clientIp(req)}`;
    const state = confirmLimiter.check(key);
    if (!state.ok) throw new RateLimitedError(state.retryAfterSec);
    confirmLimiter.hit(key);

    const { token } = await parseJson(confirmSchema, req);
    const { userId } = await confirmRegistration(token);
    await startSession(userId, { fresh: true, userAgent: req.headers.get("user-agent") });
    return NextResponse.json({ ok: true, next: "/" }, { status: 201 });
  });
}
