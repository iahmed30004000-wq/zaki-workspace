"use client";

import { useI18n } from "@/lib/i18n";
import { fmtNumber } from "@/lib/format";
import { groupWorkTasks, type GroupWords, type MyTaskGroup, type WorkGroup, type WorkTaskDto } from "@/lib/work/my-tasks";
import { GROUP_HEADING, WORK_LIST } from "@/components/work/look";
import { WorkRow } from "./work-row";

/** The words a grouped list and a board need (stage names, due buckets, «ما حدا»), from the strings. */
export function useGroupWords(): GroupWords {
  const { t } = useI18n();
  return {
    stage: (stage) => t(`enum.WorkStage.${stage}`),
    due: (bucket) => t(`mytasks.due.${bucket}`),
    nobody: t("list.unassigned"),
    all: t("mytasks.group.all"),
  };
}

export interface RowActions {
  onOpen: (id: string) => void;
  onToggle: (id: string, done: boolean) => void;
  onDue: (id: string, day: string | null) => void;
}

/**
 * The list view: the groups the person chose (none, stage, project, person, due day), each a heading with its count («متأخرة · 1») over ONE rounded white card of
 * thin-divided rows (the Telegram-like look: a group is a card, a task is a line in it). The row says where a task lives; the group already says one of those things, so the row leaves it out.
 */
export function TaskList({
  tasks,
  group,
  todayIso,
  timeZone,
  showSpace,
  openId,
  actions,
}: {
  tasks: readonly WorkTaskDto[];
  group: MyTaskGroup;
  todayIso: string;
  timeZone: string;
  showSpace: boolean;
  openId: string | null;
  actions: RowActions;
}) {
  const { t } = useI18n();
  const words = useGroupWords();
  const groups: WorkGroup[] = groupWorkTasks(tasks, group, words, { todayIso, timeZone });
  return (
    <div aria-label={t("mytasks.list.aria")}>
      {groups.map((g) => (
        <section key={g.key} aria-label={g.label}>
          {group === "none" ? null : (
            <h2 className={GROUP_HEADING}>
              {g.label}
              <span aria-hidden="true">·</span>
              <span className="font-bold tabular-nums">{fmtNumber(g.tasks.length)}</span>
            </h2>
          )}
          <div role="list" className={WORK_LIST}>
            {g.tasks.map((task) => (
              <WorkRow
                key={task.id}
                task={task}
                showSpace={showSpace}
                showProject={group !== "project"}
                showStage={group !== "stage"}
                selected={task.id === openId}
                todayIso={todayIso}
                {...actions}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
