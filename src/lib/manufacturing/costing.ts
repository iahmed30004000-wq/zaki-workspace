/**
 * «مخزون التصنيع» — lots as layers, the weighted average with an unpriced lot in the book, first-in-first-out issuing and the exact cost of an
 * order. PURE (no React, no database, no server imports): the services read the rows and call these; the tests pin them.
 *
 * EXACT. Quantities are integer micro-units, money integer minor units, every ratio an exact fraction of two `bigint`s; the only rounding is
 * half-up, and it is done ONCE at the end of whatever is being added up (an order's total is rounded once from the exact sum of its pieces,
 * not piece by piece). Nothing here is a float.
 *
 * Words used below:
 *  - a LOT is one receipt. Its remaining quantity is the SUM of the movements that point at it (its receipt, what was issued from it by an
 *    order, what an order returned). A lot received «بدون سعر» is PENDING until a costing row gives it a price; until then it is outside the
 *    average (`unpricedQty`) and a cost that uses it is incomplete («ناقص»), never guessed.
 *  - a movement with NO lot (the plain issue, the manual adjustment, a stocktake difference) is «unlotted». It is taken from PRICED stock only
 *    (`unlottedOut`), oldest priced lot first, so the pending lot is never silently used up by it.
 *  - the VALUE of a material is the SUM of the values written in its movements plus a correction for the lots priced later: their receipt was
 *    written with value 0, so the value of what is left of such a lot (its total minus the share already used) is added at read time.
 */
import { MICRO, currencyExponent, divRound, formatMinor, formatScaled } from "./shared";

// ───────────────────────────────────────── exact fractions ─────────────────────────────────────────

/** A non-negative exact fraction `n / d` (`d > 0`). */
export interface Frac {
  n: bigint;
  d: bigint;
}

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
};

export function frac(n: bigint, d: bigint = 1n): Frac {
  if (d <= 0n) throw new RangeError("mfg.fraction_denominator");
  const g = gcd(n, d);
  return g > 1n ? { n: n / g, d: d / g } : { n, d };
}

export function fracAdd(a: Frac, b: Frac): Frac {
  return frac(a.n * b.d + b.n * a.d, a.d * b.d);
}

/** Half-up to a whole number: THE rounding of an order's cost, done once, on the exact sum. */
export function fracRound(f: Frac): bigint {
  return f.n < 0n ? -divRound(-f.n, f.d) : divRound(f.n, f.d);
}

// ───────────────────────────────────────── a lot's cost share ─────────────────────────────────────────

/**
 * The share of a lot's total that `usedMicro` of its `lotQtyMicro` carries, rounded half-up: the whole lot carries exactly its total, so a
 * lot used up in several pieces (each the DIFFERENCE of two of these) always adds up to its total to the last minor unit.
 */
export function lotShare(usedMicro: bigint, lotQtyMicro: bigint, lotTotalMinor: bigint): bigint {
  if (usedMicro <= 0n || lotQtyMicro <= 0n) return 0n;
  if (usedMicro >= lotQtyMicro) return lotTotalMinor;
  return divRound(usedMicro * lotTotalMinor, lotQtyMicro);
}

// ───────────────────────────────────────── the position of a material ─────────────────────────────────────────

/** What the services read about one lot (the lots oldest first: by receipt day, then by when they were written). */
export interface LotFacts {
  id: string;
  /** The received quantity, base micro-units. */
  qtyMicro: bigint;
  /** The price total in minor units when the lot has one (received with it, or filled in later); `null` while it is pending. */
  totalMinor: bigint | null;
  /** The price came later, as a costing row (the lot was received without one). */
  lateCosted: boolean;
  /** The sum of the quantities and of the values of the movements that point at this lot (its receipt included). */
  flowQtyMicro: bigint;
  flowValueMinor: bigint;
}

export interface Layer {
  lotId: string;
  qtyMicro: bigint;
  totalMinor: bigint | null;
  /** What can still be taken from this lot by an order (its remaining quantity less what plain issues took from the priced lots). */
  availMicro: bigint;
  /** What has been taken from it so far (its quantity less `availMicro`): where the next piece starts on the lot's cost line. */
  usedMicro: bigint;
}

