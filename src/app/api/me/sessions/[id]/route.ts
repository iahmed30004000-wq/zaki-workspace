import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { audit, clearSessionCookie, NotFoundError, requireUser } from "@/server/auth";
import { revokeSessionFor } from "@/server/services/sessions";

/**
 * DELETE: «اطلع من هالجهاز» — ends ONE session (C4.2). The person's other devices keep working: nothing of their `tokenVersion` moves, the row is only marked
 * revoked, so the cookie of that device is refused at its NEXT request (401) and everything else is untouched.
 *
 * The row's owner is read from the row, never from the request. The caller's own session, or one of somebody the OWNER may manage (an offboarded person);
 * any other id, and one that does not exist, is 404 `session.not_found` and nothing is touched (an id cannot be probed). Ending the session this very request
 * belongs to also clears its cookie (it is a sign-out of this device). No cookie, session id or user agent goes into the audit row.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  return withApi(async () => {
    const user = await requireUser();
    const ended = await revokeSessionFor(user.id, params.id);
    if (!ended) throw new NotFoundError("session.not_found");
    const own = ended.userId === user.id;
    if (own && user.sid === params.id) await clearSessionCookie();
    if (ended.wasLive) await audit("auth.session_revoked", { actorId: user.id, target: ended.userId, meta: { own } });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}

export const dynamic = "force-dynamic";
