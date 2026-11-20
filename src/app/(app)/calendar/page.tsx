import { redirect } from "next/navigation";
import { actorCanWork } from "@/server/policy/actor";
import {
  queryTasksForView,
  resolveWorkspaceView,
} from "@/server/services/views";
import { calendarView, shiftMonth } from "@/server/services/calendar";
import { pageUser } from "@/server/auth";
import { monthName } from "@/lib/format";
import { CalendarGrid, type CalTask } from "@/components/calendar-grid";
import { getServerT } from "@/lib/i18n/server";
import { SectionOffNotice, pageActor } from "@/app/(app)/_access";
import { currentSpace } from "@/server/services/current-space";
import { actorFeatureOn } from "@/server/services/features";
import { legacyViewHref } from "@/lib/work/my-tasks";
import { CalendarFeedCard } from "@/components/calendar-feed/calendar-feed-card";

import Link from "next/link";
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { month?: string; workspace?: string; mine?: string; project?: string };
}) {
  const { t } = getServerT();
  // the space the person is in, never one named in the address (that is entered through the switcher)
  const { actor } = await pageActor();
  // the tasks row of the person's grid (a guest works in their shared spaces by the space's rules)
  if (!actorCanWork(actor, "tasks.view")) return <SectionOffNotice />;
  // W1.1 (switch `workMyTasks`): «التقويم» is a view of «مهامي» in the scope «المساحة»; the old address keeps working and lands there
  if (await actorFeatureOn(actor, "workMyTasks")) redirect(legacyViewHref("calendar", searchParams));
  const space = await currentSpace(actor);
  const view = await resolveWorkspaceView(space?.id ?? "");
  if ("pageRedirect" in view) redirect("/login");

  if ("none" in view) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <h1 className="text-base font-semibold text-fg">{t("cal.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("list.noWorkspace")}</p>
        </div>
      </div>
    );
  }

  const ctx = view.ctx;
  const user = await pageUser();
  if (!user) redirect("/login");

  // The company's month, today and window (Organization.timezone), cut in the service (tested with an
  // injected `now` in tests/calendar-clock.test.ts).
  const cal = calendarView({ now: new Date(), timeZone: ctx.timeZone, month: searchParams.month });
  const month = cal.month;
  const win = cal.win;
  const mine = searchParams.mine === "1";
  // «اشتراك التقويم»: the card is drawn for the company's staff while its switch is on (an external partner has no feed)
  const feedCard = !actor.isExternal && (await actorFeatureOn(actor, "calendarFeed"));

  const tasks = ctx.denied
    ? []
    : await queryTasksForView({
        orgId: ctx.orgId,
        workspaceId: ctx.workspaceId,
        visible: ctx.visible,
        projectId: searchParams.project || undefined,
        assigneeId: mine ? user.id : undefined,
        dueFrom: win.from,
        dueTo: win.to,
        openOnly: true,
        limit: 300,
      });

  const calTasks: CalTask[] = tasks
    .filter((task) => task.dueDate != null)
    .map((task) => ({
      id: task.id,
      key: task.key,
      title: task.title,
      dueDate: task.dueDate!.toISOString(),
    }));

  const shift = (delta: number): string => shiftMonth(month, delta);
  const monthTitle = `${monthName(Number(month.slice(5, 7)) - 1)} ${month.slice(0, 4)}`;
  const mineUrl = `/calendar?workspace=${ctx.workspaceId}&month=${month}${mine ? "" : "&mine=1"}`;

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-5 py-3">
        <div className="flex-1">
          <h1 className="text-base font-semibold text-fg">{t("cal.title")}</h1>
          <p className="text-xs text-fg-muted">{ctx.denied ? t("forbidden") : ctx.workspaceName}</p>
        </div>
        <Link
          href={mineUrl}
          aria-current={mine ? "true" : undefined}
          className="rounded-lg border border-border px-2.5 py-1 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg"
        >
          {t("cal.mineOnly")}
        </Link>
        <nav className="flex items-center gap-1" aria-label={t("cal.title")}>
          <Link href={`/calendar?workspace=${ctx.workspaceId}&month=${shift(-1)}${mine ? "&mine=1" : ""}`} className="rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label={t("cal.prev")}>
            ›
          </Link>
          <span className="min-w-32 px-2 text-center text-sm text-fg">{monthTitle}</span>
          <Link href={`/calendar?workspace=${ctx.workspaceId}&month=${shift(1)}${mine ? "&mine=1" : ""}`} className="rounded-lg border border-border px-2 py-1 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label={t("cal.next")}>
            ‹
          </Link>
        </nav>
      </header>

      <div className={`flex-1 px-3 py-3 ${feedCard ? "min-h-[32rem]" : "min-h-0"}`}>
        {ctx.denied ? (
          <p className="px-2 py-10 text-center text-sm text-muted">{t("forbidden")}</p>
        ) : (
          <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-surface">
            <CalendarGrid month={month} tasks={calTasks} todayIso={cal.todayIso} editable={ctx.editable} timeZone={ctx.timeZone} />
            {calTasks.length === 0 ? (
              <p className="px-2 pb-2 text-center text-xs text-muted">{t("cal.empty")}</p>
            ) : null}
          </div>
        )}
      </div>

      {feedCard ? (
        <div className="px-3 pb-3">
          <CalendarFeedCard timeZone={ctx.timeZone} />
        </div>
      ) : null}
    </div>
  );
}

export const dynamic = "force-dynamic";
