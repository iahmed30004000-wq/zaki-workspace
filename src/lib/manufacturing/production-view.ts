/**
 * «مخزون التصنيع», slice 2 — the shapes of recipes, production orders and reports that the routes answer and the screens read. Pure types.
 *
 * Quantities travel as integer micro-units, money as integer minor units plus a currency code. Every field that carries money is `null`
 * (or the whole `cost` object is) for a person who does not hold `manufacturing.cost`: the server decides, the screen draws what it was given.
 */
import type { MfgUnit } from "./view";

export const ORDER_STATUSES = ["DRAFT", "ISSUED", "COMPLETED", "CANCELLED", "RETURNED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

// ───────────────────────────────────────── recipes ─────────────────────────────────────────

export interface RecipeLineItem {
  id: string;
  materialId: string;
  materialName: string;
  baseUnit: string;
  /** One output unit takes this much, in the material's base unit. */
  qtyMicro: number;
  /** What was typed (in one of the material's units) and that unit's label, for the screen. */
  enteredQtyMicro: number;
  enteredUnitLabel: string;
  materialArchived: boolean;
}

export interface RecipeVersionItem {
  id: string;
  version: number;
  name: string;
  outputUnit: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
  lines: RecipeLineItem[];
}

export interface RecipeItem {
  id: string;
  archived: boolean;
  /** The newest version: what a new order is made from. */
  current: RecipeVersionItem;
  /** Every version, newest first (the older ones stay readable; an order keeps the version it was made from). */
  versions: RecipeVersionItem[];
  /** The finished item this recipe keeps in stock (a material of the space), or null while it keeps none. */
  finished: { materialId: string; name: string } | null;
  /** This viewer may start keeping the finished item in stock: holds `manufacturing.edit`, the recipe is open and keeps none yet. */
  canStock: boolean;
}

/** A material as the recipe form offers it: its units, to type a line in any of them. */
export interface RecipeMaterial {
  id: string;
  name: string;
  baseUnit: string;
  units: MfgUnit[];
}

export interface RecipesView {
  spaceId: string;
  spaceName: string;
  canEdit: boolean;
  canCost: boolean;
  recipes: RecipeItem[];
  materials: RecipeMaterial[];
}

// ───────────────────────────────────────── production orders ─────────────────────────────────────────

export interface OrderLineItem {
  id: string;
  materialId: string;
  materialName: string;
  baseUnit: string;
  perUnitMicro: number;
  requiredMicro: number;
  /** What the material holds now (a quantity, so everybody who reads sees it): before the issue it tells whether the order can go ahead. */
  balanceMicro: number;
  /** Of it, stock of lots received without a price (an issue takes it too, and the cost is then incomplete). */
  unpricedMicro: number;
  /** What the order has taken out so far, net of what it returned. */
  issuedMicro: number;
  /** There is enough in stock for the requirement (meaningful while the order is a draft). */
  enough: boolean;
}

/** One piece of the cost: so much from one lot at that lot's price. */
export interface OrderCostPiece {
  /** The lot's receipt day, or null for stock that no lot holds. */
  lotReceivedOn: string | null;
  qtyMicro: number;
  /** The price of one base unit in that lot, as the text to show; null when the lot has no price yet (the piece adds nothing). */
  unitText: string | null;
  /** quantity × price, rounded for the display only (the total below is rounded once from the exact sum); null without a price. */
  amountMinor: number | null;
}

export interface OrderCostLine {
  materialName: string;
  baseUnit: string;
  currency: string | null;
  qtyMicro: number;
  pieces: OrderCostPiece[];
}

export interface OrderCostTotal {
  currency: string;
  /** The exact sum of the pieces, rounded half-up ONCE. */
  totalMinor: number;
  /** The cost of one output unit (the exact sum ÷ the real output), as text; null until the order has a real output. */
  perUnitText: string | null;
}

export interface OrderCost {
  totals: OrderCostTotal[];
  lines: OrderCostLine[];
  /** The order is COMPLETED and its cost was frozen: it is exactly what it was at completion, whatever happens to the lots' prices afterwards. */
  frozen: boolean;
}

/** What a completed order put into stock as finished goods: a quantity and whether its price is still missing (never the price itself). */
export interface OrderFinished {
  materialId: string;
  materialName: string;
  qtyMicro: number;
  /** Received «بدون سعر» because the order's cost was not complete: a holder of the cost prices the lot from the material's page. */
  costPending: boolean;
}

export interface OrderItem {
  id: string;
  seq: number;
  status: OrderStatus;
  recipeId: string;
  recipeName: string;
  version: number;
  outputUnit: string;
  plannedMicro: number;
  actualMicro: number | null;
  wasteMicro: number | null;
  wasteNote: string | null;
  note: string | null;
  createdBy: string;
  createdAt: string;
  issuedAt: string | null;
  finishedAt: string | null;
  closedAt: string | null;
  closeNote: string | null;
  lines: OrderLineItem[];
  /** Some of what the order took has no price: the cost is incomplete («ناقص»). Not a price, so everybody who reads sees the flag. */
  costIncomplete: boolean;
  /** Only for a holder of `manufacturing.cost`; null for everybody else, and null before anything was issued. */
  cost: OrderCost | null;
  canIssue: boolean;
  canComplete: boolean;
  canCancel: boolean;
  canReturn: boolean;
  /** Slice 3: the plan of a DRAFT (quantity, recipe, note) may still change, by a holder of `manufacturing.edit`. */
  canEditDraft: boolean;
  /** The order's recipe keeps its finished item in stock: completing the order puts the real output there. */
  recipeStocked: boolean;
  /** The finished goods the order put into stock (a completed order of a recipe that keeps stock); null otherwise. */
  finished: OrderFinished | null;
}

export interface OrdersView {
  spaceId: string;
  spaceName: string;
  canEdit: boolean;
  canCost: boolean;
  orders: OrderItem[];
  /** The recipes a new order can be made from (not archived), with their newest version. */
  recipes: { id: string; name: string; outputUnit: string; version: number; stocked: boolean }[];
}

// ───────────────────────────────────────── reports ─────────────────────────────────────────

export interface ReportPeriod {
  from: string;
  to: string;
}

export interface ValuationRow {
  materialId: string;
  name: string;
  baseUnit: string;
  qtyMicro: number;
  /** Stock without a price (outside the average). */
  unpricedMicro: number;
  /** Cost holders only. */
  cost: { currency: string; valueMinor: number; averageText: string | null; formula: { value: string; qty: string; average: string } | null } | null;
}

export interface ConsumptionRow {
  materialId: string;
  name: string;
  baseUnit: string;
  /** Taken out by issues in the period, net of the issues that were reversed. */
  qtyMicro: number;
  /** Of it, taken by production orders. */
  viaOrdersMicro: number;
  /** Cost holders only: the cost of what was taken (exact, rounded once); `incomplete` when some of it had no price. */
  cost: { currency: string | null; totalMinor: number; incomplete: boolean } | null;
}

export interface OrderCostRow {
  orderId: string;
  seq: number;
  status: OrderStatus;
  recipeName: string;
  outputUnit: string;
  plannedMicro: number;
  actualMicro: number | null;
  day: string;
  costIncomplete: boolean;
  /** Cost holders only. */
  cost: { totals: OrderCostTotal[] } | null;
}

export interface LowStockRow {
  materialId: string;
  name: string;
  baseUnit: string;
  qtyMicro: number;
  lowStockMicro: number;
}

export type ReportKind = "valuation" | "consumption" | "orders" | "low";
export const REPORT_KINDS: readonly ReportKind[] = ["valuation", "consumption", "orders", "low"];

export interface ReportsView {
  spaceId: string;
  spaceName: string;
  canCost: boolean;
  period: ReportPeriod;
  valuation: ValuationRow[];
  /** One total per currency over the valuation rows (cost holders only). */
  valuationTotals: { currency: string; valueMinor: number }[] | null;
  consumption: ConsumptionRow[];
  orders: OrderCostRow[];
  low: LowStockRow[];
}
