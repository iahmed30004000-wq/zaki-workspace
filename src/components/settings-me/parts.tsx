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

/**
 * A block of one setting, drawn as the owner's mockup draws a settings list: the title is a small accent heading above, its one line under it, then the
 * controls sit in a soft 14 px card. `rows` is for a block made of whole-row controls (switches, links): they touch the card's edges and a thin line
 * separates them; without it the content gets the card's own padding.
 */
export function Group({ title, hint, children, className, id, rows = false }: { title?: string; hint?: string; children: React.ReactNode; className?: string; id?: string; rows?: boolean }) {
  return (
    <section id={id} data-settings-group="" className={cn("px-3 pt-4 md:px-0", className)}>
      {title ? <h2 className="px-1 pb-1.5 text-[13px] font-bold text-accent">{title}</h2> : null}
      {hint ? <p className="px-1 pb-2 text-[13px] leading-[1.45] text-fg-muted">{hint}</p> : null}
      <div className={cn("min-w-0 rounded-[14px] bg-surface-1", rows ? "overflow-hidden [&>*+*]:border-t [&>*+*]:border-border" : "px-3.5 py-3")}>{children}</div>
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
