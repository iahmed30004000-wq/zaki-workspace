import { Skeleton } from "@/components/ui/skeleton";
import { getServerT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

/**
 * W1.5 - what a board shows while it loads (F1.6's shared skeletons skip this place on purpose): the same full-height column as the board's own frame, its
 * header on a surface with a hairline, then the columns with their cards. Only the theme's tokens and logical properties, no word but the one status line,
 * and every block holds still under reduced motion and in «وضع التوفير».
 */
const STILL = "[[data-decor-economy]_&]:animate-none";

function Block({ className }: { className?: string }) {
  return <Skeleton className={cn(STILL, className)} />;
}

export default function BoardLoading() {
  const { t } = getServerT();
  return (
    <div role="status" aria-live="polite" aria-busy="true" data-skeleton-shape="grid" className="flex h-full flex-col">
      <div aria-hidden="true" className="space-y-2 border-b border-border bg-surface px-4 py-3">
        <Block className="h-3 w-48 max-w-full" />
        <Block className="h-5 w-40 max-w-full" />
        <Block className="h-3 w-28 max-w-full" />
      </div>
      <div aria-hidden="true" className="flex min-h-0 flex-1 gap-3 overflow-hidden p-4">
        {[0, 1, 2, 3].map((column) => (
          <div key={column} className="w-72 min-w-72 shrink-0 space-y-2 rounded-xl border border-border p-2">
            <Block className="h-4 w-24" />
            <Block className="h-20 w-full" />
            <Block className="h-20 w-full" />
          </div>
        ))}
      </div>
      {/* LAST: the status line is out of the flow, so it does not push the first block down */}
      <span className="sr-only">{t("common.loading")}</span>
    </div>
  );
}
