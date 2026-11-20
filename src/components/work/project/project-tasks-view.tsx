"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fmtNumber } from "@/lib/format";
import { enumLabel } from "@/lib/i18n/enums";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { WORK_STAGES } from "@/lib/work/stage";
import { MY_TASK_CHIPS, MY_TASK_GROUPS, MY_TASK_SORTS, type MyTaskChip, type MyTasksParams, type WorkTasksResult } from "@/lib/work/my-tasks";
import { TaskCalendar } from "@/components/work/my-tasks/task-calendar";
import { TaskList } from "@/components/work/my-tasks/task-list";
import { TaskPanel } from "@/components/work/my-tasks/task-panel";
import { useWorkActions, useWorkTasks } from "@/components/work/my-tasks/use-work-tasks";
import { Pill, WORK_SEARCH, WORK_SELECT } from "@/components/work/look";
import { TAB_VIEW, projectTasksHref, projectTasksParams } from "./tabs";

const SELECT = WORK_SELECT;

/**
 * «القائمة» and «التقويم» of a project (W1.5): W1.1's views with the scope fixed to this project. The rows, the calendar, the side panel, the optimistic
 * tick / due day and the data door are W1.1's (`GET /api/work/tasks?scope=project`, every row through `taskVisibleWhere`); what is this screen's is the
 * ADDRESS: it stays on the project page (`/projects/<id>?tab=list&chip=…`), never `/my-work`, and a chip or a sort changes it without a page load.
 * The scope and the project are not choices here, so the bar has none.
 */
export function ProjectTasksView({
  projectId,
  tab,
  requested,
  initial,
  initialQuery,
  initialAt,
}: {
  projectId: string;
  tab: keyof typeof TAB_VIEW;
  requested: MyTasksParams;
  initial: WorkTasksResult;
  initialQuery: string;
  initialAt: number;
}) {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const [params, setParams] = useState<MyTasksParams>(requested);
  const latest = useRef(params);
  latest.current = params;

  // the address changed under us (the back button): the screen follows it
  useEffect(() => {
    if (!searchParams) return;
    const next = projectTasksParams(searchParams, projectId, tab);
    if (projectTasksHref(projectId, tab, next) !== projectTasksHref(projectId, tab, latest.current)) setParams(next);
  }, [searchParams, projectId, tab]);

  const go = useCallback(
    (change: Partial<MyTasksParams>, mode: "push" | "replace" = "replace") => {
      const next: MyTasksParams = { ...latest.current, ...change, scope: "project", projectId, view: TAB_VIEW[tab] };
      setParams(next);
      window.history[mode === "push" ? "pushState" : "replaceState"](null, "", projectTasksHref(projectId, tab, next));
    },
    [projectId, tab],
  );

  const query = useWorkTasks(params, { data: initial, query: initialQuery, at: initialAt });
  const data = query.data;
  const actions = useWorkActions(data?.timeZone ?? initial.timeZone);

  if (!data) {
    return (
      <div className="px-4 py-10 text-center text-sm text-muted" role={query.isError ? "alert" : "status"} aria-busy={query.isPending}>
        {query.isError ? (
          <>
            {t("projpage.tasks.load_error")}{" "}
            <button type="button" className="underline" onClick={() => void query.refetch()}>
              {t("projpage.tasks.retry")}
            </button>
          </>
        ) : (
          t("common.loading")
        )}
      </div>
    );
  }

  const stale = query.isPlaceholderData;
  const rowActions = {
    onOpen: (id: string) => go({ taskId: id }, "push"),
    onToggle: (id: string, done: boolean) => actions.complete.mutate({ id, done }),
    onDue: (id: string, day: string | null) => actions.due.mutate({ id, day }),
  };
  const editableSomewhere = data.tasks.some((task) => task.editable);

  return (
    <div data-project-tasks={tab} className="min-w-0">
      <Bar tab={tab} params={params} data={data} onChange={go} />
      <div className={cn("py-3 transition-opacity", stale && "opacity-60")} aria-busy={stale}>
        {query.isError ? (
          <p role="alert" className="pb-3 text-center text-xs text-danger">
            {t("projpage.tasks.load_error")}{" "}
            <button type="button" className="underline" onClick={() => void query.refetch()}>
              {t("projpage.tasks.retry")}
            </button>
          </p>
        ) : null}

        {tab === "calendar" ? (
          data.month ? (
            <TaskCalendar
              tasks={data.tasks}
              month={data.month}
              todayIso={data.todayIso}
              timeZone={data.timeZone}
              editable={editableSomewhere}
              onMonth={(month) => go({ month })}
              onReschedule={(id, day) => actions.due.mutate({ id, day })}
              onOpen={rowActions.onOpen}
            />
          ) : (
            <p role="status" className="py-10 text-center text-sm text-muted">
              {t("common.loading")}
            </p>
          )
        ) : data.tasks.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-fg">{t("projpage.tasks.empty")}</p>
          </div>
        ) : (
          <TaskList tasks={data.tasks} group={params.group} todayIso={data.todayIso} timeZone={data.timeZone} showSpace={false} openId={params.taskId} actions={rowActions} />
        )}

        {data.truncated ? <p className="pt-3 text-center text-xs text-muted">{t("mytasks.truncated")}</p> : null}
      </div>

      <TaskPanel taskId={params.taskId} onClose={() => go({ taskId: null }, "push")} onToggle={rowActions.onToggle} onDue={rowActions.onDue} />
      <span className="sr-only" aria-live="polite">
        {t("mytasks.count", { n: fmtNumber(data.tasks.length) })}
      </span>
    </div>
  );
}

