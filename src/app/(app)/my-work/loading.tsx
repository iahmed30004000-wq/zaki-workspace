import { Skeleton } from "@/components/ui/skeleton";
import { getServerT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

/**
 * W1.1 — what `/my-work` shows while its page loads: the shape of the unified «مهامي» screen (F1.6's shared skeletons skip this place on purpose). The same
 * outer frame as the page's own (a full-height column, header on a surface with a hairline), then the two strips of the bar (the views and the scope, the chips),
 * the quick-add line and thin-divided rows (D1: a list, not cards). Only the theme's tokens and logical properties, no word but the one status line, and every
 * block holds still under reduced motion and in «وضع التوفير».
 */
const STILL = "[[data-decor-economy]_&]:animate-none";
const WIDTHS = ["w-3/5", "w-2/5", "w-4/5", "w-1/2", "w-3/4", "w-2/3"] as const;

function Block({ className }: { className?: string }) {
  return <Skeleton className={cn(STILL, className)} />;
}

export default function MyWorkLoading() {
  const { t } = getServerT();
  return (
    <div role="status" aria-live="polite" aria-busy="true" data-skeleton-shape="list" className="flex h-full min-w-0 flex-col overflow-y-auto">
      <div aria-hidden="true" className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 pb-1 pt-4 md:px-5">
        <div className="min-w-0 flex-1 space-y-2">
          <Block className="h-5 w-24 max-w-full" />
          <Block className="h-3 w-56 max-w-full" />
        </div>
      </div>

      <div aria-hidden="true" className="mx-auto w-full max-w-6xl space-y-2.5 px-4 pb-1 md:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <Block className="h-9 w-44 rounded-[10px]" />
          <Block className="h-9 w-40 rounded-[10px]" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Block className="h-8 w-14 rounded-full" />
          <Block className="h-8 w-20 rounded-full" />
          <Block className="h-8 w-20 rounded-full" />
          <Block className="h-8 w-24 rounded-full" />
          <Block className="h-8 w-24 rounded-full" />
          <Block className="h-8 w-20 rounded-full" />
        </div>
      </div>

      <div aria-hidden="true" className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4 pb-1 pt-2 md:px-5">
        <Block className="size-4 rounded-md" />
        <Block className="h-9 w-64 max-w-full" />
      </div>

      <div aria-hidden="true" className="mx-auto w-full max-w-6xl flex-1 overflow-hidden px-4 pb-7 pt-3 md:px-5">
        <div className="overflow-hidden rounded-2xl bg-surface-1">
          {WIDTHS.concat(WIDTHS).map((width, index) => (
            <div key={index} className="flex min-h-14 w-full items-center gap-3 border-b border-border px-3 py-2">
              <Block className="size-[22px] shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-2">
                <Block className={cn("h-4 max-w-full", width)} />
                <Block className="h-3 w-2/5 max-w-full" />
              </div>
              <Block className="h-5 w-24 shrink-0 rounded-md" />
            </div>
          ))}
        </div>
      </div>
      {/* LAST: the status line is out of the flow, so it does not push the first block down */}
      <span className="sr-only">{t("common.loading")}</span>
    </div>
  );
}
