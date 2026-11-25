import type { Actor } from "@/server/policy/actor";
import { actorCanWork } from "@/server/policy/actor";
import { currentSpace } from "@/server/services/current-space";
import { actorFeatureOn } from "@/server/services/features";
import { getToday } from "@/server/services/today";
import { getTodayBySpace, getTodayDashboard, getTodayFollowUps, getTodayMentions, getTodayWaiting } from "@/server/services/today-dashboard";
import { pinnedTasks } from "@/server/services/pinned";
import { rewardLensFor } from "@/server/services/rewards";
import { missionOf } from "@/lib/today";
import { getMyWork, MY_WORK_TABS, type MyWorkTab } from "@/server/services/my-work";

/**
 * «اليوم» FOR THE PHONE (M2 N2): the very service calls the page makes (src/app/(app)/page.tsx, its newer shape `simpleToday`), for the
 * space the person is in — nothing computed twice, nothing the page would not show this person. Every part is scoped by the service that
 * makes it: `getToday` to the spaces they can open and their own work, the waiting box to what is theirs to answer, the mentions to their
 * own chat list, the pinned strip through their reward lens. A partner gets what the page gives a partner (no dashboard, no time, no
 * check-in). Read-only.
 */
export async function todayForApp(actor: Actor) {
  const space = await currentSpace(actor);
  const spaceRef = space ? { id: space.id, kind: space.kind } : null;
  // «الشركة» (the view over every space): the team numbers are the person's people over all of them, and the tasks card is the per-space summary
  const inHq = space?.kind === "HQ";
  const [today, dashboard, waiting, mentions, followUps, remindersOn, timeOn, checkinsOn, pinned, bySpace] = await Promise.all([
    getToday(actor, { spaceId: space?.id ?? null, teamWide: inHq }),
    getTodayDashboard(actor, { space: spaceRef, teamWide: inHq }),
    getTodayWaiting(actor, { space: spaceRef }),
    getTodayMentions(actor, { space: spaceRef }),
    getTodayFollowUps(actor),
    actorFeatureOn(actor, "reminders"),
    actorFeatureOn(actor, "timeTracking").then((on) => on && !actor.isExternal),
    actorFeatureOn(actor, "checkins").then((on) => on && !actor.isExternal),
    rewardLensFor(actor, space?.id ?? null).then((lens) => pinnedTasks(actor, { spaceId: space?.id ?? null }, lens)),
    inHq ? getTodayBySpace(actor) : Promise.resolve(null),
  ]);
  return {
    space: space ? { id: space.id, name: space.name, kind: space.kind } : null,
    today,
    mission: missionOf(today.tasks),
    dashboard,
    waiting,
    mentions,
    followUps,
    pinned,
    bySpace,
    cards: { reminders: remindersOn, time: timeOn, checkins: checkinsOn },
  };
}

/**
 * «مهامي» FOR THE PHONE: the page's own `getMyWork` (the six tabs, in the space the person is in) — the same rows the legacy page draws
 * while the switch `workMyTasks` is off, and the same tasks the new list shows when it is on. Each tab's count comes with it so the
 * phone draws the six chips without six calls. `null`: the tasks row of the person's grid is closed.
 */
export async function myWorkForApp(actor: Actor, wanted: string | null) {
  if (!actorCanWork(actor, "tasks.view")) return null;
  const tab: MyWorkTab = MY_WORK_TABS.includes(wanted as MyWorkTab) ? (wanted as MyWorkTab) : "today";
  const space = await currentSpace(actor);
  const data = await getMyWork(actor.userId, new Date(), { spaceId: space?.id ?? null });
  const counts = Object.fromEntries(MY_WORK_TABS.map((t) => [t, data[t].length])) as Record<MyWorkTab, number>;
  return {
    tab,
    space: space ? { id: space.id, name: space.name } : null,
    counts,
    rows: data[tab].map(({ task, editable }) => ({
      editable,
      task: {
        id: task.id,
        key: task.key,
        title: task.title,
        priority: task.priority,
        dueDate: task.dueDate?.toISOString() ?? null,
        completedAt: task.completedAt?.toISOString() ?? null,
        columnId: task.columnId,
        columnName: task.columnName,
        columnDone: task.columnDone,
        columnStage: task.columnStage,
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        projectName: task.projectName,
        assigneeIds: task.assigneeIds,
        assigneeNames: task.assigneeNames,
        visibility: task.visibility,
        pinned: task.pinnedAt != null,
      },
    })),
  };
}
