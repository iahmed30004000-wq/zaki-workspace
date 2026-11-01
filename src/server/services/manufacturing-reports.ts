import { z } from "zod";
import { db } from "@/server/db";
import { ValidationError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import { averageFormula, averageText, isDayText, isLow, toSafeNumber } from "@/lib/manufacturing/shared";
import { costOfPieces, type CostPiece } from "@/lib/manufacturing/costing";
import type { ConsumptionRow, LowStockRow, OrderCostRow, ReportsView, ValuationRow } from "@/lib/manufacturing/production-view";
import { mfgScope } from "./manufacturing-access";
import { EMPTY_POSITION, effectiveCost, loadLotsByIds, loadSpacePositions } from "./manufacturing-costing";
import { ordersOf } from "./manufacturing-production";

/**
 * «مخزون التصنيع», slice 2 — the reports. READ ONLY: they add nothing to the ledger and are computed from it on every request.
 *
 *  - valuation   per material: the balance, the stock without a price, and (for a holder of `manufacturing.cost`) the value of the priced stock with
 *                the formula «القيمة ÷ الكمية = المتوسط»;
 *  - consumption per material in a period: what issues took (net of the issues that were reversed), how much of it by production orders, and
 *                (cost holders) its cost, read from the lots the stock came from — a piece without a price makes it incomplete, never guessed;
 *  - orders      per production order issued in the period: the quantities, and (cost holders) the exact cost and the cost per output unit;
 *  - low stock   the materials that have come down to their threshold.
 *
 * A person without `manufacturing.cost` reads quantities only: every money field is null on the SERVER, and the CSV is built from this object,
 * so it carries no price column at all.
 */

const num = toSafeNumber;
const DAY = 24 * 3600 * 1000;

export const reportQuerySchema = z.object({
  spaceId: z.string().min(1).max(64),
  from: z.string().optional(),
  to: z.string().optional(),
});

const bad = (path: string, message: string) => new ValidationError([{ path, message }]);

/** The period asked for (days, inclusive): by default the last 30 days; at most a year; never backwards. */
export function periodOf(from: string | undefined, to: string | undefined, now: Date = new Date()): { from: string; to: string; gte: Date; lt: Date } {
  const today = now.toISOString().slice(0, 10);
  const end = to && to !== "" ? to : today;
  if (!isDayText(end)) throw bad("to", "mfg.e.date");
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  const start = from && from !== "" ? from : new Date(endMs - 29 * DAY).toISOString().slice(0, 10);
  if (!isDayText(start)) throw bad("from", "mfg.e.date");
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  if (startMs > endMs) throw bad("from", "mfg.e.period_order");
  if (endMs - startMs > 365 * DAY) throw bad("from", "mfg.e.period_long");
  return { from: start, to: end, gte: new Date(startMs), lt: new Date(endMs + DAY) };
}

export async function readReports(actor: Actor, query: z.infer<typeof reportQuerySchema>): Promise<ReportsView> {
  const scope = await mfgScope(actor, query.spaceId);
  const period = periodOf(query.from, query.to);
  const spaceId = query.spaceId;
  const [materials, positions] = await Promise.all([
    db.material.findMany({ where: { orgId: actor.orgId, workspaceId: spaceId }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    loadSpacePositions(actor.orgId, spaceId),
  ]);
  const matById = new Map(materials.map((m) => [m.id, m] as const));

  // ── valuation
  const valuation: ValuationRow[] = materials
    .filter((m) => m.archivedAt === null || (positions.get(m.id)?.qtyMicro ?? 0n) !== 0n)
    .map((m) => {
      const pos = positions.get(m.id) ?? EMPTY_POSITION;
      const currency = m.currency;
      return {
        materialId: m.id,
        name: m.name,
        baseUnit: m.baseUnit,
        qtyMicro: num(pos.qtyMicro),
        unpricedMicro: num(pos.unpricedQtyMicro),
        cost:
          scope.canCost && currency
            ? { currency, valueMinor: num(pos.valueMinor), averageText: averageText(pos.valueMinor, pos.pricedQtyMicro, currency), formula: averageFormula(pos.valueMinor, pos.pricedQtyMicro, currency) }
            : null,
      };
    });
  let valuationTotals: ReportsView["valuationTotals"] = null;
  if (scope.canCost) {
    const sums = new Map<string, bigint>();
    for (const m of materials) {
      const pos = positions.get(m.id);
      if (pos && m.currency) sums.set(m.currency, (sums.get(m.currency) ?? 0n) + pos.valueMinor);
    }
    valuationTotals = [...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, value]) => ({ currency, valueMinor: num(value) }));
  }

  // ── consumption in the period
  const moves = await db.materialMovement.findMany({
    where: { orgId: actor.orgId, workspaceId: spaceId, createdAt: { gte: period.gte, lt: period.lt }, kind: { in: ["ISSUE", "REVERSE"] } },
    select: { id: true, materialId: true, lotId: true, kind: true, qtyMicro: true, valueMinor: true, reversesId: true },
  });
  const originals = new Map(
    (moves.some((m) => m.reversesId) ? await db.materialMovement.findMany({ where: { id: { in: moves.flatMap((m) => (m.reversesId ? [m.reversesId] : [])) } }, select: { id: true, kind: true } }) : []).map((o) => [o.id, o.kind] as const),
  );
  const counted = moves.filter((m) => m.kind === "ISSUE" || (m.reversesId !== null && originals.get(m.reversesId) === "ISSUE"));
  const orderLinked = new Set(
    (counted.length === 0 ? [] : await db.productionOrderMovement.findMany({ where: { movementId: { in: counted.map((m) => m.id) } }, select: { movementId: true } })).map((l) => l.movementId),
  );
  const lots = await loadLotsByIds(db, [...new Set(counted.flatMap((m) => (m.lotId ? [m.lotId] : [])))]);
  const perMaterial = new Map<string, { qty: bigint; viaOrders: bigint; groups: Map<string, { lotId: string | null; qty: bigint; value: bigint }> }>();
  for (const m of counted) {
    const entry = perMaterial.get(m.materialId) ?? { qty: 0n, viaOrders: 0n, groups: new Map() };
    entry.qty -= m.qtyMicro;
    if (orderLinked.has(m.id)) entry.viaOrders -= m.qtyMicro;
    const key = m.lotId ?? "";
    const g = entry.groups.get(key) ?? { lotId: m.lotId, qty: 0n, value: 0n };
    g.qty -= m.qtyMicro;
    g.value -= m.valueMinor;
    entry.groups.set(key, g);
    perMaterial.set(m.materialId, entry);
  }
  const consumption: ConsumptionRow[] = [...perMaterial.entries()]
    .flatMap(([materialId, entry]) => {
      const material = matById.get(materialId);
      if (!material || entry.qty <= 0n) return [];
      let cost: ConsumptionRow["cost"] = null;
      if (scope.canCost) {
        const pieces: CostPiece[] = [...entry.groups.values()].map((g) => {
          const lot = g.lotId ? lots.get(g.lotId) : undefined;
          const price = lot ? effectiveCost(lot) : null;
          return { currency: material.currency, qtyMicro: g.qty, lot: lot ? { qtyMicro: lot.qtyMicro, totalMinor: price ? price.totalMinor : null } : null, valueMinor: g.value };
        });
        const result = costOfPieces(pieces);
        const first = result.byCurrency[0];
        cost = { currency: first?.currency ?? material.currency, totalMinor: first ? num(first.totalMinor) : 0, incomplete: !result.complete };
      }
      return [{ materialId, name: material.name, baseUnit: material.baseUnit, qtyMicro: num(entry.qty), viaOrdersMicro: num(entry.viaOrders), cost }];
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));

  // ── orders issued in the period
  const issued = await ordersOf(scope, { issuedAt: { gte: period.gte, lt: period.lt }, status: { in: ["ISSUED", "COMPLETED"] } }, 500);
  const orders: OrderCostRow[] = issued.map((o) => ({
    orderId: o.id,
    seq: o.seq,
    status: o.status,
    recipeName: o.recipeName,
    outputUnit: o.outputUnit,
    plannedMicro: o.plannedMicro,
    actualMicro: o.actualMicro,
    day: (o.finishedAt ?? o.issuedAt ?? o.createdAt).slice(0, 10),
    costIncomplete: o.costIncomplete,
    cost: scope.canCost && o.cost ? { totals: o.cost.totals } : null,
  }));

  // ── low stock
  const low: LowStockRow[] = materials.flatMap((m) => {
    const qty = (positions.get(m.id) ?? EMPTY_POSITION).qtyMicro;
    return m.archivedAt === null && m.lowStockMicro !== null && isLow(qty, m.lowStockMicro) ? [{ materialId: m.id, name: m.name, baseUnit: m.baseUnit, qtyMicro: num(qty), lowStockMicro: num(m.lowStockMicro) }] : [];
  });

  return {
    spaceId,
    spaceName: scope.spaceName,
    canCost: scope.canCost,
    period: { from: period.from, to: period.to },
    valuation,
    valuationTotals,
    consumption,
    orders,
    low,
  };
}
