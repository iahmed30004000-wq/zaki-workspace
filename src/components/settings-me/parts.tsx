"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { sectionHintKey, sectionLabelKey, SETTINGS_ME_HREF, type SectionKey } from "@/components/settings-me/sections";

/** The head of a section: «رجوع» on the phone (the section is a pushed screen there), then its name and its one line. */
export function SectionHead({ section }: { section: SectionKey }) {
  const { t } = useI18n();
  return (
    <header className="px-3 pb-3 pt-3 md:px-0 md:pt-0">
      <Link href={SETTINGS_ME_HREF} className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm text-accent md:hidden">
        <ChevronRight aria-hidden="true" className="size-4" />
        {t("settingsMe.back")}
      </Link>
      <h1 className="text-xl font-semibold text-fg">{t(sectionLabelKey(section))}</h1>
      <p className="mt-0.5 text-[13px] text-fg-muted">{t(sectionHintKey(section))}</p>
    </header>
  );
}

/** A block of one setting: a title, its one line, then the control. Flat (a divider, no card). */
export function Group({ title, hint, children, className, id }: { title?: string; hint?: string; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("border-t border-border px-3 py-4 md:px-0", className)}>
      {title ? <h2 className="text-[15px] font-semibold text-fg">{title}</h2> : null}
      {hint ? <p className="mt-0.5 text-[13px] leading-[1.45] text-fg-muted">{hint}</p> : null}
      <div className={cn(title || hint ? "mt-3" : "")}>{children}</div>
    </section>
  );
}

/** A risk is shown as ⚠️ with its fix as 🔧 under it, always together (AGENTS.md). */
export function WarnFix({ warn, fix, className }: { warn: string; fix: string; className?: string }) {
  return (
    <div role="note" data-warn-fix="" className={cn("space-y-1 rounded-xl border border-dashed border-border px-3 py-2 text-sm", className)}>
      <p className="flex gap-2 text-fg">
        <span aria-hidden="true">⚠️</span>
        <span>{warn}</span>
      </p>
      <p className="flex gap-2 text-fg-muted">
        <span aria-hidden="true">🔧</span>
        <span>{fix}</span>
      </p>
    </div>
  );
}

/** Says where a choice lives: on this device only, or on the account (it follows the person). */
export function Scope({ device }: { device?: boolean }) {
  const { t } = useI18n();
  return <p className="mt-1.5 text-xs text-fg-muted">{device ? t("settingsMe.device_only") : t("settingsMe.account_wide")}</p>;
}
