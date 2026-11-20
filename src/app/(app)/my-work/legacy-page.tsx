import { SectionOffNotice, pageActor } from "@/app/(app)/_access";
import { actorCanWork } from "@/server/policy/actor";
import { currentSpace } from "@/server/services/current-space";
import { MY_WORK_TABS, getMyWork, myWorkTimeZone, type MyWorkTab } from "@/server/services/my-work";
import { myRunningTaskId } from "@/server/services/time-tracking";
import { TaskRow } from "@/components/task-row";
import { InstantWorkButton } from "@/components/instant-work";
import { getServerT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

import Link from "next/link";
const TAB_KEYS: Record<MyWorkTab, string> = {
  today: "mywork.tab.today",
  upcoming: "mywork.tab.upcoming",
  overdue: "mywork.tab.overdue",
  completed: "mywork.tab.completed",
  mine: "mywork.tab.mine",
  created: "mywork.tab.created",
};

/** Today's «مهامي» (six inner tabs, the current space): what `/my-work` serves while the switch `workMyTasks` is OFF (W1.1). */
export async function LegacyMyWorkPage({ searchParams }: { searchParams: { tab?: string } }) {
  const { t } = getServerT();
  const { user, actor } = await pageActor();
  // the tasks row of the person's grid (a guest works in their shared spaces by the space's rules)
  if (!actorCanWork(actor, "tasks.view")) return <SectionOffNotice />;

  const wanted = (searchParams.tab ?? "") as MyWorkTab;
  const tab: MyWorkTab = MY_WORK_TABS.includes(wanted) ? wanted : "today";

  // which tasks belong in each tab (and which workspaces they may come from) is
  // decided by the service; this page only renders the rows it returns
  // …of the space they are in
  const data = await getMyWork(user.id, new Date(), { spaceId: (await currentSpace(actor))?.id ?? null });
  const rows = data[tab];
  const timeZone = await myWorkTimeZone(user.id);
  // «الوقت شغّال» on the row of the task the person's own timer runs on
  const runningTaskId = await myRunningTaskId(actor);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto">
      <header className="flex items-center gap-3 border-b border-border bg-surface px-5 py-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold text-fg">{t("mywork.title")}</h1>
          <p className="text-xs text-fg-muted">{t("mywork.subtitle")}</p>
        </div>
        {/* «+ مهمة فورية» (draws nothing while its switch is off or the person may not add tasks) */}
        <InstantWorkButton kind="task" />
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-border bg-surface px-4" aria-label={t("mywork.title")}>
        {MY_WORK_TABS.map((k) => (
          <Link
            key={k}
            href={`/my-work?tab=${k}`}
            aria-current={k === tab ? "true" : undefined}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-xs transition-colors",
              k === tab
                ? "border-accent font-medium text-fg"
                : "border-transparent text-fg-muted hover:text-fg",
            )}
          >
            {t(TAB_KEYS[k])}
            <span className="rounded-full bg-surface-2 px-1.5 text-xs text-fg-muted">
              {data[k].length}
            </span>
          </Link>
        ))}
      </nav>

      <div className="flex-1 px-3 py-3">
        {rows.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted">{t("mywork.empty")}</p>
        ) : (
          <ul className="max-w-4xl divide-y divide-border/60">
            {rows.map(({ task, editable }) => (
              <TaskRow key={task.id} task={{ ...task, running: task.id === runningTaskId }} editable={editable} showProject timeZone={timeZone} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

