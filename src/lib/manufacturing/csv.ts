/**
 * «مخزون التصنيع» — the CSV files, PURE: they take what the viewer was already given (`MfgOverview`, `MaterialDetail`) and nothing else, so a
 * file can never carry more than the screen does. Without `manufacturing.cost` those objects hold no cost, so these files hold none: not a
 * hidden column, no column.
 *
 * UTF-8 with a byte order mark, Arabic headings, CRLF rows (`toCsv`), every cell that starts with = + - @ made safe (`csvCell`). A signed number
 * would begin with «-» and be turned into text by that rule, so quantities and values are written as two columns, «داخل» and «خارج», each unsigned.
 */
import { toCsv } from "@/lib/time-tracking";
import { averageText, formatMinor, formatQty } from "./shared";
import type { MaterialDetail, MfgOverview } from "./view";
import type { ReportKind, ReportsView } from "./production-view";

type Say = (key: string) => string;

/** Quantity of a signed micro-quantity as the «in» and «out» cells. */
function inOut(micro: number): [string, string] {
  return micro >= 0 ? [formatQty(micro), ""] : ["", formatQty(-micro)];
}

function valueInOut(minor: number, currency: string): [string, string] {
  return minor >= 0 ? [formatMinor(minor, currency), ""] : ["", formatMinor(-minor, currency)];
}

/** The materials of the space: balance and low-stock mark, and, for whoever holds the cost, the value and the weighted average. */
export function materialsCsv(overview: Pick<MfgOverview, "materials" | "canCost">, t: Say): string {
  const head = [t("mfg.csv.material"), t("mfg.csv.code"), t("mfg.csv.base_unit"), t("mfg.csv.balance"), t("mfg.csv.low_stock"), t("mfg.csv.status")];
  if (overview.canCost) head.push(t("mfg.csv.currency"), t("mfg.csv.value"), t("mfg.csv.average"));
  const rows = overview.materials.map((m) => {
    const row: string[] = [
      m.name,
      m.code ?? "",
      m.baseUnit,
      formatQty(m.balanceMicro),
      m.lowStockMicro === null ? "" : formatQty(m.lowStockMicro),
      m.archived ? t("mfg.csv.archived") : m.low ? t("mfg.csv.low") : t("mfg.csv.ok"),
    ];
    if (overview.canCost) {
      const cost = m.cost;
      row.push(cost?.currency ?? "", cost?.currency ? formatMinor(cost.valueMinor, cost.currency) : "", cost?.averageText ?? "");
    }
    return row;
  });
  return toCsv([head, ...rows]);
}

/** One material's movements, newest first as the screen has them. */
export function movementsCsv(detail: Pick<MaterialDetail, "name" | "baseUnit" | "movements" | "canCost" | "cost">, t: Say): string {
  const head = [t("mfg.csv.date"), t("mfg.csv.material"), t("mfg.csv.kind"), t("mfg.csv.in"), t("mfg.csv.out"), t("mfg.csv.unit"), t("mfg.csv.reason"), t("mfg.csv.by")];
  const currency = detail.cost?.currency ?? null;
  const withCost = detail.canCost && currency !== null;
  if (withCost) head.push(t("mfg.csv.currency"), t("mfg.csv.value_in"), t("mfg.csv.value_out"));
  const rows = detail.movements.map((m) => {
    const [qin, qout] = inOut(m.qtyMicro);
    const row: string[] = [m.createdAt.slice(0, 10), detail.name, t(`mfg.kind.${m.kind}`), qin, qout, detail.baseUnit, m.reason ?? "", m.createdBy];
    if (withCost && currency) {
      const [vin, vout] = m.valueMinor === null ? ["", ""] : valueInOut(m.valueMinor, currency);
      row.push(currency, vin, vout);
    }
    return row;
  });
  return toCsv([head, ...rows]);
}

/** The lots of one material (the receipts), with the prices only for whoever holds the cost. */
export function lotsCsv(detail: Pick<MaterialDetail, "name" | "baseUnit" | "lots" | "canCost">, t: Say): string {
  const head = [t("mfg.csv.received_on"), t("mfg.csv.expires_on"), t("mfg.csv.material"), t("mfg.csv.qty_base"), t("mfg.csv.unit"), t("mfg.csv.supplier"), t("mfg.csv.proof"), t("mfg.csv.by")];
  if (detail.canCost) head.push(t("mfg.csv.currency"), t("mfg.csv.unit_cost"), t("mfg.csv.total"), t("mfg.csv.average"));
  const rows = detail.lots.map((l) => {
    const row: string[] = [l.receivedOn, l.expiresOn ?? "", detail.name, formatQty(l.qtyMicro), detail.baseUnit, l.supplier?.name ?? "", l.proof ? t("mfg.csv.proof_photo") : (l.proofNote ?? ""), l.createdBy];
    if (detail.canCost) {
      const cost = l.cost;
      row.push(
        cost?.currency ?? "",
        cost ? formatMinor(cost.unitCostMinor, cost.currency) : "",
        cost ? formatMinor(cost.totalCostMinor, cost.currency) : "",
        cost ? (averageText(BigInt(cost.totalCostMinor), BigInt(l.qtyMicro), cost.currency) ?? "") : "",
      );
    }
    return row;
  });
  return toCsv([head, ...rows]);
}

