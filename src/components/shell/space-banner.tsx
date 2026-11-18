"use client";

import { usePathname } from "next/navigation";
import { Layers } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { goHref } from "@/lib/space-link";
import { foreignFor, type ForeignSpace } from "@/lib/nav/shell-v2";
import { useSpaces } from "./space-switcher";

/**
 * N1.3 — the banner of a thing that belongs to ANOTHER space of the person's (a task link, a notification): ONE line over the page, «هاد من مساحة
 * «X»» and «انتقل لها». The app no longer changes space by itself on the way (that was silent: the name at the top changed and nobody said why).
 *
 * The button is the same `/go` link `keepInSpace` (src/server/services/current-space.ts) used to redirect to by itself — now it is the person's own tap
 * that enters the space and comes back to the same page. Never dismissed by the page: it goes away when the person is in that space, or leaves the page.
 */
export function SpaceBannerView({ foreign }: { foreign: ForeignSpace | null }) {
  const { t } = useI18n();
  if (!foreign) return null;
  return (
    <div role="status" data-shell="space-banner" className="flex shrink-0 items-center gap-2 border-b border-border bg-accent-2/10 ps-4 pe-2 text-sm text-fg">
      <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center leading-none">
        {foreign.emoji ?? <Layers className="size-4 text-muted" />}
      </span>
      <p className="min-w-0 flex-1 truncate py-2">{t("navv2.banner.foreign", { name: foreign.name })}</p>
      <a href={goHref(foreign.spaceId, foreign.next)} className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 font-semibold text-accent transition-colors hover:bg-surface-2">
        {t("navv2.banner.go")}
      </a>
    </div>
  );
}

/** The banner of the page on screen, from the shell's one spaces query (the answer counts only for the address it was asked about). */
export function SpaceBanner() {
  const pathname = usePathname() ?? "/";
  const { data } = useSpaces();
  return <SpaceBannerView foreign={foreignFor(data?.foreign, pathname)} />;
}

/**
 * D-N3 — «الشركة» keeps no projects, so a newcomer put only there has no work space: «الشغل» says so and who to ask, instead of empty lists.
 * An owner or an admin (who may open a space) is told how to open one instead.
 */
export function NoWorkSpace({ canCreate = false }: { canCreate?: boolean }) {
  const { t } = useI18n();
  return (
    <div data-shell="no-work-space" role="note" className="mx-auto my-8 max-w-md space-y-1 rounded-2xl border border-dashed border-border bg-surface-1 px-5 py-6 text-center">
      <p className="text-base font-semibold text-fg">{t("navv2.nowork.title")}</p>
      <p className="text-sm text-fg-muted">{t(canCreate ? "navv2.nowork.hint_admin" : "navv2.nowork.hint")}</p>
    </div>
  );
}
