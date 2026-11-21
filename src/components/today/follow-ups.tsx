import Link from "next/link";
import { getServerT } from "@/lib/i18n/server";
import type { TodayFollowUp } from "@/lib/today";
import { cn } from "@/lib/utils";

/**
 * «مواعيد اليوم» (Q1.5's follow-up day) — a short list under «تذكيراتي» in the simplified «اليوم»: the person's own tickets whose
 * follow-up day has come, with the day said as people say it, and a link to the tickets. It is part of the reminders card's slot, not a
 * card of its own (the six-card rule counts the slot once). The tickets are the person's own (`getTodayFollowUps`); the customer's number
 * is never read. With none the page does not draw it.
 */
export function TodayFollowUps({ items }: { items: TodayFollowUp[] }) {
  const { t } = getServerT();
  return (
    <section aria-labelledby="today-follow-title" className="mt-2 rounded-card border border-border bg-surface-1 shadow-card">
      <header className="flex items-center gap-2 px-4 pt-3">
        <div className="min-w-0 flex-1">
          <h3 id="today-follow-title" className="text-base font-semibold text-fg">
            {t("today.follow.title")}
          </h3>
          <p className="text-xs text-fg-muted">{t("today.follow.hint")}</p>
        </div>
        <Link href="/tickets" prefetch={false} className="inline-flex min-h-11 items-center text-sm font-medium text-accent hover:underline">
          {t("today.follow.all")}
        </Link>
      </header>
      <ul role="list" className="divide-y divide-border px-2 pb-2 pt-1">
        {items.map((item) => (
          <li key={item.id}>
            {/* the ticket itself (the desk opens it), not the list of tickets */}
            <Link href={`/tickets?ticket=${encodeURIComponent(item.id)}`} prefetch={false} className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
                <bdi>{item.title}</bdi>
              </span>
              <span className={cn("text-xs", item.late ? "text-danger" : "text-fg-muted")}>{item.dueLabel}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
