import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { fmtNumber } from "@/lib/format";
import { getServerT } from "@/lib/i18n/server";
import type { TodayMentions } from "@/lib/today";

/**
 * «ذكروك» — the third card of the simplified «اليوم» (W1.7): the unread messages that mention the person, one row per conversation with
 * how many, each row a link INTO that conversation. The text of a message is never read or drawn here (a name and a count only). The service
 * (`getTodayMentions`) takes the numbers from the chat list, which counts only conversations the person may read and nothing in silent
 * oversight; with no mention the page does not draw the card.
 */
export function TodayMentionsCard({ mentions }: { mentions: TodayMentions }) {
  const { t } = getServerT();
  return (
    <section aria-labelledby="today-mentions-title" className="rounded-card border border-border bg-surface-1 shadow-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pt-3">
        <div className="min-w-0">
          <h2 id="today-mentions-title" className="text-base font-semibold text-fg">
            {t("today.mentions.title")}
          </h2>
          <p className="text-xs text-fg-muted">{t("today.mentions.hint")}</p>
        </div>
        <span className="rounded-full bg-info/10 px-3 py-1 text-sm font-bold text-info">{t("today.mentions.count", { n: fmtNumber(mentions.total) })}</span>
        <Link href="/chat" prefetch={false} className="ms-auto inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent hover:underline">
          {t("today.mentions.open")}
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Link>
      </header>
      <ul role="list" className="divide-y divide-border px-2 pb-2 pt-1">
        {mentions.rows.map((row) => (
          <li key={row.id}>
            <Link href={row.href} prefetch={false} className="flex min-h-14 flex-col justify-center gap-0.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2">
              <span className="line-clamp-1 break-words text-sm font-medium leading-6 text-fg">
                <bdi>{row.title}</bdi>
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5 text-fg-muted">
                <span className="text-info">{t("today.mentions.count", { n: fmtNumber(row.count) })}</span>
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
    </section>
  );
}
