"use client";

import { BadgeCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * «إشارة التوثيق» (S5.5): the ONE small check badge that sits next to a person's name — chat rows, the conversation's header, bubbles, the «@» list, the people
 * dock, the members' lists. Its accessible name is «موثّق» everywhere. It is only a mark: it says nothing about rank or permissions, and the server never sends
 * it to a guest, so there is nothing to hide here. Draw it only when the DTO says `verified` (a yes / no, never a time).
 */
export function VerifiedBadge({ className, label }: { className?: string; /** the accessible name; the dictionary's «موثّق» when absent */ label?: string }) {
  const { t } = useI18n();
  const name = label ?? t("verified.name");
  return (
    <span data-verified-badge role="img" aria-label={name} title={name} className={cn("inline-flex shrink-0 items-center align-middle text-accent", className)}>
      <BadgeCheck className="size-4" aria-hidden="true" />
    </span>
  );
}