export interface Position {
  /** The balance: the sum of every movement. */
  qtyMicro: bigint;
  /** The sum of the values written in the movements. */
  ledgerValueMinor: bigint;
  /** The value of the lots that were priced later (their share not yet used), added on top. */
  lateValueMinor: bigint;
  /** The value of the stock that has a price: `ledgerValueMinor + lateValueMinor`. */
  valueMinor: bigint;
  /** The quantity of pending (unpriced) lots still in stock: outside the average. */
  unpricedQtyMicro: bigint;
  /** What the average is taken over: the balance less the unpriced stock. */
  pricedQtyMicro: bigint;
  layers: Layer[];
  /** Stock that no lot holds (a manual increase, a stocktake surplus): taken by an order after the lots. */
  unlotted: { qtyMicro: bigint; valueMinor: bigint };
}

const max0 = (v: bigint): bigint => (v < 0n ? 0n : v);

export function positionOf(lots: readonly LotFacts[], unlotted: { qtyMicro: bigint; valueMinor: bigint }): Position {
  let qty = unlotted.qtyMicro;
  let ledgerValue = unlotted.valueMinor;
  let late = 0n;
  let unpriced = 0n;
  const remaining = new Map<string, bigint>();
  for (const lot of lots) {
    qty += lot.flowQtyMicro;
    ledgerValue += lot.flowValueMinor;
    const left = max0(lot.flowQtyMicro);
    remaining.set(lot.id, left);
    if (lot.totalMinor === null) unpriced += left;
    else if (lot.lateCosted) {
      const used = lot.qtyMicro - left;
      const usedShare = lotShare(used < 0n ? 0n : used, lot.qtyMicro, lot.totalMinor);
      late += lot.totalMinor - usedShare - lot.flowValueMinor;
    }
  }
  // plain (unlotted) issues come out of the priced lots, oldest first
  let unlottedOut = unlotted.qtyMicro < 0n ? -unlotted.qtyMicro : 0n;
  const layers: Layer[] = lots.map((lot) => {
    const left = remaining.get(lot.id) ?? 0n;
    let avail = left;
    if (lot.totalMinor !== null && unlottedOut > 0n) {
      const take = unlottedOut < left ? unlottedOut : left;
      avail = left - take;
      unlottedOut -= take;
    }
    return { lotId: lot.id, qtyMicro: lot.qtyMicro, totalMinor: lot.totalMinor, availMicro: avail, usedMicro: lot.qtyMicro - avail };
  });
  const extra = unlotted.qtyMicro > 0n;
  return {
    qtyMicro: qty,
    ledgerValueMinor: ledgerValue,
    lateValueMinor: late,
    valueMinor: ledgerValue + late,
    unpricedQtyMicro: unpriced,
    pricedQtyMicro: max0(qty - unpriced),
    layers,
    unlotted: { qtyMicro: extra ? unlotted.qtyMicro : 0n, valueMinor: extra && unlotted.valueMinor > 0n ? unlotted.valueMinor : 0n },
  };
}

// ───────────────────────────────────────── first in, first out ─────────────────────────────────────────

/** One piece of an issue: `qtyMicro` from one lot (`lotId` null: from the unlotted stock), with the value the movement is written with. */
export interface Piece {
  lotId: string | null;
  qtyMicro: bigint;
  /** The value written in the movement (positive here; the movement carries it negated). 0 for a pending lot: the cost is then incomplete. */
  valueMinor: bigint;
  /** This piece has no price (a pending lot, or unlotted stock that carries no value). */
  unpriced: boolean;
}

/**
 * Takes `need` (positive) first-in-first-out from the layers (oldest lot first), then from the unlotted stock. A priced piece is valued by
 * the lot's cost line (`lotShare(used + piece) − lotShare(used)`), so a lot used up in pieces carries exactly its total; a pending piece has
 * no value. `shortfall` is what could not be found (0 when the stock was enough).
 */
