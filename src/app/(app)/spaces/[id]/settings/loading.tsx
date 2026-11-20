import { Skeleton } from "@/components/ui/skeleton";
import { getServerT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

/**
 * A2.2 - what a space's settings page shows while it loads: the title, the strip of tabs, then a card. The same outer frame as the page's own, only the theme's tokens
 * and logical properties, no word but the one status line, and every block holds still under reduced motion and in «وضع التوفير».
 */
const STILL = "[[data-decor-economy]_&]:animate-none";

function Block({ className }: { className?: string }) {
  return <Skeleton className={cn(STILL, className)} />;
}

export default function SpaceSettingsLoading() {
  const { t } = getServerT();
  return (
    <div role="status" aria-live="polite" aria-busy="true" data-skeleton-shape="sections" className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4 md:px-6 md:py-6">
      <div aria-hidden="true" className="space-y-4">
        <div className="space-y-2">
          <Block className="h-6 w-56 max-w-full" />
          <Block className="h-3 w-72 max-w-full" />
        </div>
        <div className="flex gap-2 border-b border-border pb-2">
          {["w-14", "w-16", "w-20", "w-20", "w-16", "w-14"].map((width, index) => (
            <Block key={index} className={cn("h-7 shrink-0", width)} />
          ))}
        </div>
        <div className="space-y-3 rounded-xl border border-border p-4">
          <Block className="h-4 w-32" />
          <Block className="h-10 w-full" />
          <Block className="h-10 w-full" />
        </div>
      </div>
      {/* LAST: the status line is out of the flow, so it does not push the first block down */}
      <span className="sr-only">{t("common.loading")}</span>
    </div>
  );
}
