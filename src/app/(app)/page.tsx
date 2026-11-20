import { redirect } from "next/navigation";
import { pageActor } from "@/app/(app)/_access";
import { FirstStepsCard } from "@/components/guide/first-steps-card";
import { GuideCard } from "@/components/guide/guide-card";
import { InstallHint } from "@/components/pwa/install-hint";
import { ActiveProjects } from "@/components/today/active-projects";
import { TeamPulse } from "@/components/today/team-pulse";
import { TodayDashboard } from "@/components/today/today-dashboard";
import { TodayHero } from "@/components/today/today-hero";
import { TodayTasksCard } from "@/components/today/today-tasks";
import { getServerT } from "@/lib/i18n/server";
import { NotFoundError } from "@/server/auth";
import { getToday } from "@/server/services/today";
import { getTodayDashboard } from "@/server/services/today-dashboard";
import { currentSpace } from "@/server/services/current-space";
import { missionOf } from "@/lib/today";
import { opensOnCards } from "@/lib/cards/shared";
import { cardsHomeHref } from "@/lib/nav/new-actions";
import { actorFeatureOn } from "@/server/services/features";
import { landsOnChat } from "@/server/services/landing";
import { MyRemindersCard } from "@/components/reminders/my-reminders-card";
import { PinnedStrip } from "@/components/rewards/pinned-strip";
import { pinnedTasks } from "@/server/services/pinned";
import { rewardLensFor } from "@/server/services/rewards";
import { MyTimeToday } from "@/components/time/my-time-today";
import { MyCheckinCard } from "@/components/checkins/my-checkin-card";
import { DigestCard } from "@/components/digest/digest-card";
import { digestOffered } from "@/server/services/digest";
import { ControlPanelHome } from "@/components/control-panel/panel";
import { ZakiAiChip } from "@/components/control-panel/zaki-ai";
import { controlPanelAccess, loadPanelHome, type PanelHome } from "@/server/services/control-panel";
import { TodayWaitingCard } from "@/components/today/waiting-card";
import { TodayMentionsCard } from "@/components/today/mentions-card";
import { TodayFollowUps } from "@/components/today/follow-ups";
import { TodayTeamCard } from "@/components/today/team-card";
import { TodayMore } from "@/components/today/more";
import { getTodayFollowUps, getTodayMentions, getTodayWaiting } from "@/server/services/today-dashboard";
import { teamCardOf, teamScopeOf, todayLayout, type TodayCardKey } from "@/lib/today";
import type { Actor } from "@/server/policy/actor";
import type { CurrentSpace } from "@/server/services/current-space";
import type { ReactNode } from "react";

/** The browser tab says «اليوم» (the root layout adds the app name). */
export const metadata = { title: getServerT().t("today.title") };

/**
 * «اليوم» — the calm home of the system. It answers one question: what do I do today, and where do I stand?
 * (The old home was eighteen cards that were links to the rest; the shell now carries the five places.)
 *
 * The page decides nothing. WHO the person is comes from `pageActor()` (which also sends somebody who has not
 * finished onboarding, or whose account is no longer active, away before anything is read); WHAT they see comes
 * from one service call, `getToday(actor)`, which scopes everything to the spaces they can open and to their own
 * work; the smart cards (the week's ring, late, due today, unread chat, the team strip) come from a second,
 * `getTodayDashboard(actor)`, scoped the same way. The parts are in src/components/today; the first-steps card and the install hint are the guide's and
 * the app shell's and draw nothing when they have nothing to say.
 *
 * «نجمة وطريق»: the mission card first («المهمّة الجاية», the page's one heading), the first steps as a road,
 * then the day's tasks with the inline quick add at their foot; beside them the guide's welcome («يلا»), the
 * pulse and the projects.
 *
 * Mobile first: one column with 16px gutters; from `lg` the side column sits beside the tasks.
 *
 * N1.8 — the landing page (D-N1, awaiting the owner): while the company's switch `navV2` is ON and its setting `landing` is «الدردشة» (the default),
 * «/» alone sends the person to the chat; the menu's «اليوم» is «/?view=today», which is this page. With `navV2` OFF (as merged) nothing changes:
 * «/» is «اليوم» for everybody. The manifest's `start_url` is M1a's, not read here.
 *
 * W1.7 — the same switch `navV2` also decides the SHAPE of this page: ON, `simpleToday` below draws up to six cards and ONE team card; OFF,
 * everything under it is the page as it was (tests/db/today-page.test.ts holds both).
 */
