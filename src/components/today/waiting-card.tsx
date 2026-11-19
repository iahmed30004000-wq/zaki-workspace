import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { fmtNumber } from "@/lib/format";
import { getServerT } from "@/lib/i18n/server";
import type { TodayWaiting } from "@/lib/today";

/**
 * «بانتظار قرارك» — the second card of the simplified «اليوم» (W1.7): how many things wait for THIS person's decision (the count of
 * W1.4's inbox «الطلبات»), and its newest five, each a link to the thing itself. It draws and decides nothing: the service
 * (`getTodayWaiting`) takes the count and the rows from the inbox, which already filters every row by what the person may see.
 * With nothing waiting the page does not draw the card at all.
 */
export function TodayWaitingCard({ waiting }: { waiting: TodayWaiting }) {
  const { t } = getServerT();
  const rest = waiting.total - waiting.rows.length;
  return (
    <section aria-labelledby="today-waiting-title" className="rounded-card border border-border bg-surface-1 shadow-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3">
        <div className="min-w-0">
          <h2 id="today-waiting-title" className="text-base font-semibold text-fg">
            {t("today.waiting.title")}
          </h2>
          <p className="text-xs text-fg-muted">{t("today.waiting.hint")}</p>
        </div>
        <span
          role="img"
          aria-label={t("shell.place_waiting", { count: fmtNumber(waiting.total) })}
          className="rounded-full bg-accent/10 px-3 py-1 text-sm font-bold text-accent"
        >
          {fmtNumber(waiting.total)}
        </span>
        <Link href="/requests" prefetch={false} className="ms-auto inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent hover:underline">
          {t("today.waiting.all")}
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Link>
      </header>
      <ul role="list" className="divide-y divide-border px-2 pb-2 pt-1">
        {waiting.rows.map((row) => (
          <li key={`${row.kind}-${row.id}`}>
            <Link href={row.href} prefetch={false} className="flex min-h-14 flex-col justify-center gap-0.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2">
              <span className="line-clamp-2 break-words text-sm font-medium leading-6 text-fg">
                <bdi>{row.title}</bdi>
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-fg-muted">
                <span>{t(`today.waiting.kind.${row.kind}`)}</span>
                {row.place ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="min-w-0 max-w-full truncate">
                      <bdi>{row.place}</bdi>
                    </span>
                  </>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {rest > 0 ? <p className="px-4 pb-3 text-xs text-fg-muted">{t("today.waiting.rest", { n: fmtNumber(rest) })}</p> : null}
    </section>
  );
}
