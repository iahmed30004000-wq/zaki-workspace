import { Skeleton } from "@/components/ui/skeleton";
import { getServerT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

/**
 * W1.5 - what a project page shows while it loads (F1.6's shared skeletons skip this place on purpose): the shape of the page with tabs - the trail, the
 * title with its status line, the strip of tabs, then the board's columns. The same outer frame as the page's own, only the theme's tokens and logical
 * properties, no word but the one status line, and every block holds still under reduced motion and in «وضع التوفير».
 */
const STILL = "[[data-decor-economy]_&]:animate-none";

function Block({ className }: { className?: string }) {
  return <Skeleton className={cn(STILL, className)} />;
}

export default function ProjectLoading() {
  const { t } = getServerT();
  return (
    <div role="status" aria-live="polite" aria-busy="true" data-skeleton-shape="sections" className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <div aria-hidden="true" className="space-y-4">
        <Block className="h-3 w-48 max-w-full" />
        <div className="space-y-2">
          <Block className="h-6 w-56 max-w-full" />
          <Block className="h-3 w-72 max-w-full" />
        </div>
        <div className="flex gap-2 border-b border-border pb-2">
          {["w-16", "w-16", "w-16", "w-24", "w-28", "w-20"].map((width, index) => (
            <Block key={index} className={cn("h-7 shrink-0", width)} />
          ))}
        </div>
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2].map((column) => (
            <div key={column} className="w-72 min-w-72 shrink-0 space-y-2 rounded-xl border border-border p-2">
              <Block className="h-4 w-24" />
              <Block className="h-16 w-full" />
              <Block className="h-16 w-full" />
            </div>
          ))}
        </div>
      </div>
      {/* LAST: the status line is out of the flow, so it does not push the first block down */}
      <span className="sr-only">{t("common.loading")}</span>
    </div>
  );
}
