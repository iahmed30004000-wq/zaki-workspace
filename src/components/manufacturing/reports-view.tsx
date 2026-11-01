"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { fmtDMY } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { formatQty } from "@/lib/manufacturing/shared";
import type { ReportKind, ReportsView } from "@/lib/manufacturing/production-view";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, MfgTabs, Money, NotAccountingNote, Qty, SectionTitle } from "./ui";

/**
 * «تقارير» — read only. Quantities for everybody who may view; money (value, average, cost) only for a holder of `manufacturing.cost`: the server leaves
 * every money field out of the answer for anybody else, and the CSV next to each report is built from the same answer, so it has no price column either.
 */
export function ReportsPage({ initial }: { initial: ReportsView }) {
  const { t } = useI18n();
  const router = useRouter();
  const [from, setFrom] = React.useState(initial.period.from);
  const [to, setTo] = React.useState(initial.period.to);
  React.useEffect(() => {
    setFrom(initial.period.from);
    setTo(initial.period.to);
  }, [initial.period.from, initial.period.to]);
  const r = initial;
  const csv = (kind: ReportKind) => `/api/manufacturing/reports/csv?spaceId=${encodeURIComponent(r.spaceId)}&report=${kind}&from=${r.period.from}&to=${r.period.to}`;
  const link = (kind: ReportKind) => (
    <a href={csv(kind)} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
      <Download className="size-3.5" aria-hidden />
      {t("mfg.csv")}
    </a>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4">
      <MfgTabs current="stock" sub="reports" />
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">{t("mfg.reports_title")}</h1>
        <p className="text-xs text-fg-muted">{t("mfg.reports_subtitle", { space: r.spaceName })}</p>
      </header>
      <NotAccountingNote />
      {!r.canCost ? <p className="text-xs text-fg-muted">{t("mfg.report_no_money")}</p> : null}

      <form
        className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface-1 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/manufacturing/reports?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
        }}
      >
        <Field label={t("mfg.report_from")}>
          <Input type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} required />
        </Field>
        <Field label={t("mfg.report_to")}>
          <Input type="date" dir="ltr" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} required />
        </Field>
        <Button type="submit" size="sm">
          {t("mfg.report_show")}
        </Button>
        <p className="w-full text-xs text-fg-muted">{t("mfg.report_period_hint")}</p>
      </form>

      <section className="space-y-2" aria-label={t("mfg.report.valuation")}>
        <SectionTitle aside={link("valuation")}>{t("mfg.report.valuation")}</SectionTitle>
        <p className="text-xs text-fg-muted">{t(r.canCost ? "mfg.report_valuation_hint" : "mfg.report_valuation_hint_qty")}</p>
        {r.valuation.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("mfg.report_none")}</p>
        ) : (
          <ul className="grid gap-1">
            {r.valuation.map((v) => (
              <li key={v.materialId} className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="min-w-0 flex-1 font-medium text-fg">{v.name}</span>
                  <Qty micro={v.qtyMicro} unit={v.baseUnit} className="font-semibold text-fg" />
                  {v.cost ? (
                    <span className="text-xs text-fg-muted">
                      {t("mfg.value")}: <Money minor={v.cost.valueMinor} currency={v.cost.currency} />
                    </span>
                  ) : null}
                </div>
                {v.cost?.formula ? (
                  <p className="mt-1 text-xs text-fg-muted">
                    {t("mfg.formula")}: <span dir="ltr">{v.cost.formula.value}</span> ÷ <span dir="ltr">{v.cost.formula.qty}</span> = <span dir="ltr">{v.cost.formula.average}</span>
                  </p>
                ) : null}
                {v.unpricedMicro > 0 ? (
                  <p className="mt-1 text-xs text-warn">
                    ⚠️ {t("mfg.report_unpriced", { qty: formatQty(v.unpricedMicro), unit: v.baseUnit })} · 🔧 {t("mfg.report_unpriced_fix")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {r.valuationTotals && r.valuationTotals.length > 0 ? (
          <ul className="grid gap-1 text-sm font-semibold text-fg">
            {r.valuationTotals.map((total) => (
              <li key={total.currency}>
                {t("mfg.report_total")}: <Money minor={total.valueMinor} currency={total.currency} />
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-2" aria-label={t("mfg.report.consumption")}>
        <SectionTitle aside={link("consumption")}>{t("mfg.report.consumption")}</SectionTitle>
        <p className="text-xs text-fg-muted">{t("mfg.report_consumption_hint", { from: fmtDMY(r.period.from), to: fmtDMY(r.period.to) })}</p>
        {r.consumption.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("mfg.report_none")}</p>
        ) : (
          <ul className="grid gap-1">
            {r.consumption.map((c) => (
              <li key={c.materialId} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 font-medium text-fg">{c.name}</span>
                <Qty micro={c.qtyMicro} unit={c.baseUnit} className="font-semibold text-fg" />
                <span className="text-xs text-fg-muted">
                  {t("mfg.report_via_orders")}: <Qty micro={c.viaOrdersMicro} unit={c.baseUnit} />
                </span>
                {c.cost && c.cost.currency ? (
                  <span className="text-xs text-fg-muted">
                    {t("mfg.report_cost")}: <Money minor={c.cost.totalMinor} currency={c.cost.currency} />
                  </span>
                ) : null}
                {c.cost?.incomplete ? <Badge className="border-warn/40 bg-warn/10 text-fg">⚠️ {t("mfg.order_cost_incomplete_badge")}</Badge> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2" aria-label={t("mfg.report.orders")}>
        <SectionTitle aside={link("orders")}>{t("mfg.report.orders")}</SectionTitle>
        <p className="text-xs text-fg-muted">{t("mfg.report_orders_hint")}</p>
        {r.orders.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("mfg.report_none")}</p>
        ) : (
          <ul className="grid gap-1">
            {r.orders.map((o) => (
              <li key={o.orderId} className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium text-fg">{t("mfg.order_n", { n: o.seq })}</span>
                  <span className="text-fg">{o.recipeName}</span>
                  <Badge>{t(`mfg.order_status.${o.status}`)}</Badge>
                  <span className="flex-1" />
                  <Qty micro={o.actualMicro ?? o.plannedMicro} unit={o.outputUnit} />
                  {o.costIncomplete ? <Badge className="border-warn/40 bg-warn/10 text-fg">⚠️ {t("mfg.order_cost_incomplete_badge")}</Badge> : null}
                </div>
                {o.cost
                  ? o.cost.totals.map((total) => (
                      <p key={total.currency} className="mt-1 text-xs text-fg-muted">
                        {t("mfg.order_cost_total")}: <Money minor={total.totalMinor} currency={total.currency} />
                        {total.perUnitText !== null ? (
                          <>
                            {" · "}
                            {t("mfg.order_cost_per_unit", { unit: o.outputUnit })}: <span dir="ltr">{total.perUnitText}</span>
                          </>
                        ) : null}
                      </p>
                    ))
                  : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2" aria-label={t("mfg.report.low")}>
        <SectionTitle aside={link("low")}>{t("mfg.report.low")}</SectionTitle>
        <p className="text-xs text-fg-muted">{t("mfg.report_low_hint")}</p>
        {r.low.length === 0 ? (
          <p className="text-sm text-fg-muted">{t("mfg.report_low_none")}</p>
        ) : (
          <ul className="grid gap-1">
            {r.low.map((l) => (
              <li key={l.materialId} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 font-medium text-fg">⚠️ {l.name}</span>
                <Qty micro={l.qtyMicro} unit={l.baseUnit} className="font-semibold text-fg" />
                <span className="text-xs text-fg-muted">
                  {t("mfg.report_threshold")}: <Qty micro={l.lowStockMicro} unit={l.baseUnit} />
                </span>
                <span className="w-full text-xs text-fg-muted">🔧 {t("mfg.low_fix_short")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