export default async function TodayPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { t } = getServerT();
  const { actor } = await pageActor();
  // the space the person is in: its «اليوم» only (entering a space opens here)
  const space = await currentSpace(actor);
  // a space of «لوحات» opens on its cards (decided here, on the server; the sidebar is not touched); «جديد → مهمة» (`?new=task`) keeps its intent on the way (W1.8)
  if (opensOnCards(space?.layout)) redirect(cardsHomeHref(searchParams));
  // the company's landing page: «/» alone follows it, «/?view=today» is always «اليوم»
  const view = searchParams?.["view"];
  if ((Array.isArray(view) ? view[0] : view) !== "today") {
    if (await landsOnChat(actor)) redirect("/chat");
  }
  // W1.7: with «التنقل الجديد» on, «اليوم» is up to six cards and one team card; with it off nothing below changes
  if (await actorFeatureOn(actor, "navV2")) return simpleToday(actor, space);
  const [data, dashboard] = await Promise.all([
    getToday(actor, { spaceId: space?.id ?? null }),
    // the smart cards: numbers over the same space, from their own service call (a guest gets none)
    getTodayDashboard(actor, { space: space ? { id: space.id, kind: space.kind } : null }),
  ]);

  // «تذكيراتي»: a compact card of the person's own reminders, only while the company's «ذكّرني» switch is on
  const remindersOn = await actorFeatureOn(actor, "reminders");
  // «وقتي اليوم»: a compact line of the person's own time, only while the company's «حساب الوقت» switch is on and never for a partner
  const timeOn = !actor.isExternal && (await actorFeatureOn(actor, "timeTracking"));

  // «تسجيلك اليومي»: one compact line, only while the company's «التسجيل اليومي» switch is on and never for a partner
  const checkinsOn = !actor.isExternal && (await actorFeatureOn(actor, "checkins"));

  // «مثبّتة»: a compact card of the tasks pinned in this space (draws nothing when none, or when the switch is off)
  const pinned = await pinnedTasks(actor, { spaceId: space?.id ?? null }, await rewardLensFor(actor, space?.id ?? null));

  // «لوحة التحكم»: the owner's own panel on the home screen (the OWNER rank alone, while its switch and the board's are on)
  const panel = await panelFor(actor);

  // «شو فاتني؟»: the catch-up card, only while its switch, «مساعد المالك», «قراءة الدردشات للمساعد» and a ready provider are on, and never for a partner (the text is fetched by the card after the page is drawn)
  const digestOn = !actor.isExternal && (await digestOffered(actor.orgId));

  const name = data.greeting.firstName;
  const greeting = data.greeting.period === "morning" ? t("today.greeting.morning", { name }) : t("today.greeting.evening", { name });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 md:px-6 md:py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <TodayHero greeting={greeting} date={data.dateLabel} mission={missionOf(data.tasks)} />
          {panel ? <ControlPanelHome t={t} view={panel} aiChip={<ZakiAiChip />} /> : null}
          {digestOn ? <DigestCard /> : null}
          <FirstStepsCard actor={actor} />
          <TodayDashboard data={dashboard} />
          <TodayTasksCard tasks={data.tasks} hasSpaces={data.hasSpaces} canCreateSpaces={data.canCreateSpaces} quickAdd={data.quickAdd} timeZone={data.timeZone} />
          <InstallHint />
        </div>
        <div className="flex min-w-0 flex-col gap-4 lg:w-80 lg:shrink-0">
          <GuideCard />
          <PinnedStrip tasks={pinned} variant="card" />
          {remindersOn ? <MyRemindersCard /> : null}
          {timeOn ? <MyTimeToday /> : null}
          {checkinsOn ? <MyCheckinCard /> : null}
          {data.pulse ? <TeamPulse pulse={data.pulse} /> : null}
          <ActiveProjects projects={data.projects} isExternal={data.isExternal} />
        </div>
      </div>
    </div>
  );
}

/**
 * W1.7 — «اليوم» with the switch `navV2` ON: up to SIX cards, in this order (`todayLayout` in src/lib/today.ts decides which of them exist):
 * «مهامي اليوم» (with the quick add at its foot) · «بانتظار قرارك» · «ذكروك» · «تذكيراتي» (with «مواعيد اليوم») · «التسجيل اليومي» · ONE team card.
 * What left the main column is under «المزيد» (the personal numbers, the digest, the day's time, the pinned tasks, the projects) or was folded into the
 * one team card (the old pulse and the dashboard's team strip); the owner's whole panel is «لوحة التحكم» at /owner, which the team card links to.
 * The hero (the «اليوم» strip, themed decoration, calm in the flat themes), the first steps, the guide's welcome and the install hint are the
 * guide's strips: they draw nothing when they have nothing to say and are not counted as cards. Every number comes from the same services as
 * before (`getToday`, `getTodayDashboard`, the inbox of W1.4, the chat list, the pinned query); no new door.
 */
