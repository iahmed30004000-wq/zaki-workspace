"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseBackup } from "lucide-react";
import { apiGet, apiPatch, apiPost, apiPut, ApiError } from "@/lib/api-client";
import { fmtDateTime, fmtNumber, fmtSize } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface RunItem {
  id: string;
  trigger: "SCHEDULED" | "MANUAL";
  status: "RUNNING" | "SUCCESS" | "FAILED";
  startedAt: string;
  durationMs: number | null;
  sizeBytes: number | null;
  tables: number | null;
  rows: number | null;
  driveFileId: string | null;
  pruned: boolean;
  errorKey: string | null;
  errorDetail: string | null;
  verifiedAt: string | null;
  verifyOk: boolean | null;
  verifyTables: number | null;
  verifyRows: number | null;
  verifyErrorKey: string | null;
}

interface BackupAnswer {
  switchOn: boolean;
  keyConfigured: boolean;
  driveReady: boolean;
  eligible: boolean;
  config: { hour: number; daily: number; weekly: number };
  timezone: string;
  running: boolean;
  lastSuccessAt: string | null;
  freshness: "fresh" | "stale" | "never";
  runs: RunItem[];
}

type TFn = (key: string, vars?: Record<string, string | number>) => string;

const CODE_CLASS = "block whitespace-pre-wrap break-all rounded bg-surface px-2 py-1.5 font-mono text-xs";
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/**
 * «نسخ احتياطي لقاعدة البيانات» (src/server/services/db-backup.ts), under «الأتمتة», for the OWNER alone: the switch, the hour and the
 * retention, «اعمل نسخة هلأ», the history (time, size, duration, outcome, Drive's file id, never a link), «تحقّق», and the plain
 * restore guide. Every risk is shown as ⚠️ with its fix as 🔧.
 */
