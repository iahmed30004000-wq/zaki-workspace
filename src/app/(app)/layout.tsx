import { pageActor } from "@/app/(app)/_access";
import { AppShell } from "@/components/app-shell";
import { audienceOf } from "@/lib/guide/audience";
import { buildNav } from "@/lib/nav/places";
import { newActionsFor } from "@/lib/nav/new-actions";
import { economyOn, featuresOf } from "@/lib/features";
import { EconomyMark } from "@/components/economy-mark";
import { readNavOrder } from "@/lib/nav/order";
import { db } from "@/server/db";
import { cookies } from "next/headers";
import { parseSidebarCookie, SIDEBAR_COOKIE } from "@/components/shell/sidebar-cookie";
import { currentSpace } from "@/server/services/current-space";
import { hasActiveReports, navSubjectOf } from "@/server/services/nav-order";
import { CallRing } from "@/components/calls/call-ring";
import { CallProvider } from "@/components/calls/call-provider";

/**
 * The frame of every signed-in page, decided on the server from the DATABASE (behind the middleware,
 * which only sees the cookie):
 *
 *  - nobody signed in, or a cookie that is no longer honoured: to /login;
 *  - somebody who still owes the onboarding (a temporary password, or a notice the owner re-issued
 *    after the cookie was made): to /onboarding;
 *  - everybody else gets the map of THEIR places: the rank and the switches of the oldest ACTIVE
 *    membership (`pageActor`), so an old guest seat that was closed decides nothing.
 *
 * The map only decides what is OFFERED. Every page still refuses for itself (`pageUser` /
 * `pageActor`): in Next 14 a page renders beside its layout, even when the layout redirects.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, actor } = await pageActor();
  // The side menu's folded state is a cookie (`zk-sidebar`), read on the server: the first frame is
  // already the right width, instead of 256px that shrink after the effect runs.
  const sidebarCollapsed = parseSidebarCookie(cookies().get(SIDEBAR_COOKIE)?.value);
  // the company's name under the wordmark, and its switched-off features («الميزات»: their places are not drawn)
  const org = await db.organization.findUnique({ where: { id: actor.orgId }, select: { name: true, settings: true } });
  // the person's picture, for the avatar in the side menu and the phone's top bar, and their own order of the menu
  // («ترتيبي», src/lib/nav/order.ts): read here so the very first paint already has the right order (no flash)
  const me = await db.user.findUnique({ where: { id: actor.userId }, select: { avatarUrl: true, navOrder: true } });
  const avatarUrl = me?.avatarUrl ?? null;
  // the two places the shell draws that are the owner's switches (a switched-off one is not drawn at all)
  const on = featuresOf(org?.settings);
  // the space the person is in, named at the top of every page (a space is like a separate site)
  const space = await currentSpace(actor);
  // «الإدارة» > «المساحة» is offered to whoever manages THIS space (a space role is not a capability: read here from
  // the database, never from the cookie; an external partner never does). The page decides again.
  const subject = navSubjectOf(actor, org?.settings, space, await hasActiveReports(actor));
  return (
    <>
      <EconomyMark on={economyOn(org?.settings)} />
      <AppShell
        // the shell draws a name, a username and an e-mail; session facts (tv, locale, onboarding
        // flags) are the server's business and never cross to the browser
        user={{ name: user.name, username: user.username, email: user.email, avatarUrl: avatarUrl }}
        rank={actor.role}
        isGuest={actor.isExternal}
        nav={buildNav(subject)}
        navOrder={readNavOrder(me?.navOrder)}
        newActions={actor.isExternal ? [] : newActionsFor(subject)}
        orgName={org?.name}
        space={space ? { id: space.id, name: space.name, emoji: space.emoji } : null}
        canOverview={actor.role === "OWNER" || actor.role === "ADMIN"}
        audience={audienceOf(actor)}
        defaultCollapsed={sidebarCollapsed}
        peopleDock={on.peopleDock}
        quickChat={on.quickChat}
      >
        {/* a call goes on while the person moves between pages; an incoming call rings on every page */}
        <CallProvider>
          {children}
          <CallRing />
        </CallProvider>
      </AppShell>
    </>
  );
}
