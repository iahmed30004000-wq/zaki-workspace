"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api-client";
import { dueInstantForDay } from "@/lib/due-day";
import { FIELDS_ANCHOR, requiredFieldsOf } from "@/lib/custom-fields";
import { useI18n } from "@/lib/i18n";
import { rt } from "@/lib/reminders/client";
import { useToast } from "@/components/ui/toast";
import type { WorkStage } from "@/lib/work/stage";
import {
  WORK_TASKS_ROOT,
  myTasksApiQuery,
  stillListed,
  withCompletion,
  withDueDay,
  withStage,
  workTasksKey,
  type MyTasksParams,
  type WorkTaskPanel,
  type WorkTaskDto,
  type WorkTasksResult,
} from "@/lib/work/my-tasks";

/** The cache key of one task in the side panel. */
export const workTaskKey = (id: string): readonly unknown[] => ["work", "task", id];

/**
 * The screen's data (TanStack Query): the page hands the first answer in, a change of view, scope or chip fetches the next from `GET /api/work/tasks`, and the
 * previous answer stays on screen (dimmed by the caller) until it arrives, so a click never blanks the list.
 */
export function useWorkTasks(params: MyTasksParams, first: { data: WorkTasksResult; query: string; at: number }) {
  const query = myTasksApiQuery(params);
  const fresh = query === first.query;
  return useQuery({
    queryKey: workTasksKey(params),
    queryFn: () => apiGet<WorkTasksResult>(`/api/work/tasks${query}`),
    initialData: fresh ? first.data : undefined,
    initialDataUpdatedAt: fresh ? first.at : undefined,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
}

/** One task for the side panel. */
export function useWorkTask(id: string | null) {
  return useQuery({
    queryKey: workTaskKey(id ?? ""),
    queryFn: () => apiGet<WorkTaskPanel>(`/api/work/tasks/${id}`),
    enabled: id !== null,
    staleTime: 10_000,
    retry: false,
  });
}

export type Snapshot = [QueryKey, WorkTasksResult | undefined][];

/**
 * Changes EVERY cached state of the screen at once (so the list, the board and the calendar agree) and hands back what was there, to be put back when the door
 * refuses. A refetch in flight is cancelled first, or its older answer would land on top of the change.
 */
export async function optimisticChange(qc: QueryClient, update: (tasks: WorkTaskDto[], seen: MyTasksParams) => WorkTaskDto[]): Promise<Snapshot> {
  await qc.cancelQueries({ queryKey: WORK_TASKS_ROOT });
  const previous = qc.getQueriesData<WorkTasksResult>({ queryKey: WORK_TASKS_ROOT });
  qc.setQueriesData<WorkTasksResult>({ queryKey: WORK_TASKS_ROOT }, (old) => (old ? { ...old, tasks: update(old.tasks, old.params) } : old));
  return previous;
}

/** Puts the answers back the way `optimisticChange` found them. */
export function restoreChange(qc: QueryClient, previous: Snapshot | undefined): void {
  for (const [key, value] of previous ?? []) qc.setQueryData(key, value);
}

/** Whatever happened, the cache is then re-read from the server: the screen ends up as the server has it. */
export function settleChange(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: WORK_TASKS_ROOT });
  void qc.invalidateQueries({ queryKey: ["work", "task"] });
}

interface ChangeContext {
  previous: Snapshot;
}

/**
 * The three changes a person makes without leaving the screen — tick, move to a stage, change the due day — as TanStack mutation options over a client. Each is
 * OPTIMISTIC: the cached answers change the moment they act, the door is called, and when it refuses the old answers are put back and `fail` tells the person.
 * (Plain functions of a client, so a test runs them without a page.)
 */
export function workActionOptions(qc: QueryClient, deps: { timeZone: string; fail: (err: unknown, id: string) => void }) {
  return {
    complete: {
      mutationFn: ({ id, done }: { id: string; done: boolean }) => apiPost(`/api/tasks/${id}/complete`, { complete: done }),
      onMutate: async ({ id, done }: { id: string; done: boolean }): Promise<ChangeContext> => ({
        // a ticked task leaves an open list at once, an unticked one leaves «مكتملة»
        previous: await optimisticChange(qc, (tasks, seen) => withCompletion(tasks, id, done).filter((task) => task.id !== id || stillListed(task, seen.chip, seen.view))),
      }),
      onError: (err: unknown, { id }: { id: string; done: boolean }, context: ChangeContext | undefined) => {
        restoreChange(qc, context?.previous);
        deps.fail(err, id);
      },
      onSettled: () => settleChange(qc),
    },
    stage: {
      mutationFn: ({ id, to }: { id: string; to: WorkStage }) => apiPost(`/api/work/tasks/${id}/stage`, { stage: to }),
      onMutate: async ({ id, to }: { id: string; to: WorkStage }): Promise<ChangeContext> => ({ previous: await optimisticChange(qc, (tasks) => withStage(tasks, id, to)) }),
      onError: (err: unknown, { id }: { id: string; to: WorkStage }, context: ChangeContext | undefined) => {
        restoreChange(qc, context?.previous);
        deps.fail(err, id);
      },
      onSettled: () => settleChange(qc),
    },
    due: {
      // the day as picked (`YYYY-MM-DD`): the server makes it noon in the COMPANY's zone, never the browser's
      mutationFn: ({ id, day }: { id: string; day: string | null }) => apiPatch(`/api/tasks/${id}`, { dueDate: day }),
      onMutate: async ({ id, day }: { id: string; day: string | null }): Promise<ChangeContext> => ({
        previous: await optimisticChange(qc, (tasks) => withDueDay(tasks, id, day, (d) => dueInstantForDay(d, deps.timeZone)?.toISOString() ?? null)),
      }),
      onError: (err: unknown, { id }: { id: string; day: string | null }, context: ChangeContext | undefined) => {
        restoreChange(qc, context?.previous);
        deps.fail(err, id);
      },
      onSettled: () => settleChange(qc),
    },
  };
}

/** The hook the screen uses: the three optimistic changes, and the quick add. */
export function useWorkActions(timeZone: string) {
  const qc = useQueryClient();
  const router = useRouter();
  const { t } = useI18n();
  const { toast } = useToast();

  function fail(err: unknown, id: string) {
    // «حقول مخصصة»: finishing needs the project's required fields: say which and open the task where they are filled
    const missing = requiredFieldsOf(err);
    if (missing) {
      toast(rt("fields.required_toast", { labels: missing.map((m) => m.label).join("، ") }), "error");
      router.push(`/tasks/${id}#${FIELDS_ANCHOR}`);
      return;
    }
    if (err instanceof ApiError && JSON.stringify(err.details ?? "").includes("work.stage_missing")) {
      toast(t("mytasks.error.stage_missing"), "error");
      return;
    }
    const code = err instanceof ApiError ? err.code : "internal";
    toast(code === "forbidden" ? t("forbidden") : t("common.error"), "error");
  }

  const options = workActionOptions(qc, { timeZone, fail });
  const complete = useMutation(options.complete);
  const stage = useMutation(options.stage);
  const due = useMutation(options.due);

  const add = useMutation({
    mutationFn: (title: string) => apiPost(`/api/work/tasks`, { title }),
    onSuccess: () => toast(t("mytasks.quick.added"), "success"),
    onError: (err) => {
      const text = err instanceof ApiError && err.messageKey?.startsWith("instant.") && t(err.messageKey) !== err.messageKey ? t(err.messageKey) : t("mytasks.quick.failed");
      toast(text, "error");
    },
    onSettled: () => settleChange(qc),
  });

  return { complete, stage, due, add };
}