export function planFifo(position: Pick<Position, "layers" | "unlotted">, need: bigint): { pieces: Piece[]; shortfall: bigint } {
  const pieces: Piece[] = [];
  let left = need;
  for (const layer of position.layers) {
    if (left <= 0n) break;
    if (layer.availMicro <= 0n) continue;
    const take = left < layer.availMicro ? left : layer.availMicro;
    if (layer.totalMinor === null) pieces.push({ lotId: layer.lotId, qtyMicro: take, valueMinor: 0n, unpriced: true });
    else {
      const value = lotShare(layer.usedMicro + take, layer.qtyMicro, layer.totalMinor) - lotShare(layer.usedMicro, layer.qtyMicro, layer.totalMinor);
      pieces.push({ lotId: layer.lotId, qtyMicro: take, valueMinor: value < 0n ? 0n : value, unpriced: false });
    }
    left -= take;
  }
  if (left > 0n && position.unlotted.qtyMicro > 0n) {
    const take = left < position.unlotted.qtyMicro ? left : position.unlotted.qtyMicro;
    const value = take >= position.unlotted.qtyMicro ? position.unlotted.valueMinor : divRound(take * position.unlotted.valueMinor, position.unlotted.qtyMicro);
    pieces.push({ lotId: null, qtyMicro: take, valueMinor: value, unpriced: value === 0n });
    left -= take;
  }
  return { pieces, shortfall: left };
}

/** What an order needs of a material: the recipe's quantity per output unit times the planned output, rounded half-up once. */
export function requiredMicro(perUnitMicro: bigint, plannedMicro: bigint): bigint {
  return divRound(perUnitMicro * plannedMicro, MICRO);
}

// ───────────────────────────────────────── the cost of an order ─────────────────────────────────────────

/** What was taken for an order, net of what it returned, as the cost is read from it. */
export interface CostPiece {
  /** The currency of the money (the material's); null when the material has none yet. */
  currency: string | null;
  qtyMicro: bigint;
  /** A lot piece: the lot's quantity and its price total (null total: pending, not priced). */
  lot: { qtyMicro: bigint; totalMinor: bigint | null } | null;
  /** An unlotted piece: the value written in its movement (net of its reversal). */
  valueMinor: bigint;
}

export interface CostByCurrency {
  currency: string;
  /** The exact sum, rounded half-up ONCE. */
  totalMinor: bigint;
  exact: Frac;
}

export interface OrderCost {
  /** False when any piece has no price: the number is then what is known, and says so. */
  complete: boolean;
  byCurrency: CostByCurrency[];
}

/**
 * The cost of what was taken: each lot piece costs `quantity × lot total ÷ lot quantity` (exact), each unlotted piece its written value; the
 * sum per currency is exact and rounded half-up once. A piece without a price makes the cost incomplete and adds nothing: never invented.
 */
export function costOfPieces(pieces: readonly CostPiece[]): OrderCost {
  let complete = true;
  const sums = new Map<string, Frac>();
  for (const piece of pieces) {
    if (piece.qtyMicro <= 0n) continue;
    let amount: Frac | null = null;
    if (piece.lot) amount = piece.lot.totalMinor === null ? null : frac(piece.qtyMicro * piece.lot.totalMinor, piece.lot.qtyMicro);
    else amount = piece.valueMinor > 0n ? frac(piece.valueMinor) : null;
    if (amount === null || piece.currency === null) {
      complete = false;
      continue;
    }
    sums.set(piece.currency, fracAdd(sums.get(piece.currency) ?? frac(0n), amount));
  }
  const byCurrency = [...sums.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, exact]) => ({ currency, exact, totalMinor: fracRound(exact) }));
  return { complete, byCurrency };
}

/**
 * The cost of ONE output unit: the exact sum divided by the real output (micro-units of the output unit), as text with six decimals more
 * than the currency's own (a sticker costs a fraction of a fils), rounded half-up once. Null without output.
 */
export function perUnitText(cost: CostByCurrency, outputMicro: bigint): string | null {
  if (outputMicro <= 0n) return null;
  const exponent = currencyExponent(cost.currency);
  const extra = 6;
  const scaled = divRound(cost.exact.n * 10n ** BigInt(extra) * MICRO, cost.exact.d * outputMicro);
  return formatScaled(scaled, exponent + extra, { minDecimals: exponent });
}

/** «الكلفة = Σ (كمية × سعر الدفعة) = 12.500»: the formula's total as text. */
export function totalText(cost: CostByCurrency): string {
  return formatMinor(cost.totalMinor, cost.currency);
}
