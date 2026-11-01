import type { Prisma, ProductionOrderCostLine } from "@prisma/client";
import { db } from "@/server/db";
import { costWithShares, type CostPiece, type OrderCost, type PieceShare } from "@/lib/manufacturing/costing";
import { effectiveCost, loadLotsByIds, type LotRow } from "./manufacturing-costing";

/**
 * «مخزون التصنيع», slice 3 — what an order TOOK and what it cost, read from the ledger, and the freezing of that cost once the order is completed.
 *
 *  - an order's cost is READ from the movements it made (each piece at its lot's EFFECTIVE price: the receipt's, the first late price, or the latest
 *    correction), split over its pieces by the largest-remainder method so the pieces add up to the total exactly;
 *  - once the order is COMPLETED and that cost is complete (every piece has a price) it is FROZEN: one `ProductionOrderCostLine` per piece, written
 *    once. From then on the order reads those rows and never the lots again, so a later correction of a lot's price re-prices stock and open orders
 *    but never a finished one. ⚠️ A completed order whose cost was still incomplete keeps reading the lots until it becomes complete (the first
 *    price of its last pending lot), and is frozen then. 🔧 The screen says «الكلفة مثبّتة».
 *
 * This file only reads and writes the order's own rows; the pricing and the steps are in manufacturing-ledger.ts and manufacturing-production.ts.
 */

type Client = Prisma.TransactionClient | typeof db;
type Tx = Prisma.TransactionClient;

/** What one order holds of one line and lot, net of what it returned: an issue is negative and a return positive, so `qty` is what it holds now. */
export interface Net {
  orderId: string;
  lineId: string;
  lotId: string | null;
  qty: bigint;
  value: bigint;
  /** The movement that opened this piece (the issue); a return adds to the same piece. */
  movementId: string;
}

