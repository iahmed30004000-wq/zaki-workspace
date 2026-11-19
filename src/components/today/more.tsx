import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { getServerT } from "@/lib/i18n/server";

/**
 * «اليوم › المزيد» — the foot of the simplified «اليوم» (W1.7): a folded section that holds what used to sit among the page's cards and
 * moved (the personal numbers, the catch-up digest, the day's time, the pinned tasks, the active projects). Nothing was deleted: it is the same
 * parts, drawn by the same components, behind one tap. Closed by default; native `details`, so it works without script and a person
 * who never opens it loses nothing they need each morning. The page decides what goes inside (`todayLayout().more`) and draws nothing
 * at all when there is nothing for this person.
 */
export function TodayMore({ children }: { children: ReactNode }) {
  const { t } = getServerT();
  return (
    <details data-today-more="" className="group rounded-card border border-border bg-surface-1 shadow-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2">
        <span className="min-w-0">
          <span className="block text-base font-semibold text-fg">{t("today.more.title")}</span>
          <span className="block text-xs text-fg-muted">{t("today.more.hint")}</span>
        </span>
        <ChevronDown className="size-5 shrink-0 text-fg-muted transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="flex flex-col gap-4 px-3 pb-3 pt-1">{children}</div>
    </details>
  );
}
