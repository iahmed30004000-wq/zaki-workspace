import Link from "next/link";
import type { ServerT } from "@/lib/i18n/server";
import { panelHref, scopeChipOf, type PanelScope, type PanelSectionKey } from "@/lib/control-panel";
import { cn } from "@/lib/utils";

/**
 * «لوحة التحكم» — the frame of the ONE panel (A2.1, switch `controlPanelV2`): a title, a side list of the sections the person may open, and the section.
 * The list is plain links (no script): a section is an address, `/owner?s=<section>`. Every section has ONE name for everybody (`cpv2.section.<key>`); the person only
 * sees fewer of them. The scope chip is the small label drawn next to a number: «كل الشركة» or «مساحة: X».
 */

export function ScopeChip({ t, scope, className }: { t: ServerT; scope: PanelScope; className?: string }) {
  const chip = scopeChipOf(scope);
  return (
    <span data-scope className={cn("inline-flex items-center rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs text-fg-muted", className)}>
      {t(chip.key, chip.params)}
    </span>
  );
}

/** The chip's words only (the KPI cards draw their own small label). */
export const scopeText = (t: ServerT, scope: PanelScope): string => {
  const chip = scopeChipOf(scope);
  return t(chip.key, chip.params);
};

/**
 * `oneNav` (S3.2, the switch `settingsOneDoor`): the panel is its own place and this list is its ONE navigation (the six entries `PANEL_ONE_NAV`, named by `cpone.nav.<key>`). Left out, the list is
 * the eleven-section list of the panel inside the administration, exactly as it was.
 */
export function PanelFrame({ t, sections, current, notice, oneNav = false, children }: { t: ServerT; sections: readonly PanelSectionKey[]; current: PanelSectionKey; notice?: string; oneNav?: boolean; children: React.ReactNode }) {
  // S3.3: «الأرشيف» is called «الأرشيف» in the one navigation (the same word as the menu's tab), not «الأرشيف والرقابة»
  const nameOf = (key: PanelSectionKey) => t(oneNav ? (key === "archive" ? "cpv2.dd.nav.archive" : `cpone.nav.${key}`) : `cpv2.section.${key}`);
  return (
    <div dir="rtl" className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6" data-panel-v2 {...(oneNav ? { "data-panel-one": "" } : {})} data-section={current}>
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{t("cp.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t(oneNav ? "cpone.subtitle" : "cpv2.subtitle")}</p>
      </header>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <nav aria-label={t(oneNav ? "cpone.nav.label" : "cpv2.nav.label")} className="md:sticky md:top-4 md:w-56 md:shrink-0" data-testid="cp-side-list">
          <ul className="strip-scroll flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
            {sections.map((key) => (
              <li key={key} className="shrink-0 md:shrink">
                <Link
                  href={panelHref(key)}
                  data-panel-section={key}
                  aria-current={key === current ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 w-full items-center rounded-lg border px-3 text-sm md:min-h-9",
                    key === current ? "border-accent bg-accent/10 font-medium text-fg" : "border-border bg-surface-1 text-fg-muted hover:bg-surface-2",
                  )}
                >
                  {nameOf(key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 flex-1 space-y-4" data-panel-body>
          {notice ? (
            <p className="rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn" role="status">
              {notice}
            </p>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}

/** The title of a section: its name (the same for everybody), an optional line under it and the scope chip when the section shows numbers. */
export function SectionHeader({ t, section, hint, scope, title }: { t: ServerT; section: PanelSectionKey; hint?: string; scope?: PanelScope; title?: string }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-2" data-section-header={section}>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight">{title ?? t(`cpv2.section.${section}`)}</h2>
        {hint ? <p className="mt-0.5 text-xs leading-5 text-fg-muted">{hint}</p> : null}
      </div>
      {scope ? <ScopeChip t={t} scope={scope} /> : null}
    </header>
  );
}

/** The parts of a section that has parts («التكاملات», «الهيكل والتطوير»): links, the current one marked. */
export function PartNav({ label, parts }: { label: string; parts: readonly { key: string; href: string; name: string; current: boolean }[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-2" data-testid="cp-parts">
      {parts.map((part) => (
        <Link
          key={part.key}
          href={part.href}
          data-panel-part={part.key}
          aria-current={part.current ? "page" : undefined}
          className={cn("inline-flex min-h-11 items-center rounded-full border px-4 text-sm md:min-h-9", part.current ? "border-accent bg-accent/10 font-medium text-fg" : "border-border bg-surface-1 text-fg-muted hover:bg-surface-2")}
        >
          {part.name}
        </Link>
      ))}
    </nav>
  );
}
