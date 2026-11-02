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
import { actorFeatureOn } from "@/server/services/features";
import { MyRemindersCard } from "@/components/reminders/my-reminders-card";
import { PinnedStrip } from "@/components/rewards/pinned-strip";
import { pinnedTasks } from "@/server/services/pinned";
import { rewardLensFor } from "@/server/services/rewards";
import { MyTimeToday } from "@/components/time/my-time-today";
import { MyCheckinCard } from "@/components/checkins/my-checkin-card";
import { ControlPanelHome } from "@/components/control-panel/panel";
import { ZakiAiChip } from "@/components/control-panel/zaki-ai";
import { controlPanelAccess, loadPanelHome, type PanelHome } from "@/server/services/control-panel";

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
 */
export default async function TodayPage() {
  const { t } = getServerT();
  const { actor } = await pageActor();
  // the space the person is in: its «اليوم» only (entering a space opens here)
  const space = await currentSpace(actor);
  // a space of «لوحات» opens on its cards (decided here, on the server; the sidebar is not touched)
  if (opensOnCards(space?.layout)) redirect("/cards");
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

  const name = data.greeting.firstName;
  const greeting = data.greeting.period === "morning" ? t("today.greeting.morning", { name }) : t("today.greeting.evening", { name });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 md:px-6 md:py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <TodayHero greeting={greeting} date={data.dateLabel} mission={missionOf(data.tasks)} />
          {panel ? <ControlPanelHome t={t} view={panel} aiChip={<ZakiAiChip />} /> : null}
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