async function simpleToday(actor: Actor, space: CurrentSpace | null) {
  const { t } = getServerT();
  const spaceRef = space ? { id: space.id, kind: space.kind } : null;
  const [data, dashboard, waiting, mentions, followUps, remindersOn, timeOn, checkinsOn, digestOn, pinned, panelHref] = await Promise.all([
    getToday(actor, { spaceId: space?.id ?? null }),
    getTodayDashboard(actor, { space: spaceRef }),
    getTodayWaiting(actor),
    getTodayMentions(actor, { space: spaceRef }),
    getTodayFollowUps(actor),
    actorFeatureOn(actor, "reminders"),
    !actor.isExternal && actorFeatureOn(actor, "timeTracking"),
    !actor.isExternal && actorFeatureOn(actor, "checkins"),
    !actor.isExternal && digestOffered(actor.orgId),
    rewardLensFor(actor, space?.id ?? null).then((lens) => pinnedTasks(actor, { spaceId: space?.id ?? null }, lens)),
    panelHrefFor(actor),
  ]);

  const team = teamCardOf(dashboard?.team ?? null, data.pulse, teamScopeOf({ isOwner: actor.isOwner, spaceName: space?.name ?? null }));
  const layout = todayLayout({
    external: actor.isExternal,
    waiting: waiting?.total ?? 0,
    mentions: mentions?.total ?? 0,
    remindersOn,
    followUps: followUps.length,
    checkinsOn,
    team: team !== null,
    digestOn,
    timeOn,
    pinned: pinned.length,
    projects: data.projects.length,
    glance: dashboard !== null,
  });

  const name = data.greeting.firstName;
  const greeting = data.greeting.period === "morning" ? t("today.greeting.morning", { name }) : t("today.greeting.evening", { name });

  const slots: Record<TodayCardKey, ReactNode> = {
    tasks: <TodayTasksCard tasks={data.tasks} hasSpaces={data.hasSpaces} canCreateSpaces={data.canCreateSpaces} quickAdd={data.quickAdd} timeZone={data.timeZone} />,
    waiting: waiting ? <TodayWaitingCard waiting={waiting} /> : null,
    mentions: mentions ? <TodayMentionsCard mentions={mentions} /> : null,
    reminders: (
      <>
        {remindersOn ? <MyRemindersCard /> : null}
        {followUps.length > 0 ? <TodayFollowUps items={followUps} /> : null}
      </>
    ),
    checkin: <MyCheckinCard />,
    team: team ? <TodayTeamCard team={team} panelHref={panelHref} /> : null,
  };
  const moreParts: Record<(typeof layout.more)[number], ReactNode> = {
    glance: dashboard ? <TodayDashboard data={{ ...dashboard, team: null }} /> : null,
    digest: <DigestCard />,
    time: <MyTimeToday />,
    pinned: <PinnedStrip tasks={pinned} variant="card" />,
    projects: <ActiveProjects projects={data.projects} isExternal={data.isExternal} />,
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-4 md:px-6 md:py-6">
      <div className="flex min-w-0 flex-col gap-4">
        <TodayHero greeting={greeting} date={data.dateLabel} mission={missionOf(data.tasks)} />
        <GuideCard />
        <FirstStepsCard actor={actor} />
        {layout.cards.map((key) => (
          <div key={key} data-today-card={key} className="min-w-0 empty:hidden">
            {slots[key]}
          </div>
        ))}
        {layout.more.length > 0 ? <TodayMore>{layout.more.map((key) => <div key={key} data-today-more-part={key} className="min-w-0 empty:hidden">{moreParts[key]}</div>)}</TodayMore> : null}
        <InstallHint />
      </div>
    </div>
  );
}

/** «لوحة التحكم»'s address for the owner while its switch is on (the old home drew the whole panel; the simplified one links to it); null for everybody else. */
async function panelHrefFor(actor: Actor): Promise<string | null> {
  if (!actor.isOwner || actor.isExternal) return null;
  try {
    await controlPanelAccess(actor);
    return "/owner";
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

/** The panel's numbers for the owner; null for everybody else, and for the owner while a switch is off (the page is then exactly as it was). */
async function panelFor(actor: Awaited<ReturnType<typeof pageActor>>["actor"]): Promise<PanelHome | null> {
  if (!actor.isOwner || actor.isExternal) return null;
  try {
    return await loadPanelHome(await controlPanelAccess(actor));
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

export const dynamic = "force-dynamic";