// ───────────────────────────────────────── the reports (slice 2) ─────────────────────────────────────────

/** Valuation: the balance and the stock without a price for everybody; the value and the average (and a total per currency) only for the cost holder. */
function valuationCsv(report: ReportsView, t: Say): string {
  const head = [t("mfg.csv.material"), t("mfg.csv.base_unit"), t("mfg.csv.balance"), t("mfg.csv.unpriced_qty")];
  if (report.canCost) head.push(t("mfg.csv.currency"), t("mfg.csv.value"), t("mfg.csv.average"));
  const rows = report.valuation.map((r) => {
    const row: string[] = [r.name, r.baseUnit, formatQty(r.qtyMicro), r.unpricedMicro > 0 ? formatQty(r.unpricedMicro) : ""];
    if (report.canCost) row.push(r.cost?.currency ?? "", r.cost ? formatMinor(r.cost.valueMinor, r.cost.currency) : "", r.cost?.averageText ?? "");
    return row;
  });
  if (report.canCost && report.valuationTotals) {
    for (const total of report.valuationTotals) rows.push([t("mfg.csv.total_row"), "", "", "", total.currency, formatMinor(total.valueMinor, total.currency), ""]);
  }
  return toCsv([head, ...rows]);
}

function consumptionCsv(report: ReportsView, t: Say): string {
  const head = [t("mfg.csv.material"), t("mfg.csv.base_unit"), t("mfg.csv.consumed"), t("mfg.csv.via_orders"), t("mfg.csv.from"), t("mfg.csv.to")];
  if (report.canCost) head.push(t("mfg.csv.currency"), t("mfg.csv.cost"), t("mfg.csv.cost_status"));
  const rows = report.consumption.map((r) => {
    const row: string[] = [r.name, r.baseUnit, formatQty(r.qtyMicro), formatQty(r.viaOrdersMicro), report.period.from, report.period.to];
    if (report.canCost) row.push(r.cost?.currency ?? "", r.cost && r.cost.currency ? formatMinor(r.cost.totalMinor, r.cost.currency) : "", r.cost ? t(r.cost.incomplete ? "mfg.csv.incomplete" : "mfg.csv.complete") : "");
    return row;
  });
  return toCsv([head, ...rows]);
}

function ordersCsv(report: ReportsView, t: Say): string {
  const head = [t("mfg.csv.order_no"), t("mfg.csv.recipe"), t("mfg.csv.status"), t("mfg.csv.planned"), t("mfg.csv.actual"), t("mfg.csv.unit"), t("mfg.csv.date")];
  if (report.canCost) head.push(t("mfg.csv.cost_status"), t("mfg.csv.currency"), t("mfg.csv.total"), t("mfg.csv.per_unit"));
  const rows: string[][] = [];
  for (const o of report.orders) {
    const base: string[] = [String(o.seq), o.recipeName, t(`mfg.order_status.${o.status}`), formatQty(o.plannedMicro), o.actualMicro === null ? "" : formatQty(o.actualMicro), o.outputUnit, o.day];
    if (!report.canCost) {
      rows.push(base);
      continue;
    }
    const status = t(o.costIncomplete ? "mfg.csv.incomplete" : "mfg.csv.complete");
    const totals = o.cost?.totals ?? [];
    if (totals.length === 0) rows.push([...base, status, "", "", ""]);
    for (const total of totals) rows.push([...base, status, total.currency, formatMinor(total.totalMinor, total.currency), total.perUnitText ?? ""]);
  }
  return toCsv([head, ...rows]);
}

function lowCsv(report: ReportsView, t: Say): string {
  const head = [t("mfg.csv.material"), t("mfg.csv.base_unit"), t("mfg.csv.balance"), t("mfg.csv.low_stock")];
  return toCsv([head, ...report.low.map((r) => [r.name, r.baseUnit, formatQty(r.qtyMicro), formatQty(r.lowStockMicro)])]);
}

/** One report as a CSV file: built from the object the viewer already reads, so without `manufacturing.cost` it has no price column. */
export function reportCsv(kind: ReportKind, report: ReportsView, t: Say): string {
  if (kind === "valuation") return valuationCsv(report, t);
  if (kind === "consumption") return consumptionCsv(report, t);
  if (kind === "orders") return ordersCsv(report, t);
  return lowCsv(report, t);
}
