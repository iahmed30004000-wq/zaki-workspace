"use client";

import * as React from "react";
import Link from "next/link";
import { ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { CURRENCIES, formatMinor, formatQty } from "@/lib/manufacturing/shared";

/** The reason a request was refused, as the sentence the person reads (the server's key, or the first field issue that has a sentence). */
export function mfgErrorText(t: (key: string) => string, err: unknown): string {
  if (err instanceof ApiError) {
    const key = err.messageKey ?? err.code;
    const text = t(key);
    if (text !== key) return text;
    const issues = Array.isArray(err.details) ? (err.details as Array<{ message?: string }>) : [];
    for (const issue of issues) {
      const hit = issue.message ? t(issue.message) : "";
      if (hit && hit !== issue.message) return hit;
    }
  }
  return t("common.error");
}

/**
 * The two tabs of a manufacturing space: «اللوحات» and «مخزون التصنيع». It is drawn only for a person who may open both (the page decides:
 * the viewer holds `manufacturing.view`, the feature is on, and it is a manufacturing space). It is not a place of the menu.
 */
export function MfgTabs({ current }: { current: "cards" | "stock" }) {
  const { t } = useI18n();
  const items = [
    { key: "cards", href: "/cards", label: t("nav.place.cards") },
    { key: "stock", href: "/manufacturing", label: t("nav.tab.mfg") },
  ] as const;
  return (
    <nav aria-label={t("mfg.tabs_label")} className="flex shrink-0 gap-1 border-b border-border">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === current ? "page" : undefined}
          className={cn(
            "inline-flex h-11 items-center whitespace-nowrap rounded-t-lg px-3 text-sm transition-colors",
            item.key === current ? "border-b-2 border-accent font-semibold text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** The honest note under the title: this records stock and cost, it is not accounting. ⚠️ with its 🔧 under it. */
export function NotAccountingNote() {
  const { t } = useI18n();
  return (
    <div role="note" className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-fg">
      <p className="font-medium">⚠️ {t("mfg.not_accounting")}</p>
      <p className="mt-1 text-fg-muted">🔧 {t("mfg.not_accounting_fix")}</p>
    </div>
  );
}

/** The Arabic name of a currency code (never the bare code on a screen). */
export function useCurrencyName(): (code: string | null | undefined) => string {
  const { t } = useI18n();
  return (code) => (code ? (t(`mfg.cur.${code}`) !== `mfg.cur.${code}` ? t(`mfg.cur.${code}`) : code) : "");
}

export const CURRENCY_CODES = Object.keys(CURRENCIES);

/** «12.500 دينار»: a money amount with its currency's Arabic name. */
export function Money({ minor, currency }: { minor: number; currency: string }) {
  const name = useCurrencyName();
  return (
    <span dir="ltr" className="tabular-nums">
      {formatMinor(minor, currency)} <span dir="rtl">{name(currency)}</span>
    </span>
  );
}

/** A quantity with the unit written after it: «72 علبة». */
export function Qty({ micro, unit, className }: { micro: number; unit: string; className?: string }) {
  return (
    <span className={cn("tabular-nums", className)}>
      <span dir="ltr">{formatQty(micro)}</span> {unit}
    </span>
  );
}

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block text-xs text-fg-muted", className)}>
      <span className="mb-1 block font-medium">{label}</span>
      {children}
    </label>
  );
}

export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-fg">{children}</h2>
      {aside}
    </div>
  );
}
