"use client";

import { apiPut } from "@/lib/api-client";
import { savedFiltersOf, touchesFilters } from "@/lib/work/saved-filters";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fmtNumber } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { myTasksHref, myTasksSearch, parseMyTasksParams, type MyTasksParams, type WorkTasksResult } from "@/lib/work/my-tasks";
import { QuickAdd } from "./quick-add";
import { TaskBoard } from "./task-board";
import { TaskCalendar } from "./task-calendar";
import { TaskList } from "./task-list";
import { TaskPanel } from "./task-panel";
import { Toolbar } from "./toolbar";
import { useWorkActions, useWorkTasks } from "./use-work-tasks";

/**
 * «مهامي» (W1.1, switch `workMyTasks`) — the ONE screen of a person's tasks: three views (قائمة · لوحة · تقويم), three scopes (أنا · المساحة · مشروع), the quick
 * chips, a sort and a grouping, with the task opening in a side panel. The server draws the first answer for the address (the page); after that the screen is
 * TanStack Query: a click on a chip or a view changes the address WITHOUT a page load (`history`) and fetches the next answer while the last one stays on screen;
 * ticking a task, moving it to a stage and changing its day change the cache at once and are put back when the door refuses (use-work-tasks.ts).
 */
export function MyTasksView({
  requested,
  initial,
  initialQuery,
  initialAt,
  staleHref = null,
}: {
  requested: MyTasksParams;
  initial: WorkTasksResult;
  initialQuery: string;
  initialAt: number;
  /** W1.9: the review list of old tasks, for somebody who manages a space (the page decides; null draws nothing). */
  staleHref?: string | null;
}) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [params, setParams] = useState<MyTasksParams>(requested);
  const latest = useRef(params);
  latest.current = params;

  // the address changed under us (the menu's «مهامي» link, the back button): the screen follows it
  useEffect(() => {
    if (!searchParams) return;
    const next = parseMyTasksParams(searchParams);
    if (myTasksSearch(next) !== myTasksSearch(latest.current)) setParams(next);
  }, [searchParams]);

  const go = useCallback((change: Partial<MyTasksParams>, mode: "push" | "replace" = "push") => {
    const next: MyTasksParams = { ...latest.current, ...change };
    setParams(next);
    window.history[mode === "push" ? "pushState" : "replaceState"](null, "", myTasksHref(next));
    // the person's filters are kept for their next visit; a failure only means they are not (the list on screen is right either way)
    if (touchesFilters(change)) void apiPut("/api/me/task-filters", savedFiltersOf(next)).catch(() => undefined);
  }, []);

  const query = useWorkTasks(params, { data: initial, query: initialQuery, at: initialAt });
  const data = query.data;
  const actions = useWorkActions(data?.timeZone ?? initial.timeZone);

  if (!data) {
    return (
      <div className="flex h-full min-w-0 flex-col" aria-busy={query.isPending}>
        <Header />
        <div className="px-4 py-10 text-center text-sm text-muted" role={query.isError ? "alert" : "status"}>
          {query.isError ? (
            <>
              {t("mytasks.error.load")}{" "}
              <button type="button" className="underline" onClick={() => void query.refetch()}>
                {t("mytasks.error.retry")}
              </button>
            </>
          ) : (
            t("common.loading")
          )}
        </div>
      </div>
    );
  }

  const stale = query.isPlaceholderData;
  // the space's name sits on a row only when the list crosses spaces (all my spaces / «الشركة»): inside one space the title already says which
  const showSpace = data.spaces.length > 1 && data.space.id === null;
  const rowActions = {
    onOpen: (id: string) => go({ taskId: id }),
    onToggle: (id: string, done: boolean) => actions.complete.mutate({ id, done }),
    onDue: (id: string, day: string | null) => actions.due.mutate({ id, day }),
  };
  const editableSomewhere = data.tasks.some((task) => task.editable);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-y-auto">
      <Header count={data.tasks.length} spaceName={data.space.name} />
      <div className="mx-auto w-full max-w-6xl px-4 md:px-5">
        <Toolbar params={params} data={data} onChange={go} staleHref={staleHref} />
        {data.canAdd ? <QuickAdd onAdd={(title) => actions.add.mutateAsync({ title, spaceId: data.space.id })} pending={actions.add.isPending} /> : null}
      </div>

      <div className={cn("mx-auto w-full max-w-6xl flex-1 px-4 pb-7 pt-1 transition-opacity md:px-5", stale && "opacity-60")} aria-busy={stale}>
        {query.isError ? (
          <p role="alert" className="px-2 pb-3 text-center text-xs text-danger">
            {t("mytasks.error.load")}{" "}
            <button type="button" className="underline" onClick={() => void query.refetch()}>
              {t("mytasks.error.retry")}
            </button>
          </p>
        ) : null}

        {params.view === "calendar" && !data.month ? (
          <p role="status" className="px-2 py-10 text-center text-sm text-muted">
            {t("common.loading")}
          </p>
        ) : params.view === "calendar" && data.month ? (
          <TaskCalendar
            tasks={data.tasks}
            month={data.month}
            todayIso={data.todayIso}
            timeZone={data.timeZone}
            editable={editableSomewhere}
            onMonth={(month) => go({ month }, "replace")}
            onReschedule={(id, day) => actions.due.mutate({ id, day })}
            onOpen={rowActions.onOpen}
          />
        ) : data.params.scope === "project" && !data.params.projectId ? (
          <p className="px-2 py-10 text-center text-sm text-muted">{t("mytasks.project.hint")}</p>
        ) : params.view === "board" ? (
          <TaskBoard
            tasks={data.tasks}
            todayIso={data.todayIso}
            timeZone={data.timeZone}
            showSpace={showSpace}
            openId={params.taskId}
            actions={rowActions}
            onMove={(id, to) => actions.stage.mutate({ id, to })}
          />
        ) : data.tasks.length === 0 ? (
          <div className="px-4 py-14 text-center text-fg-muted">
            <p className="text-[15px]">{t("mytasks.empty.title")}</p>
            <p className="mt-1 text-[13px] text-muted">{t("mytasks.empty.hint")}</p>
          </div>
        ) : (
          <TaskList tasks={data.tasks} group={params.group} todayIso={data.todayIso} timeZone={data.timeZone} showSpace={showSpace} openId={params.taskId} actions={rowActions} />
        )}

        {data.truncated ? <p className="px-2 pt-3 text-center text-xs text-muted">{t("mytasks.truncated")}</p> : null}
      </div>

      <TaskPanel taskId={params.taskId} todayIso={data.todayIso} onClose={() => go({ taskId: null })} onToggle={rowActions.onToggle} onDue={rowActions.onDue} />
      <span className="sr-only" aria-live="polite">
        {t("mytasks.count", { n: fmtNumber(data.tasks.length) })}
      </span>
    </div>
  );

}

function Header({ count, spaceName = null }: { count?: number; spaceName?: string | null }) {
  const { t } = useI18n();
  // each space is its own account: the line says WHICH space these tasks are of (or that they are of all of them)
  const line = spaceName ? t("mytasks.subtitle.space", { name: spaceName }) : t("mytasks.subtitle");
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 pb-1 pt-4 md:px-5">
      <div className="min-w-0 flex-1">
        <h1 className="text-[19px] font-bold leading-tight text-fg">{t("mywork.title")}</h1>
        <p className="text-[13px] text-fg-muted">{count === undefined ? line : `${line} · ${t("mytasks.count", { n: fmtNumber(count) })}`}</p>
      </div>
    </header>
  );
}
