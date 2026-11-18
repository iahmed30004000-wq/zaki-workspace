import { redirect } from "next/navigation";
import { pageUser, type CurrentUser } from "@/server/auth";
import { perRequest } from "@/server/env";
import { actorCan, requireActor, type Actor } from "@/server/policy/actor";
import type { Capability } from "@/server/policy/capabilities";
import { getServerT } from "@/lib/i18n/server";

/**
 * What every page of the app needs to know about the person looking at it - in one place, so no
 * page decides "who is this and what company are they in" on its own (the old pages took the
 * OLDEST membership, suspended or not, and read the role off it).
 *
 *  - nobody signed in, or a cookie that is no longer honoured (suspended, offboarded, password
 *    reset, "log out everywhere"): to the login screen;
 *  - the company is the oldest membership that is still ACTIVE, the rank is the one held THERE and
 *    the capabilities are that rank's defaults plus whatever the owner switched on or off;
 *  - a person who has not finished onboarding (temporary password, notice not accepted) is
 *    refused by `requireActor` with 403 `auth.onboarding_required` and is NOT sent anywhere from
 *    here: the (app) layout sends them to the onboarding screen before any page renders.
 */
export const pageActor: () => Promise<{ user: CurrentUser; actor: Actor }> = perRequest(async () => {
  const user = await pageUser();
  if (!user) redirect("/login");
  return { user, actor: await requireActor() };
});

/**
 * The rank a view should believe for a capability-driven area. Several views (automation,
 * Telegram) show their management controls when the rank they are given is OWNER or ADMIN; the
 * switch must decide that, not the rank. Whoever holds `capability` is presented as a manager,
 * everybody else as a plain member, and an external partner stays a guest. The server enforces
 * the real answer on every request: this only keeps the screen honest.
 */
export function presentedRole(actor: Actor, capability: Capability): "OWNER" | "ADMIN" | "MEMBER" | "GUEST" {
  if (actor.isExternal) return "GUEST";
  if (!actorCan(actor, capability)) return "MEMBER";
  return actor.isOwner ? "OWNER" : "ADMIN";
}

/** Shown instead of a section the owner has switched off for this person. */
export function SectionOffNotice() {
  const { t } = getServerT();
  return (
    <div className="mx-auto max-w-2xl p-10 text-center text-sm text-muted">{t("access.section_off")}</div>
  );
}
