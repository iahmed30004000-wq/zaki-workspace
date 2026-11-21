"use client";

import Link from "next/link";
import { SettingsDialog } from "@/components/checkins/settings-dialog";
import { enumLabel } from "@/lib/i18n/enums";
import { useI18n } from "@/lib/i18n";
import { goHref } from "@/lib/space-link";

export interface WorkTabProps {
  spaceId: string;
  /** The company's clock, for the check-in's time. */
  timeZone: string;
  /** The columns a new board starts with (`DEFAULT_BOARD_COLUMNS`), each with the stage it carries. */
  columns: { name: string; stage: string }[];
  /** The switch `workStages`: while it is off the stage is not drawn (the board does not offer it either). */
  stagesOn: boolean;
  /** Which parts the company has switched on: a part that is off is not drawn, never a dead link. */
  parts: { checkins: boolean; customFields: boolean; approvals: boolean };
}

const linkClass = "inline-flex min-h-11 shrink-0 items-center rounded-lg border border-border bg-surface px-3 text-sm font-medium text-fg hover:bg-surface-2";

/**
 * «الشغل» — the space's work settings, each part where it already lives (A2.2: nothing is rebuilt): the columns and stages a new board starts with (shown: the
 * manager changes a board's own columns on the board), the custom fields (they belong to a project: a link to the space's projects), the approval forms (a
 * link that enters THIS space first) and the daily check-in (its own dialog, written for this space). A part whose switch is off is not drawn.
 */
export function WorkTab({ spaceId, timeZone, columns, stagesOn, parts }: WorkTabProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-5" data-space-settings-work>
      <section className="space-y-2 rounded-xl border border-border bg-surface-1 p-4">
        <h2 className="text-sm font-semibold text-fg">{t("spset.work.columns")}</h2>
        <p className="text-xs leading-5 text-fg-muted">{t("spset.work.columns_hint")}</p>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {columns.map((column) => (
            <li key={column.name} className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-fg">
                <bdi>{column.name}</bdi>
              </span>
              {stagesOn ? (
                <span className="shrink-0 text-xs text-fg-muted">
                  {t("spset.work.stage")}: {enumLabel("WorkStage", column.stage)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
        {stagesOn ? null : <p className="text-xs text-fg-muted">{t("spset.work.stage_off")}</p>}
      </section>

      {parts.customFields ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 p-4">
          <div className="min-w-[14rem] flex-1">
            <h2 className="text-sm font-semibold text-fg">{t("spset.work.fields")}</h2>
            <p className="text-xs leading-5 text-fg-muted">{t("spset.work.fields_hint")}</p>
          </div>
          <Link href={goHref(spaceId, "/projects")} className={linkClass}>
            {t("spset.work.fields_go")}
          </Link>
        </section>
      ) : null}

      {parts.approvals ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 p-4">
          <div className="min-w-[14rem] flex-1">
            <h2 className="text-sm font-semibold text-fg">{t("spset.work.approvals")}</h2>
            <p className="text-xs leading-5 text-fg-muted">{t("spset.work.approvals_hint")}</p>
          </div>
          <Link href={goHref(spaceId, "/approvals/forms")} className={linkClass}>
            {t("spset.work.approvals_go")}
          </Link>
        </section>
      ) : null}

      {parts.checkins ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-1 p-4">
          <div className="min-w-[14rem] flex-1">
            <h2 className="text-sm font-semibold text-fg">{t("spset.work.checkins")}</h2>
            <p className="text-xs leading-5 text-fg-muted">{t("spset.work.checkins_hint")}</p>
          </div>
          <div data-checkin-settings-open>
            <SettingsDialog workspaceId={spaceId} timeZone={timeZone} onSaved={() => undefined} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
