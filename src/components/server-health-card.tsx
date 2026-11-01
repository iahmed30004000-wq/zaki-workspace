"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { apiGet } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { fmtNumber, fmtSize } from "@/lib/format";
import { HEALTH_THRESHOLDS, type ServerHealth } from "@/lib/server-health";
import { cn } from "@/lib/utils";

const GB = 1024 * 1024 * 1024;

/**
 * «حال السيرفر»: a read-only card for the owner next to «وضع التوفير». It reads once when the screen opens and again on «حدّث» (never on a
 * timer: a card that measures the server must not load it). Numbers only; when a reading crosses a limit, a ⚠️ line names it and a 🔧 line
 * points at the economy switch above.
 */
export function ServerHealthCard() {
  const { t } = useI18n();
  const [data, setData] = useState<ServerHealth | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setData(await apiGet<ServerHealth>("/api/settings/server-health"));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const bytes = (n: number) => (n >= GB ? `${(n / GB).toFixed(1)} ${t("health.unit.gb")}` : `${(n / 1024 / 1024).toFixed(0)} ${t("health.unit.mb")}`);
  const ms = (n: number) => t("health.ms", { n: fmtNumber(n) });
  const warn = data?.verdict.level === "warn";

  function rows(d: ServerHealth): [string, string][] {
    const limit = d.memLimitBytes ?? d.totalMemBytes;
    const days = Math.floor(d.uptimeSec / 86400);
    const hours = Math.floor((d.uptimeSec % 86400) / 3600);
    const minutes = Math.floor((d.uptimeSec % 3600) / 60);
    return [
      [t("health.rss"), t("health.rss_of", { used: bytes(d.rssBytes), limit: bytes(limit) })],
      [t("health.heap"), `${bytes(d.heapUsedBytes)} / ${bytes(d.heapTotalBytes)}`],
      [t("health.lag"), ms(d.eventLoopLagMs)],
      [t("health.uptime"), t("health.up", { d: days, h: hours, m: minutes })],
      [t("health.load"), `${d.loadAvg1} · ${d.loadAvg5}`],
      [t("health.free"), `${bytes(d.freeMemBytes)} / ${bytes(d.totalMemBytes)}`],
      [t("health.db"), d.dbOk ? t("health.db_ok", { ms: fmtNumber(d.dbLatencyMs ?? 0) }) : t("health.db_down")],
      [t("health.uploads"), d.uploads ? t("health.uploads_value", { files: fmtNumber(d.uploads.files), size: fmtSize(d.uploads.bytes) }) : t("health.uploads_unknown")],
    ];
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-surface-1 p-5" aria-labelledby="health-title" data-server-health>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="health-title" className="text-sm font-semibold">
            {t("health.title")}
          </h2>
          <p className="text-xs text-muted">{t("health.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs hover:bg-surface-2 disabled:opacity-60"
        >
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} aria-hidden="true" />
          {t("health.refresh")}
        </button>
      </div>
      {failed ? <p className="text-xs text-danger">{t("health.failed")}</p> : null}
      {!data && !failed ? <p className="text-xs text-muted">{t("health.loading")}</p> : null}
      {data ? (
        <>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {rows(data).map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="font-medium text-fg">{value}</dd>
              </div>
            ))}
          </dl>
          {warn ? (
            <div className="space-y-0.5 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs" role="status">
              <p className="font-medium text-warn">
                {t("health.warn")} {data.verdict.reasons.map((r) => t(`health.r.${r}`)).join("، ")}
              </p>
              <p className="text-fg">{t("health.warn_fix")}</p>
            </div>
          ) : (
            <p className="text-xs text-ok">{t("health.ok")}</p>
          )}
          <p className="text-xs text-muted">
            {t("health.thresholds", {
              rss: HEALTH_THRESHOLDS.rssPercent,
              free: HEALTH_THRESHOLDS.freePercent,
              lag: HEALTH_THRESHOLDS.lagMs,
              db: HEALTH_THRESHOLDS.dbMs,
              load: HEALTH_THRESHOLDS.loadPerCore,
            })}
          </p>
        </>
      ) : null}
    </section>
  );
}
