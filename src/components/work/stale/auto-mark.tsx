"use client";

import { Bot } from "lucide-react";
import { useI18n } from "@/lib/i18n";

/**
 * «آلي» — the small mark on a task that came in through the door from another system or an agent (`Task.apiTokenId` is set; W1.9, D-W4). It says what
 * the task is, never hides it: the owner decides later whether such tasks stay in people's lists and numbers (D-W4 is pending).
 */
export function AutoMark() {
  const { t } = useI18n();
  return (
    <span
      title={t("stale.auto.mark_hint")}
      aria-label={`${t("stale.auto.mark")}: ${t("stale.auto.mark_hint")}`}
      data-auto-mark
      className="inline-flex shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-fg-muted"
    >
      <Bot className="h-3 w-3" aria-hidden />
      {t("stale.auto.mark")}
    </span>
  );
}
