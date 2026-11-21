"use client";

import Link from "next/link";
import { Segmented } from "@/components/ui/segmented";
import { fmtNumber } from "@/lib/format";
import { enumLabel } from "@/lib/i18n/enums";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Pill, WORK_SEARCH, WORK_SELECT } from "@/components/work/look";
import { WORK_STAGES } from "@/lib/work/stage";
import {
  ALL_SPACES,
  MY_TASK_CHIPS,
  MY_TASK_GROUPS,
  MY_TASK_SORTS,
  type MyTaskChip,
  type MyTaskScope,
  type MyTaskView,
  type MyTasksParams,
  type WorkSpaceOption,
  type WorkTasksResult,
} from "@/lib/work/my-tasks";

const SELECT = WORK_SELECT;

/** What a pick of the space select means for the address: "all" is «كل مساحاتي» (inside «الشركة» that is the default, so nothing is written), "" the default. */
function pickedSpaceId(value: string, hq: boolean): string | null {
  if (value === "all") return hq ? null : ALL_SPACES;
  return value || null;
}

/**
 * The space select's options and its value. The space the person is in is the first option (value "": the default); «كل مساحاتي» (value "all") is the
 * second, an explicit choice; the other spaces follow. Inside «الشركة» there is no space «here»: «كل مساحاتي» is the default (value "") and the spaces follow.
 */
export function spaceChoiceOf(params: Pick<MyTasksParams, "spaceId">, data: Pick<WorkTasksResult, "spaces" | "current">): { here: WorkSpaceOption | null; others: WorkSpaceOption[]; value: string } {
  const here = data.current.hq ? null : (data.spaces.find((s) => s.id === data.current.id) ?? null);
  const others = data.spaces.filter((s) => s.id !== here?.id);
  const asked = params.spaceId;
  const value = asked === ALL_SPACES ? (here ? "all" : "") : asked && others.some((s) => s.id === asked) ? asked : "";
  return { here, others, value };
}

/**
 * The bar of «مهامي»: the view (قائمة · لوحة · تقويم), the scope (أنا · المساحة · مشروع) with its second line (my spaces, or the project picker), the quick
 * chips with their numbers, and the sort, the grouping, the stage and the search. Every control changes the address; the screen reads the answer for it.
 * «المساحة» is not offered in «الشركة»: it holds no projects. `staleHref` (W1.9): a link to the review list of old tasks, handed over by the page only to somebody who
 * manages a space while the company's switch `workStaleSweep` is on.
 */
