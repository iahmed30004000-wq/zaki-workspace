import { NextResponse } from "next/server";
import { withApi } from "@/server/api";
import { db } from "@/server/db";
import { actorCan, requireActor } from "@/server/policy/actor";
import { actorFeatureOn } from "@/server/services/features";
import { contactOwnerId } from "@/components/settings-me/server-data";

/**
 * «إعداداتي» on the phone: the facts its sections are drawn from, which the site's page reads on the server (src/app/(app)/settings/me/
 * [section]/page.tsx) and no other route answers — the same functions, so the two cannot disagree. Every section still decides again on
 * its own route. Nothing here is anybody else's: the id of the company's primary owner is given only to a person of the team who is not
 * that owner (the «تواصل مع الإدارة» row), exactly as the page does.
 */
export async function GET() {
  return withApi(async () => {
    const actor = await requireActor();
    const [me, avatars, chatAutomation, lastSeen, appConnection, chatFolders, owner] = await Promise.all([
      db.user.findUnique({ where: { id: actor.userId }, select: { digits: true } }),
      actorFeatureOn(actor, "avatars"),
      actorFeatureOn(actor, "chatAutomation"),
      actorFeatureOn(actor, "lastSeen"),
      actorFeatureOn(actor, "appConnection"),
      actorFeatureOn(actor, "chatFolders"),
      contactOwnerId(actor),
    ]);
    return NextResponse.json({
      external: actor.isExternal,
      usernameManaged: actorCan(actor, "users.manage"),
      contactOwnerId: owner,
      digits: me?.digits === "arabic" ? "arabic" : "latin",
      features: {
        avatars,
        chatAutomation,
        // «إخفاء آخر ظهوري» is never offered to an external partner (the page's own rule)
        lastSeen: lastSeen && !actor.isExternal,
        appConnection,
        chatFolders,
      },
    });
  });
}