export async function netTaken(client: Client, orderIds: readonly string[]): Promise<Net[]> {
  const links =
    orderIds.length === 0
      ? []
      : await client.productionOrderMovement.findMany({
          where: { orderId: { in: [...orderIds] } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { orderId: true, lineId: true, movementId: true, movement: { select: { qtyMicro: true, valueMinor: true, lotId: true } } },
        });
  const net = new Map<string, Net>();
  for (const l of links) {
    const key = `${l.lineId}|${l.movement.lotId ?? ""}`;
    const cur = net.get(key) ?? { orderId: l.orderId, lineId: l.lineId, lotId: l.movement.lotId, qty: 0n, value: 0n, movementId: l.movementId };
    cur.qty -= l.movement.qtyMicro;
    cur.value -= l.movement.valueMinor;
    net.set(key, cur);
  }
  return [...net.values()];
}

/** One piece of an order's cost with everything needed to show it. */
export interface Piece {
  net: Net;
  line: { id: string; position: number; material: { currency: string | null } };
  lot: LotRow | undefined;
}

/**
 * The pieces an order holds, in ONE fixed order (the order's lines by position, then the older lot first, stock that no lot holds last, then the
 * movement): the order the cost is split in, so the same order always gives the same shares.
 */
export function orderedPieces(lines: readonly Piece["line"][], taken: readonly Net[], lots: ReadonlyMap<string, LotRow>): Piece[] {
  const byId = new Map(lines.map((l) => [l.id, l] as const));
  const out: Piece[] = [];
  for (const net of taken) {
    if (net.qty <= 0n) continue;
    const line = byId.get(net.lineId);
    if (line) out.push({ net, line, lot: net.lotId ? lots.get(net.lotId) : undefined });
  }
  const lotKey = (p: Piece): [number, number, string] => (p.lot ? [p.lot.receivedOn.getTime(), p.lot.createdAt.getTime(), p.lot.id] : [Number.MAX_SAFE_INTEGER, 0, ""]);
  return out.sort((a, b) => {
    if (a.line.position !== b.line.position) return a.line.position - b.line.position;
    const [ar, ac, ai] = lotKey(a);
    const [br, bc, bi] = lotKey(b);
    return ar - br || ac - bc || ai.localeCompare(bi) || a.net.movementId.localeCompare(b.net.movementId);
  });
}

/** The price a piece's lot has now (null while it has none, and for stock that no lot holds). */
export const priceOf = (piece: Piece) => (piece.lot ? effectiveCost(piece.lot) : null);

export function costPiecesOf(pieces: readonly Piece[]): CostPiece[] {
  return pieces.map((p) => {
    const price = priceOf(p);
    return { currency: p.line.material.currency, qtyMicro: p.net.qty, lot: p.lot ? { qtyMicro: p.lot.qtyMicro, totalMinor: price ? price.totalMinor : null } : null, valueMinor: p.net.value };
  });
}

/** The cost of these pieces and each piece's share of it. */
export function costOfOrderPieces(pieces: readonly Piece[]): { cost: OrderCost; shares: PieceShare[] } {
  return costWithShares(costPiecesOf(pieces));
}

/** What a frozen order reads: its pieces as they were written. */
export type FrozenRow = ProductionOrderCostLine;

export async function frozenCostOf(client: Client, orderIds: readonly string[]): Promise<Map<string, FrozenRow[]>> {
  const rows = orderIds.length === 0 ? [] : await client.productionOrderCostLine.findMany({ where: { orderId: { in: [...orderIds] } }, orderBy: [{ position: "asc" }, { id: "asc" }] });
  const out = new Map<string, FrozenRow[]>();
  for (const r of rows) out.set(r.orderId, [...(out.get(r.orderId) ?? []), r]);
  return out;
}

/**
 * Freezes one COMPLETED order's cost if it is complete now and not frozen yet. Returns whether it wrote the rows. Call it inside the transaction that
 * changes what the order would read (the completion; a price being filled in; just BEFORE a price is corrected), under the material's row lock.
 */
export async function freezeOrderCost(tx: Tx, orderId: string): Promise<boolean> {
  const order = await tx.productionOrder.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, lines: { orderBy: { position: "asc" }, select: { id: true, position: true, material: { select: { currency: true } } } } },
  });
  if (!order || order.status !== "COMPLETED") return false;
  if ((await tx.productionOrderCostLine.count({ where: { orderId } })) > 0) return false;
  const taken = await netTaken(tx, [orderId]);
  const lots = await loadLotsByIds(tx, [...new Set(taken.flatMap((n) => (n.lotId ? [n.lotId] : [])))]);
  const pieces = orderedPieces(order.lines, taken, lots);
  if (pieces.length === 0) return false;
  const { cost, shares } = costOfOrderPieces(pieces);
  if (!cost.complete) return false;
  await tx.productionOrderCostLine.createMany({
    data: pieces.map((piece, position) => {
      const share = shares[position];
      const price = priceOf(piece);
      if (!share || !share.priced || share.currency === null) throw new RangeError("mfg.frozen_piece");
      return {
        orderId,
        lineId: piece.line.id,
        movementId: piece.net.movementId,
        lotId: piece.lot ? piece.lot.id : null,
        qtyMicro: piece.net.qty,
        valueMinor: share.shareMinor,
        currency: share.currency,
        lotTotalMinor: piece.lot && price ? price.totalMinor : null,
        lotQtyMicro: piece.lot ? piece.lot.qtyMicro : null,
        position,
      };
    }),
  });
  return true;
}

/**
 * Freezes every COMPLETED, not yet frozen order that took stock from this lot and whose cost is complete. Called around a price being filled in or
 * corrected, so that a correction never reaches an order that was already finished.
 */
export async function freezeCompletedOrdersOfLot(tx: Tx, lotId: string): Promise<number> {
  const links = await tx.productionOrderMovement.findMany({ where: { movement: { lotId } }, select: { orderId: true } });
  const ids = [...new Set(links.map((l) => l.orderId))];
  if (ids.length === 0) return 0;
  const candidates = await tx.productionOrder.findMany({ where: { id: { in: ids }, status: "COMPLETED", costLines: { none: {} } }, select: { id: true }, orderBy: { id: "asc" } });
  let frozen = 0;
  for (const c of candidates) if (await freezeOrderCost(tx, c.id)) frozen += 1;
  return frozen;
}