/** The bar of a project's list or calendar: the quick chips with their numbers, the stage, the sort, the grouping and the search (no scope, no project picker). */
function Bar({ tab, params, data, onChange }: { tab: keyof typeof TAB_VIEW; params: MyTasksParams; data: WorkTasksResult; onChange: (next: Partial<MyTasksParams>) => void }) {
  const { t } = useI18n();
  const calendar = tab === "calendar";
  return (
    <div className="space-y-2.5 py-1">
      <div className="flex flex-wrap items-center gap-2">
        {calendar ? null : (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("mytasks.chips.label")}>
            <Pill pressed={params.chip === null} onClick={() => onChange({ chip: null })}>
              {t("mytasks.chip.all")}
            </Pill>
            {MY_TASK_CHIPS.map((chip: MyTaskChip) => (
              <Pill key={chip} pressed={params.chip === chip} onClick={() => onChange({ chip: params.chip === chip ? null : chip })}>
                {t(`mytasks.chip.${chip}`)}
                <span className="tabular-nums opacity-70">{fmtNumber(data.counts[chip])}</span>
              </Pill>
            ))}
          </div>
        )}
        <form
          className="ms-auto flex items-center"
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem("q") as HTMLInputElement | null;
            onChange({ q: input?.value.trim() ?? "" });
          }}
        >
          <input
            key={params.q}
            name="q"
            type="search"
            defaultValue={params.q}
            aria-label={t("mytasks.search")}
            placeholder={t("mytasks.search")}
            className={WORK_SEARCH}
          />
        </form>
      </div>
      {calendar ? null : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <select aria-label={t("work.stage.label")} className={SELECT} value={params.stage ?? ""} onChange={(e) => onChange({ stage: (e.target.value || null) as MyTasksParams["stage"] })}>
            <option value="">{t("mytasks.stage.any")}</option>
            {WORK_STAGES.map((s) => (
              <option key={s} value={s}>
                {enumLabel("WorkStage", s)}
              </option>
            ))}
          </select>
          <select aria-label={t("mytasks.sort.label")} className={SELECT} value={params.sort} onChange={(e) => onChange({ sort: e.target.value as MyTasksParams["sort"] })}>
            {MY_TASK_SORTS.map((s) => (
              <option key={s} value={s}>
                {`${t("mytasks.sort.label")}: ${t(`mytasks.sort.${s}`)}`}
              </option>
            ))}
          </select>
          <select aria-label={t("mytasks.group.label")} className={SELECT} value={params.group} onChange={(e) => onChange({ group: e.target.value as MyTasksParams["group"] })}>
            {MY_TASK_GROUPS.filter((g) => g !== "project").map((g) => (
              <option key={g} value={g}>
                {g === "none" ? t("mytasks.group.none") : `${t("mytasks.group.label")}: ${t(`mytasks.group.${g}`)}`}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
