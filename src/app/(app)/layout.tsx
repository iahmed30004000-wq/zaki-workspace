import { pageActor } from "@/app/(app)/_access";
import { AppShell } from "@/components/app-shell";
import { audienceOf } from "@/lib/guide/audience";
import { buildNav } from "@/lib/nav/places";
import { newActionsFor } from "@/lib/nav/new-actions";
import { economyOn, featuresOf } from "@/lib/features";
import { menuOrderFor, readCompanyMenuOrder, readNavOrder } from "@/lib/nav/order";
import { holdsNoWork } from "@/lib/nav/shell-v2";
import { db } from "@/server/db";
import { orgSummaryOf } from "@/server/services/features";
import { cookies } from "next/headers";
import { parseSidebarCookie, SIDEBAR_COOKIE } from "@/components/shell/sidebar-cookie";
import { currentSpace, spacesOf } from "@/server/services/current-space";
import { hasActiveReports, navSubjectOf, oneDoorPanelFor } from "@/server/services/nav-order";
import { CallRing } from "@/components/calls/call-ring";
import { ChatSoundsHost } from "@/components/chat/chime/chat-sounds-host";
import { CallProvider } from "@/components/calls/call-provider";
import { SWITCH_COOKIE } from "@/lib/themes/switch-fx";

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
  // Everything below depends on the person only, so it is read TOGETHER (one round trip, not five): with the person and
  // the membership above that is three round trips for the whole frame (F1.1). Each reader is shared with the page.
  const [org, me, space, supervisor, spaces] = await Promise.all([
    // the company's name under the wordmark, and its switched-off features («الميزات»: their places are not drawn)
    orgSummaryOf(actor.orgId),
    // the person's picture, for the avatar in the side menu and the phone's top bar, and their own order of the menu
    // («ترتيبي», src/lib/nav/order.ts): read here so the very first paint already has the right order (no flash)
    db.user.findUnique({ where: { id: actor.userId }, select: { avatarUrl: true, navOrder: true } }),
    // the space the person is in, named at the top of every page (a space is like a separate site)
    currentSpace(actor),
    // «الإدارة» > «المساحة» is offered to whoever manages THIS space (a space role is not a capability: read here from
    // the database, never from the cookie; an external partner never does). The page decides again.
    hasActiveReports(actor),
    // the person's spaces (shared with `currentSpace`: one read): «الشركة» keeps no projects, so only-there means no work space (D-N3)
    spacesOf(actor),
  ]);
  const avatarUrl = me?.avatarUrl ?? null;
  // the two places the shell draws that are the owner's switches (a switched-off one is not drawn at all)
  const on = featuresOf(org?.settings);
  // S3.1: with «الإعدادات» as ONE door an admin who holds the control panel has no place «الإدارة» (one more read, only while the switch is on and for ADMIN and above)
  const subject = navSubjectOf(actor, org?.settings, space, supervisor, await oneDoorPanelFor(actor, org?.settings));
  // N1.2 — the new map is wired: `navSubjectOf` hands the switch to `buildNav`, and the shell draws the rail and the drawer when it is on
  const navV2 = subject.navV2 === true;
  // D-N5: the company's order wins while it is set (the person's own is only read, never written: `User.navOrder` stays stored)
  const ownOrder = readNavOrder(me?.navOrder);
  const menu = menuOrderFor(readCompanyMenuOrder(org?.settings), ownOrder);
  return (
    <AppShell
      // the shell draws a name, a username and an e-mail; session facts (tv, locale, onboarding
      // flags) are the server's business and never cross to the browser
      user={{ name: user.name, username: user.username, email: user.email, avatarUrl: avatarUrl }}
      rank={actor.role}
      isGuest={actor.isExternal}
      nav={buildNav(subject)}
      navV2={navV2}
      settingsOneDoor={subject.settingsOneDoor === true}
      navOrder={navV2 ? menu.order : ownOrder}
      orderLocked={navV2 && menu.personalLocked}
      noWorkSpace={navV2 && !actor.isExternal && holdsNoWork(spaces.map((s) => ({ holdsProjects: s.kind !== "HQ" })))}
      newActions={actor.isExternal ? [] : newActionsFor(subject)}
      // the new chat screen takes over the chat page on a computer: no global bar there, its tools live in the rail
      chatBare={navV2 && on.chatLayoutV2}
      orgName={org?.name}
      space={space ? { id: space.id, name: space.name, emoji: space.emoji } : null}
      canOverview={actor.role === "OWNER" || actor.role === "ADMIN"}
      audience={audienceOf(actor)}
      defaultCollapsed={sidebarCollapsed}
      peopleDock={on.peopleDock}
      quickChat={on.quickChat}
      // «شريط تيليجرام السفلي»: a phone's bottom bar is Telegram's four tabs (the company's switch `tgTabBar`, off by default; never for an external partner)
      tgTabBar={on.tgTabBar && !actor.isExternal}
      siteGuide={on.siteGuide && on.ownerAssistant && actor.isOwner}
      economy={economyOn(org?.settings)}
      // «مظهر المفتاح»: the person's look of the light/dark switch (the `zk-switch` cookie, so the very first paint already has the right tint);
      // the company's `themeSwitchFx` switch decides whether any of it is drawn (off: the plain switch only, no effect code, no tint)
      themeSwitch={cookies().get(SWITCH_COOKIE)?.value}
      themeSwitchFx={on.themeSwitchFx}
    >
      {/* a call goes on while the person moves between pages; an incoming call rings on every page */}
      <CallProvider>
        {children}
        <CallRing />
        {/* S5.1: a tone for a message in any conversation the person reads (the company's switch `chatSounds`, off: nothing is mounted) */}
        <ChatSoundsHost enabled={on.chatSounds} />
      </CallProvider>
    </AppShell>
  );
}
