import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { audit, clearSessionCookie, requireUser } from "@/server/auth";
import { db } from "@/server/db";

/**
 * POST → `{ ok: true }`: «اطلع من كل الأجهزة» (C4.1). Bumps the CALLER's own `tokenVersion`, which ends every session cookie they hold at its next request
 * (src/server/auth.ts) — the device that asked included, so this browser's cookie is cleared in the same answer and the screen says so before the button is pressed.
 * The person's own browsers that receive notifications (`PushSubscription`) and paired phones (`AppDevice`) are disconnected in the same commit.
 * Only the person's own rows move: there is no id in the address or the body, so nobody else's sessions can be named. (The admin's route on OTHERS stays
 * where it is: `/api/organizations/[id]/members/[userId]/logout`.)
 */
export async function POST() {
  return withApi(async () => {
    const user = await requireUser();
    // one commit: the session version moves AND the devices that kept receiving this person's notifications are disconnected (their own list, nobody else's):
    // a browser or a phone that is signed out must not go on receiving the words of their messages
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } }, select: { id: true } }),
      db.pushSubscription.deleteMany({ where: { userId: user.id } }),
      db.appDevice.deleteMany({ where: { userId: user.id } }),
    ]);
    await clearSessionCookie();
    await audit("auth.logout_everywhere", { actorId: user.id });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  });
}

export const dynamic = "force-dynamic";
