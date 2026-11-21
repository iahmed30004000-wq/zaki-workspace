import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { NotFoundError, requireUser, startSession } from "@/server/auth";
import { listSessions, mayManageSessionsOf } from "@/server/services/sessions";

/**
 * GET → `{ sessions: [{ id, current, createdAt, lastSeenAt, userAgent }] }`: the devices signed in to the caller's account (C4.2 «الأجهزة»), newest activity
 * first. Only what is still live: an ended session, an expired one and one issued before the last «اطلع من كل الأجهزة» / password change are not listed.
 *
 * `?user=<id>` is the OWNER's view of somebody who was offboarded (what was never ended, so it can be ended: `DELETE /api/me/sessions/[id]`); for anybody
 * else, and for a colleague who is still active, it is 404 `session.not_found`, the same answer as for an id that does not exist.
 *
 * A caller whose cookie was issued before C4.2 (no session id) is migrated here, and only here: it gets its row and a re-issued cookie in this answer, so it
 * shows up as «هالجهاز» and can be ended from another device. Nothing else about the cookie changes. The cookie and the user agent are never part of the answer.
 */
export async function GET(req: Request) {
  return withApi(async () => {
    const user = await requireUser();
    const target = new URL(req.url).searchParams.get("user");
    if (target && target !== user.id) {
      if (!(await mayManageSessionsOf(user.id, target))) throw new NotFoundError("session.not_found");
      const sessions = await listSessions(target, { currentSid: null, tokenVersion: 0, includeStale: true });
      return NextResponse.json({ sessions }, { headers: { "Cache-Control": "no-store" } });
    }
    let sid = user.sid ?? null;
    if (!sid) sid = (await startSession(user.id, { tv: user.tv, adopt: true, userAgent: req.headers.get("user-agent") })).sid;
    const sessions = await listSessions(user.id, { currentSid: sid, tokenVersion: user.tv });
    return NextResponse.json({ sessions }, { headers: { "Cache-Control": "no-store" } });
  });
}

export const dynamic = "force-dynamic";
