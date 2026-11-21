import { Layers } from "lucide-react";
import { fmtNumber } from "@/lib/format";
import { getServerT } from "@/lib/i18n/server";
import { goHref } from "@/lib/space-link";
import type { TodayBySpaceRow } from "@/lib/today";
import { cn } from "@/lib/utils";

/**
 * «اليوم» inside «الشركة» (B4, the owner's decision of 2026-11-21: each space is its own account, «الشركة» is the view over all of them): a line per space of
 * the person's — its name, how many of THEIR tasks are open there, how many are late, how many messages wait — and «انتقل», the `/go` link that enters that
 * space on its own «اليوم». The numbers come from the one per-space source (`spaceFigures`); the work itself is never listed here.
 */
export function TodayHqSummary({ rows }: { rows: TodayBySpaceRow[] }) {
  const { t } = getServerT();
  return (
    <section aria-labelledby="today-hq-title" data-today-hq className="rounded-card border border-border bg-surface-1 shadow-card">
      <header className="px-4 pt-3">
        <h2 id="today-hq-title" className="text-base font-semibold text-fg">
          {t("today.hq.title")}
        </h2>
        <p className="text-xs text-fg-muted">{t("today.hq.hint")}</p>
      </header>
      {rows.length === 0 ? (
        <p className="px-4 pb-4 pt-3 text-sm text-fg-muted">{t("today.hq.empty")}</p>
      ) : (
        <ul role="list" className="divide-y divide-border px-2 pb-2 pt-1">
          {rows.map((row) => (
            <li key={row.id} data-today-hq-space={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2">
              <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center leading-none">
                {row.emoji ?? <Layers className="size-4 text-muted" />}
              </span>
              <span className="min-w-0 flex-1 basis-32 truncate text-sm font-medium text-fg">
                <bdi>{row.name}</bdi>
              </span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                <span>{t("today.hq.open", { n: fmtNumber(row.open) })}</span>
                <span className={cn(row.overdue > 0 && "font-semibold text-danger")}>{t("today.hq.overdue", { n: fmtNumber(row.overdue) })}</span>
                {row.unread > 0 ? <span>{t("today.hq.unread", { n: fmtNumber(row.unread) })}</span> : null}
              </span>
              <a href={goHref(row.id)} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-accent transition-colors hover:bg-surface-2">
                {t("workreq.group.go")}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