export function DbBackupCard() {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: ["db-backup"],
    queryFn: () => apiGet<BackupAnswer>("/api/integrations/db-backup"),
    // while a copy runs the history refreshes by itself
    refetchInterval: (q) => (q.state.data?.running ? 5000 : false),
  });
  const data = state.data;

  const [hour, setHour] = useState(3);
  const [daily, setDaily] = useState("14");
  const [weekly, setWeekly] = useState("4");
  useEffect(() => {
    if (!data) return;
    setHour(data.config.hour);
    setDaily(String(data.config.daily));
    setWeekly(String(data.config.weekly));
  }, [data?.config.hour, data?.config.daily, data?.config.weekly]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => qc.invalidateQueries({ queryKey: ["db-backup"] });

  const flip = useMutation({
    mutationFn: (on: boolean) => apiPatch("/api/settings/features", { key: "dbBackup", on }),
    onSuccess: () => {
      toast(t("backup.switch.changed"), "success");
      void refresh();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });
  const save = useMutation({
    mutationFn: () => apiPut("/api/integrations/db-backup", { hour, daily: Number(daily), weekly: Number(weekly) }),
    onSuccess: () => {
      toast(t("backup.saved"), "success");
      void refresh();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });
  const run = useMutation({
    mutationFn: () => apiPost("/api/integrations/db-backup/run"),
    onSuccess: () => {
      toast(t("backup.started"), "success");
      void refresh();
    },
    onError: (err) => toast(errText(err, t), "error"),
  });
  const verify = useMutation({
    mutationFn: (id: string) => apiPost(`/api/integrations/db-backup/${id}/verify`),
    onSuccess: () => void refresh(),
    onError: (err) => toast(errText(err, t), "error"),
  });

  const keyHint = "<ENCRYPTION_KEY>";
  const valid = Number.isInteger(Number(daily)) && Number(daily) >= 1 && Number(daily) <= 60 && Number.isInteger(Number(weekly)) && Number(weekly) >= 0 && Number(weekly) <= 26;
  const active = data?.switchOn && data.eligible;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-surface-1 p-5" aria-labelledby="backup-title">
      <div className="flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-lg bg-cat-3/10 text-cat-3">
          <DatabaseBackup className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="backup-title" className="text-sm font-semibold">
            {t("backup.title")}
          </h2>
          <p className="text-xs text-muted">{t("backup.subtitle")}</p>
        </div>
        {data && data.eligible ? (
          <Button type="button" size="sm" variant={data.switchOn ? "secondary" : "primary"} disabled={flip.isPending} onClick={() => flip.mutate(!data.switchOn)}>
            {t(data.switchOn ? "backup.switch.turn_off" : "backup.switch.turn_on")}
          </Button>
        ) : null}
      </div>

      <Notice warn={t("backup.warn")} fix={t("backup.fix")} />

      {data && !data.eligible ? <Notice warn={t("backup.not_eligible.warn")} fix={t("backup.not_eligible.fix")} /> : null}
      {data && data.eligible && !data.switchOn ? <Notice warn={t("backup.off.warn")} fix={t("backup.off.fix")} /> : null}
      {data && data.eligible && !data.keyConfigured ? <Notice warn={t("backup.no_key.warn")} fix={t("backup.no_key.fix")} /> : null}
      {data && active && data.keyConfigured && !data.driveReady ? <Notice warn={t("backup.drive.warn")} fix={t("backup.drive.fix")} /> : null}
      {data && active && data.freshness === "stale" && data.lastSuccessAt ? (
        <Notice warn={t("backup.stale.warn", { when: fmtDateTime(data.lastSuccessAt) })} fix={t("backup.stale.fix")} />
      ) : null}
      {data && active && data.freshness === "never" ? <Notice warn={t("backup.never.warn")} fix={t("backup.never.fix")} /> : null}

      {data ? (
        <p className="text-xs text-muted">{data.lastSuccessAt ? t("backup.last_ok", { when: fmtDateTime(data.lastSuccessAt) }) : t("backup.last_ok_none")}</p>
      ) : null}

      {data && active ? (
        <form
          className="space-y-3 rounded-lg border border-border bg-surface-2/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !save.isPending) save.mutate();
          }}
        >
          <h3 className="text-xs font-semibold">{t("backup.schedule.title")}</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-fg">{t("backup.hour")}</span>
              <Select value={String(hour)} onChange={(e) => setHour(Number(e.target.value))}>
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hourLabel(h)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-fg">{t("backup.keep_daily")}</span>
              <Input type="number" min={1} max={60} value={daily} onChange={(e) => setDaily(e.target.value)} />
            </label>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-fg">{t("backup.keep_weekly")}</span>
              <Input type="number" min={0} max={26} value={weekly} onChange={(e) => setWeekly(e.target.value)} />
            </label>
          </div>
          <p className="text-xs text-muted">{t("backup.hour_hint", { zone: data.timezone })}</p>
          <p className="text-xs text-muted">{t("backup.keep_hint")}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="secondary" disabled={!valid || save.isPending}>
              {t("backup.save")}
            </Button>
            <Button type="button" size="sm" disabled={run.isPending || data.running || !data.keyConfigured} onClick={() => run.mutate()}>
              {data.running ? t("backup.running") : t("backup.run_now")}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border">
        <h3 className="border-b border-border bg-surface-2 px-2 py-1.5 text-xs font-semibold">{t("backup.runs.title")}</h3>
        <table className="w-full min-w-[46rem] text-right text-xs">
          <thead className="bg-surface-2 text-muted">
            <tr>
              <th className="px-2 py-1.5 font-medium">{t("backup.col.time")}</th>
              <th className="px-2 py-1.5 font-medium">{t("backup.col.trigger")}</th>
              <th className="px-2 py-1.5 font-medium">{t("backup.col.status")}</th>
              <th className="px-2 py-1.5 font-medium">{t("backup.col.size")}</th>
              <th className="px-2 py-1.5 font-medium">{t("backup.col.duration")}</th>
              <th className="px-2 py-1.5 font-medium">{t("backup.col.file")}</th>
              <th className="px-2 py-1.5 font-medium">{t("backup.col.check")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {(data?.runs ?? []).map((r) => (
              <tr key={r.id} className="align-top">
                <td className="px-2 py-1.5 text-muted">{fmtDateTime(r.startedAt)}</td>
                <td className="px-2 py-1.5">{t(`backup.trigger.${r.trigger}`)}</td>
                <td className="px-2 py-1.5">
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", r.status === "SUCCESS" ? "bg-ok/10 text-ok" : r.status === "FAILED" ? "bg-danger/10 text-danger" : "bg-surface-2 text-muted")}>
                    {t(`backup.status.${r.status}`)}
                  </span>
                  {r.errorKey ? (
                    <span className="mt-1 block text-danger">
                      {t(r.errorKey)}
                      {r.errorDetail ? (
                        <code dir="ltr" className="ms-1 font-mono text-muted">
                          {`(${r.errorDetail})`}
                        </code>
                      ) : null}
                    </span>
                  ) : null}
                  {r.status === "FAILED" && r.errorKey === "backup.err.drive_not_connected" ? <span className="mt-1 block text-warn">{t("backup.drive.fix")}</span> : null}
                  {r.pruned ? <span className="mt-1 block text-muted">{t("backup.pruned")}</span> : null}
                </td>
                <td className="px-2 py-1.5 text-muted">
                  {r.sizeBytes !== null ? fmtSize(r.sizeBytes) : ""}
                  {r.tables !== null && r.rows !== null ? <span className="block">{t("backup.counts", { tables: fmtNumber(r.tables), rows: fmtNumber(r.rows) })}</span> : null}
                </td>
                <td className="px-2 py-1.5 text-muted">{r.durationMs === null ? "" : durationText(r.durationMs, t)}</td>
                <td className="px-2 py-1.5">
                  {r.driveFileId ? (
                    <code dir="ltr" className="break-all font-mono text-muted">
                      {r.driveFileId}
                    </code>
                  ) : null}
                </td>
                <td className="px-2 py-1.5">
                  {r.status === "SUCCESS" && r.driveFileId ? (
                    <Button type="button" size="sm" variant="secondary" disabled={!active || verify.isPending} onClick={() => verify.mutate(r.id)} title={t("backup.verify_hint")}>
                      {verify.isPending && verify.variables === r.id ? t("backup.verifying") : t("backup.verify")}
                    </Button>
                  ) : null}
                  {r.verifiedAt ? (
                    <span className={cn("mt-1 block", r.verifyOk ? "text-ok" : "text-danger")}>
                      {r.verifyOk
                        ? t("backup.verify_ok", { tables: fmtNumber(r.verifyTables ?? 0), rows: fmtNumber(r.verifyRows ?? 0), when: fmtDateTime(r.verifiedAt) })
                        : t("backup.verify_bad", { reason: r.verifyErrorKey ? t(r.verifyErrorKey) : "", when: fmtDateTime(r.verifiedAt) })}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
            {(data?.runs.length ?? 0) === 0 && (
              <tr>
                <td colSpan={7} className="px-2 py-3 text-center text-muted">
                  {t("backup.runs.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <details className="rounded-lg border border-border bg-surface-2/40 p-3 text-xs leading-6">
        <summary className="cursor-pointer text-sm font-semibold">{t("backup.guide.title")}</summary>
        <div className="mt-3 space-y-3">
          <Notice warn={t("backup.guide.warn")} fix={t("backup.guide.fix")} />
          <p>{t("backup.guide.step1")}</p>
          <p>{t("backup.guide.step2")}</p>
          <p>{t("backup.guide.step3")}</p>
          <code dir="ltr" className={CODE_CLASS}>
            {`ENCRYPTION_KEY=${keyHint} node scripts/decrypt-backup.mjs backup.zbk`}
          </code>
          <p>{t("backup.guide.step4")}</p>
          <code dir="ltr" className={CODE_CLASS}>
            {"gunzip backup.zbk.sql.gz"}
          </code>
          <p>{t("backup.guide.step5")}</p>
          <code dir="ltr" className={CODE_CLASS}>
            {`createdb zaki_restore
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/zaki_restore npx prisma migrate deploy`}
          </code>
          <p>{t("backup.guide.step6")}</p>
          <code dir="ltr" className={CODE_CLASS}>
            {"psql postgresql://USER:PASSWORD@HOST:5432/zaki_restore -v ON_ERROR_STOP=1 --single-transaction -f backup.zbk.sql"}
          </code>
          <p>{t("backup.guide.step7")}</p>
          <p>{t("backup.guide.verify")}</p>
          <code dir="ltr" className={CODE_CLASS}>
            {`ENCRYPTION_KEY=${keyHint} node scripts/verify-backup.mjs backup.zbk`}
          </code>
          <p className="text-muted">{t("backup.guide.note")}</p>
          <p className="text-warn">{t("backup.guide.lost_key")}</p>
        </div>
      </details>
    </section>
  );
}

function Notice({ warn, fix }: { warn: string; fix: string }) {
  return (
    <div className="space-y-1 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs leading-6">
      <p className="text-warn">{warn}</p>
      <p>{fix}</p>
    </div>
  );
}

function durationText(ms: number, t: TFn): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 120 ? t("backup.duration_seconds", { n: fmtNumber(seconds) }) : t("backup.duration_minutes", { n: fmtNumber(Math.round(seconds / 60)) });
}

function errText(err: unknown, t: TFn): string {
  if (err instanceof ApiError) {
    if (err.messageKey) {
      const mapped = t(err.messageKey);
      if (mapped !== err.messageKey) return mapped;
    }
    if (err.code) {
      const translated = t(err.code);
      if (translated !== err.code) return translated;
    }
  }
  return t("common.error");
}
