"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Crumb } from "@/components/work/project/crumbs";

/**
 * N1.5 — the trail under a place: «المساحة › المشروع › اللوحة › المهمة» on the project, its board, the list, the timeline and the task. Every crumb but the
 * last is the way back (a link); the last is the page itself (`aria-current="page"`). Logical properties only (the page is right-to-left: the arrow turns
 * with it), a long name is cut with an ellipsis and the whole trail scrolls sideways on a phone instead of wrapping into the title. Nothing is drawn for
 * an empty trail.
 */
export function Breadcrumbs({ items, className }: { items: readonly Crumb[]; className?: string }) {
  const { t } = useI18n();
  if (items.length === 0) return null;
  return (
    <nav aria-label={t("crumbs.label")} data-breadcrumbs className={className}>
      <ol className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap text-xs text-fg-muted [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((crumb, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${index}-${crumb.label}`} className="flex min-w-0 shrink-0 items-center gap-1">
              {index > 0 ? <ChevronRight aria-hidden className="size-3 shrink-0 text-muted rtl:rotate-180" /> : null}
              {crumb.href && !last ? (
                <Link href={crumb.href} className="max-w-48 truncate rounded px-1 py-0.5 hover:bg-surface-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "max-w-60 truncate px-1 py-0.5 font-medium text-fg" : "max-w-48 truncate px-1 py-0.5"}>
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
