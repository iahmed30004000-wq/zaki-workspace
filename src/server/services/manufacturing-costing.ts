import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { positionOf, type LotFacts, type Position } from "@/lib/manufacturing/costing";

/**
 * «مخزون التصنيع» — reads the lots and movements of a material and turns them into its POSITION (balance, value of what has a price, the
 * stock that has none, and the lots as first-in-first-out layers). The arithmetic is in `@/lib/manufacturing/costing` (pure, tested alone);
 * this file only fetches the rows. It runs on a transaction client too, so a writer reads the position under the same row lock it writes under.
 */

type Client = Prisma.TransactionClient | typeof db;

const LOT_SELECT = {
  id: true,
  materialId: true,
  qtyMicro: true,
  totalCostMinor: true,
  unitCostMinor: true,
  currency: true,
  costPending: true,
  receivedOn: true,
  createdAt: true,
  costing: { select: { totalCostMinor: true, unitCostMinor: true, currency: true } },
} satisfies Prisma.MaterialLotSelect;

export type LotRow = Prisma.MaterialLotGetPayload<{ select: typeof LOT_SELECT }>;

/** The price a lot has, wherever it came from: the receipt, or the costing filled in later. Null while it is pending. */
export function effectiveCost(lot: Pick<LotRow, "costPending" | "totalCostMinor" | "unitCostMinor" | "currency" | "costing">): { totalMinor: bigint; unitMinor: bigint; currency: string } | null {
  if (!lot.costPending) return { totalMinor: lot.totalCostMinor, unitMinor: lot.unitCostMinor, currency: lot.currency };
  return lot.costing ? { totalMinor: lot.costing.totalCostMinor, unitMinor: lot.costing.unitCostMinor, currency: lot.costing.currency } : null;
}

const byAge = (a: LotRow, b: LotRow): number => a.receivedOn.getTime() - b.receivedOn.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);

function factsOf(lots: readonly LotRow[], flows: ReadonlyMap<string, { qty: bigint; value: bigint }>): LotFacts[] {
  return [...lots].sort(byAge).map((lot) => {
    const cost = effectiveCost(lot);
    const flow = flows.get(lot.id);
    return {
      id: lot.id,
      qtyMicro: lot.qtyMicro,
      totalMinor: cost ? cost.totalMinor : null,
      lateCosted: lot.costPending && lot.costing !== null,
      flowQtyMicro: flow?.qty ?? 0n,
      flowValueMinor: flow?.value ?? 0n,
    };
  });
}

/** The last PRICED lot written (the price a manual increase falls back on when nothing is in stock). */
function lastPricedLot(lots: readonly LotRow[]): { qtyMicro: bigint; totalCostMinor: bigint } | null {
  const priced = lots.filter((l) => effectiveCost(l) !== null).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
  const last = priced[0];
  const cost = last ? effectiveCost(last) : null;
  return last && cost ? { qtyMicro: last.qtyMicro, totalCostMinor: cost.totalMinor } : null;
}

export interface MaterialPosition {
  position: Position;
  lots: LotRow[];
  lastPriced: { qtyMicro: bigint; totalCostMinor: bigint } | null;
}

/** One material's position. Inside a transaction, call it after the material's row is locked. */
export async function loadPosition(client: Client, materialId: string): Promise<MaterialPosition> {
  const lots = await client.materialLot.findMany({ where: { materialId }, select: LOT_SELECT });
  const flowRows = await client.materialMovement.groupBy({ by: ["lotId"], where: { materialId, lotId: { not: null } }, _sum: { qtyMicro: true, valueMinor: true } });
  const unlotted = await client.materialMovement.aggregate({ where: { materialId, lotId: null }, _sum: { qtyMicro: true, valueMinor: true } });
  const flows = new Map(flowRows.flatMap((r) => (r.lotId ? [[r.lotId, { qty: r._sum.qtyMicro ?? 0n, value: r._sum.valueMinor ?? 0n }] as const] : [])));
  const position = positionOf(factsOf(lots, flows), { qtyMicro: unlotted._sum.qtyMicro ?? 0n, valueMinor: unlotted._sum.valueMinor ?? 0n });
  return { position, lots, lastPriced: lastPricedLot(lots) };
}

/** The position of every material of a space, in three queries (the front page, the reports). */
export async function loadSpacePositions(orgId: string, spaceId: string): Promise<Map<string, Position>> {
  const [lots, flowRows, unlottedRows] = await Promise.all([
    db.materialLot.findMany({ where: { orgId, workspaceId: spaceId }, select: LOT_SELECT }),
    db.materialMovement.groupBy({ by: ["lotId"], where: { orgId, workspaceId: spaceId, lotId: { not: null } }, _sum: { qtyMicro: true, valueMinor: true } }),
    db.materialMovement.groupBy({ by: ["materialId"], where: { orgId, workspaceId: spaceId, lotId: null }, _sum: { qtyMicro: true, valueMinor: true } }),
  ]);
  const flows = new Map(flowRows.flatMap((r) => (r.lotId ? [[r.lotId, { qty: r._sum.qtyMicro ?? 0n, value: r._sum.valueMinor ?? 0n }] as const] : [])));
  const unlotted = new Map(unlottedRows.map((r) => [r.materialId, { qtyMicro: r._sum.qtyMicro ?? 0n, valueMinor: r._sum.valueMinor ?? 0n }] as const));
  const lotsOf = new Map<string, LotRow[]>();
  for (const lot of lots) lotsOf.set(lot.materialId, [...(lotsOf.get(lot.materialId) ?? []), lot]);
  const out = new Map<string, Position>();
  const materialIds = new Set([...lotsOf.keys(), ...unlotted.keys()]);
  for (const id of materialIds) out.set(id, positionOf(factsOf(lotsOf.get(id) ?? [], flows), unlotted.get(id) ?? { qtyMicro: 0n, valueMinor: 0n }));
  return out;
}

/** The lots with these ids (any material), with their costing: what an order's cost is read from. */
export async function loadLotsByIds(client: Client, ids: readonly string[]): Promise<Map<string, LotRow>> {
  if (ids.length === 0) return new Map();
  const lots = await client.materialLot.findMany({ where: { id: { in: [...ids] } }, select: LOT_SELECT });
  return new Map(lots.map((l) => [l.id, l] as const));
}

/** A material with nothing written yet. */
export const EMPTY_POSITION: Position = positionOf([], { qtyMicro: 0n, valueMinor: 0n });