export function Toolbar({
  params,
  data,
  onChange,
  staleHref = null,
}: {
  params: MyTasksParams;
  data: WorkTasksResult;
  onChange: (next: Partial<MyTasksParams>, mode?: "push" | "replace") => void;
  staleHref?: string | null;
}) {
  const { t } = useI18n();
  const scope: MyTaskScope = data.scopeFellBack ? "me" : params.scope;
  const showChips = params.view !== "calendar";
  const scopes: MyTaskScope[] = data.current.hq ? ["me", "project"] : ["me", "space", "project"];
  const spaceChoice = spaceChoiceOf(params, data);

  return (
    <div className="space-y-2.5 pb-1">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented<MyTaskView>
          label={t("mytasks.view.label")}
          value={params.view}
          onChange={(view) => onChange({ view })}
          options={(["list", "board", "calendar"] as const).map((v) => ({ value: v, label: t(`mytasks.view.${v}`) }))}
        />
        <Segmented<MyTaskScope>
          label={t("mytasks.scope.label")}
          value={scope}
          onChange={(next) => onChange({ scope: next })}
          options={scopes.map((s) => ({ value: s, label: t(`mytasks.scope.${s}`) }))}
        />
        {staleHref ? (
          <Link
            href={staleHref}
            className="ms-auto inline-flex min-h-9 items-center rounded-lg px-2 text-[13.5px] font-semibold text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {t("nav.tab.stale")}
          </Link>
        ) : null}
        <form
          className={cn("flex items-center", staleHref ? "" : "ms-auto")}
          onSubmit={(e) => {
            e.preventDefault();
            const input = e.currentTarget.elements.namedItem("q") as HTMLInputElement | null;
            onChange({ q: input?.value.trim() ?? "" }, "replace");
          }}
        >
          <input
            name="q"
            type="search"
            defaultValue={params.q}
            aria-label={t("mytasks.search")}
            placeholder={t("mytasks.search")}
            className={WORK_SEARCH}
          />
        </form>
      </div>

      {data.scopeFellBack ? <p className="text-xs text-fg-muted">{t("mytasks.scope.hq_note")}</p> : null}

      {scope === "me" && data.spaces.length > 1 ? (
        <select aria-label={t("mytasks.space.label")} className={cn(SELECT, "w-full")} value={spaceChoice.value} onChange={(e) => onChange({ spaceId: pickedSpaceId(e.target.value, data.current.hq) }, "replace")}>
          {/* each space is its own account: the space I am in comes first and is the default; «كل مساحاتي» is a choice (inside «الشركة» it IS the default) */}
          {spaceChoice.here ? <option value="">{spaceChoice.here.name}</option> : <option value="">{t("mytasks.space.all")}</option>}
          {spaceChoice.here ? <option value="all">{t("mytasks.space.all")}</option> : null}
          {spaceChoice.others.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
      ) : null}

      {scope === "project" ? (
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          {t("mytasks.project.label")}
          <select className={cn(SELECT, "max-w-72")} value={params.projectId ?? ""} onChange={(e) => onChange({ projectId: e.target.value || null }, "replace")}>
            <option value="">{t("mytasks.project.pick")}</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {data.spaces.length > 1 ? `${p.name} — ${p.spaceName}` : p.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        {showChips ? (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden md:flex-wrap [&>button]:shrink-0" role="group" aria-label={t("mytasks.chips.label")}>
            <Pill pressed={params.chip === null} onClick={() => onChange({ chip: null }, "replace")}>
              {t("mytasks.chip.all")}
            </Pill>
            {MY_TASK_CHIPS.map((chip: MyTaskChip) => (
              <Pill key={chip} pressed={params.chip === chip} onClick={() => onChange({ chip: params.chip === chip ? null : chip }, "replace")}>
                {t(`mytasks.chip.${chip}`)}
                <span className="tabular-nums opacity-70">{fmtNumber(data.counts[chip])}</span>
              </Pill>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-2 overflow-x-auto max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden md:ms-auto md:flex-wrap [&>select]:shrink-0">
          {params.view !== "calendar" ? (
            <>
              <select aria-label={t("work.stage.label")} className={SELECT} value={params.stage ?? ""} onChange={(e) => onChange({ stage: (e.target.value || null) as MyTasksParams["stage"] }, "replace")}>
                <option value="">{t("mytasks.stage.any")}</option>
                {WORK_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {enumLabel("WorkStage", s)}
                  </option>
                ))}
              </select>
              <select aria-label={t("mytasks.sort.label")} className={SELECT} value={params.sort} onChange={(e) => onChange({ sort: e.target.value as MyTasksParams["sort"] }, "replace")}>
                {MY_TASK_SORTS.map((s) => (
                  <option key={s} value={s}>
                    {`${t("mytasks.sort.label")}: ${t(`mytasks.sort.${s}`)}`}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          {params.view === "list" ? (
            <select aria-label={t("mytasks.group.label")} className={SELECT} value={params.group} onChange={(e) => onChange({ group: e.target.value as MyTasksParams["group"] }, "replace")}>
              {MY_TASK_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {g === "none" ? t("mytasks.group.none") : `${t("mytasks.group.label")}: ${t(`mytasks.group.${g}`)}`}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>
    </div>
  );
}
