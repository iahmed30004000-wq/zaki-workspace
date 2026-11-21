import { NextResponse } from "next/server";
import { audit, clearSessionCookie, currentUser } from "@/server/auth";
import { getSessionUser } from "@/server/session";
import { revokeOwnSession } from "@/server/services/sessions";
import { withApi } from "@/server/api";

/**
 * Sign out of this browser. Works for anybody, including somebody in the middle of the onboarding.
 * The audit row is written only when a VALID session existed (it names who signed out): no cookie,
 * or a cookie that is no longer honoured, clears the cookie and writes nothing, so an anonymous
 * script cannot grow the audit log.
 *
 * C4.2: the session row the cookie names is ENDED, so a copy of that cookie stops working too (before, signing out only cleared this browser's copy: R11).
 * The row comes from the signed cookie itself; a cookie without a session id (issued before C4.2) has nothing to end and expires on its own.
 */
export async function POST() {
  return withApi(async () => {
    const user = await currentUser();
    const held = await getSessionUser();
    if (held?.sid) await revokeOwnSession(held.sid, held.userId);
    await clearSessionCookie();
    if (user) await audit("auth.logout", { actorId: user.id });
    return NextResponse.json({ ok: true });
  });
}
