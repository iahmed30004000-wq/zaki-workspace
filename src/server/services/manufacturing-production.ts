import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { ValidationError } from "@/server/auth";
import type { Actor } from "@/server/policy/actor";
import {
  LIMITS,
  MAX_BALANCE_MICRO,
  MAX_MOVEMENT_MICRO,
  averageText,
  parseQtyMicro,
  toBaseMicro,
  toSafeNumber,
} from "@/lib/manufacturing/shared";
import { finishedLotCost, frac, perUnitText, planFifo, requiredMicro, type Position } from "@/lib/manufacturing/costing";
import {
  isOrderStatus,
  type OrderCost,
  type OrderCostLine,
  type OrderItem,
  type OrderLineItem,
  type OrdersView,
  type RecipeItem,
  type RecipeMaterial,
  type RecipeVersionItem,
  type RecipesView,
} from "@/lib/manufacturing/production-view";
import { assertEdit, mfgScope, notFound, recordMfg, type MfgScope } from "./manufacturing-access";
import { EMPTY_POSITION, effectiveCost, loadLotsByIds, loadPosition, loadSpacePositions, type LotRow } from "./manufacturing-costing";
import { costOfOrderPieces, freezeOrderCost, frozenCostOf, netTaken, orderedPieces, priceOf, type FrozenRow, type Net, type Piece } from "./manufacturing-order-cost";

/**
 * «مخزون التصنيع», slice 2 — recipes and production orders. They extend the ledger and add no second stock:
 *
 *  - a RECIPE is an identity plus versions that are written once and never edited (a change is a new version; an old one stays readable, and an
 *    order keeps the version it was made from). A recipe is archived, never deleted. Its lines say how much of a material ONE output unit takes,
 *    typed in any unit of the material and kept exactly in the base unit. A recipe holds no price.
 *  - a PRODUCTION ORDER plans a quantity of a recipe version: DRAFT → ISSUED → COMPLETED, or CANCELLED (a draft only) or RETURNED (after the issue).
 *      ISSUE      takes the materials out of stock, FIRST-IN-FIRST-OUT by lot, as ordinary ISSUE movements linked to the order, all of them in ONE
 *                 transaction under the materials' row locks: either everything the order needs is there and is taken, or nothing is.
 *      COMPLETE   records the real output (and an optional waste line). The cost of the order is the sum of what it consumed, divided by the real output.
 *                 When the recipe keeps its finished item in stock (slice 3), the real output is also RECEIVED into that material as one lot, linked to
 *                 the order, carrying the order's whole cost; and the order's cost is frozen (see below).
 *      RETURN     puts the issued materials back by reversing movements (the originals stay): the only way back after an issue.
 *      EDIT       (slice 3) while the order is still a DRAFT, and only then, its planned quantity, its recipe (its newest version) and its note can change.
 *  - the COST of an order is not stored: it is read from the quantities the order took, each from its lot at that lot's price, as an exact sum
 *    rounded half-up once. A lot received without a price adds nothing and marks the cost incomplete («ناقص»): never invented. Its pieces are given
 *    their shares by the largest-remainder method, so they add up to the total to the minor unit. A COMPLETED order whose cost is complete is FROZEN
 *    (`ProductionOrderCostLine`): a later correction of a lot's price never re-prices it.
 *
 * ⚠️ The issue step moves stock by itself. 🔧 The order lists exactly what it took, lot by lot, and the return step undoes it.
 */

const invalid = (path: string, message: string) => new ValidationError([{ path, message }]);
const num = toSafeNumber;

type Tx = Prisma.TransactionClient;

const text = (max: number, message: string) => z.string().trim().min(1, message).max(max, message);
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));
const qtyText = z.string().trim().min(1, "mfg.e.qty").max(24, "mfg.e.qty");

// ───────────────────────────────────────── what a request may carry ─────────────────────────────────────────

const recipeLineSchema = z.object({
  materialId: z.string().min(1).max(64),
  unitId: z.string().min(1).max(64).nullable().optional(),
  /** How much of the material ONE output unit takes, in the chosen unit, as typed. */
  qty: qtyText,
});

const recipeBody = {
  name: text(LIMITS.name, "mfg.e.name"),
  outputUnit: text(LIMITS.unit, "mfg.e.output_unit"),
  note: optionalText(LIMITS.note, "mfg.e.note"),
  lines: z.array(recipeLineSchema).min(1, "mfg.e.recipe_lines").max(60, "mfg.e.recipe_lines"),
};

export const createRecipeSchema = z.object({ spaceId: z.string().min(1).max(64), ...recipeBody });
export const newVersionSchema = z.object(recipeBody);
export const archiveRecipeSchema = z.object({ archived: z.boolean() });

export const createOrderSchema = z.object({
  spaceId: z.string().min(1).max(64),
  recipeId: z.string().min(1).max(64),
  /** The planned output, in the recipe's output unit, as typed. */
  qty: qtyText,
  note: optionalText(LIMITS.note, "mfg.e.note"),
});

/** Editing a DRAFT: the recipe (its newest version), the planned quantity, the note. At least one of them; what is absent stays as it is. */
export const updateOrderSchema = z
  .object({
    recipeId: z.string().min(1).max(64).optional(),
    qty: qtyText.optional(),
    /** An empty text or null clears the note. */
    note: z.string().trim().max(LIMITS.note, "mfg.e.note").nullable().optional(),
  })
  .refine((v) => v.recipeId !== undefined || v.qty !== undefined || v.note !== undefined, { message: "mfg.e.order_edit_empty" });

export const completeOrderSchema = z.object({
  actualQty: qtyText,
  wasteQty: z.string().trim().max(24, "mfg.e.qty").nullable().optional(),
  wasteNote: optionalText(LIMITS.reason, "mfg.e.reason"),
});

export const closeOrderSchema = z.object({ reason: z.string().trim().min(2, "mfg.e.reason").max(LIMITS.reason, "mfg.e.reason") });

// ───────────────────────────────────────── recipes ─────────────────────────────────────────

const VERSION_INCLUDE = {
  createdBy: { select: { name: true } },
  lines: { orderBy: { position: "asc" }, include: { material: { select: { name: true, baseUnit: true, archivedAt: true } } } },
} satisfies Prisma.RecipeVersionInclude;

type VersionRow = Prisma.RecipeVersionGetPayload<{ include: typeof VERSION_INCLUDE }>;

function versionItemOf(v: VersionRow): RecipeVersionItem {
  return {
    id: v.id,
    version: v.version,
    name: v.name,
    outputUnit: v.outputUnit,
    note: v.note,
    createdBy: v.createdBy.name,
    createdAt: v.createdAt.toISOString(),
    lines: v.lines.map((l) => ({
      id: l.id,
      materialId: l.materialId,
      materialName: l.material.name,
      baseUnit: l.material.baseUnit,
      qtyMicro: num(l.qtyMicro),
      enteredQtyMicro: num(l.enteredQtyMicro),
      enteredUnitLabel: l.enteredUnitLabel,
      materialArchived: l.material.archivedAt !== null,
    })),
  };
}

/** The recipes of a space with every version, and the materials a line can be typed for. Prices appear nowhere here. */
export async function readRecipes(actor: Actor, spaceId: string): Promise<RecipesView> {
  const scope = await mfgScope(actor, spaceId);
  const [recipes, materials] = await Promise.all([
    db.recipe.findMany({
      where: { orgId: actor.orgId, workspaceId: spaceId },
      orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }, { id: "asc" }],
      take: LIMITS.list,
      include: { versions: { orderBy: { version: "desc" }, include: VERSION_INCLUDE }, outputMaterial: { select: { id: true, name: true } } },
    }),
    db.material.findMany({
      where: { orgId: actor.orgId, workspaceId: spaceId, archivedAt: null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: LIMITS.list,
      select: { id: true, name: true, baseUnit: true, units: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, label: true, num: true, den: true, archivedAt: true } } },
    }),
  ]);
  const items: RecipeItem[] = recipes.flatMap((r) => {
    const versions = r.versions.map(versionItemOf);
    const current = versions[0];
    return current
      ? [{ id: r.id, archived: r.archivedAt !== null, current, versions, finished: r.outputMaterial ? { materialId: r.outputMaterial.id, name: r.outputMaterial.name } : null, canStock: scope.canEdit && r.archivedAt === null && r.outputMaterialId === null }]
      : [];
  });
  const pickable: RecipeMaterial[] = materials.map((m) => ({
    id: m.id,
    name: m.name,
    baseUnit: m.baseUnit,
    units: m.units.map((u) => ({ id: u.id, label: u.label, num: u.num, den: u.den, archived: u.archivedAt !== null })),
  }));
  return { spaceId, spaceName: scope.spaceName, canEdit: scope.canEdit, canCost: scope.canCost, recipes: items, materials: pickable };
}

/** The lines of a version typed in the person's units, checked against the space's own (open) materials and turned into exact base quantities. */
async function resolveLines(actor: Actor, spaceId: string, lines: z.infer<typeof recipeBody.lines>) {
  const ids = lines.map((l) => l.materialId);
  if (new Set(ids).size !== ids.length) throw invalid("lines", "mfg.e.recipe_dup");
  const materials = await db.material.findMany({
    where: { id: { in: ids }, orgId: actor.orgId, workspaceId: spaceId },
    select: { id: true, baseUnit: true, archivedAt: true, units: { where: { archivedAt: null }, select: { id: true, label: true, num: true, den: true } } },
  });
  const byId = new Map(materials.map((m) => [m.id, m] as const));
  return lines.map((line, position) => {
    const material = byId.get(line.materialId);
    if (!material) throw invalid("lines", "mfg.e.recipe_material");
    if (material.archivedAt) throw invalid("lines", "mfg.e.archived");
    const unit = line.unitId ? material.units.find((u) => u.id === line.unitId) : null;
    if (line.unitId && !unit) throw invalid("lines", "mfg.e.unit");
    const conversion = unit ? { num: unit.num, den: unit.den } : { num: 1, den: 1 };
    const entered = parseQtyMicro(line.qty);
    if (entered === null || entered === 0n) throw invalid("lines", "mfg.e.qty");
    const base = toBaseMicro(entered, conversion);
    if (base === null) throw invalid("lines", "mfg.e.qty_exact");
    if (base > MAX_MOVEMENT_MICRO) throw invalid("lines", "mfg.e.qty_big");
    return { materialId: material.id, position, qtyMicro: base, enteredQtyMicro: entered, enteredUnitLabel: unit ? unit.label : material.baseUnit };
  });
}

/** «وصفة جديدة»: the recipe and its first version. Needs `manufacturing.edit`. */
export async function createRecipe(actor: Actor, input: z.infer<typeof createRecipeSchema>): Promise<{ id: string; versionId: string }> {
  const scope = await mfgScope(actor, input.spaceId);
  assertEdit(scope);
  const lines = await resolveLines(actor, input.spaceId, input.lines);
  const made = await db.recipe.create({
    data: {
      orgId: actor.orgId,
      workspaceId: input.spaceId,
      createdById: actor.userId,
      versions: { create: { version: 1, name: input.name, outputUnit: input.outputUnit, note: input.note, createdById: actor.userId, lines: { create: lines } } },
    },
    select: { id: true, versions: { select: { id: true } } },
  });
  await recordMfg(actor, input.spaceId, "recipe_created", made.id, { name: input.name, lines: lines.length });
  return { id: made.id, versionId: made.versions[0]!.id };
}

/** A change to a recipe is a NEW version (the next number); the old ones are never edited. Refused for an archived recipe. */
export async function addRecipeVersion(actor: Actor, recipeId: string, input: z.infer<typeof newVersionSchema>): Promise<{ versionId: string; version: number }> {
  const recipe = await db.recipe.findFirst({ where: { id: recipeId, orgId: actor.orgId }, select: { id: true, workspaceId: true, archivedAt: true, outputMaterial: { select: { baseUnit: true } } } });
  if (!recipe) throw notFound();
  const scope = await mfgScope(actor, recipe.workspaceId);
  assertEdit(scope);
  if (recipe.archivedAt) throw invalid("recipeId", "mfg.e.recipe_archived");
  // the output unit of a recipe that keeps finished stock IS the base unit of its finished material: it does not change under it
  if (recipe.outputMaterial && recipe.outputMaterial.baseUnit !== input.outputUnit) throw invalid("outputUnit", "mfg.e.output_unit_locked");
  const lines = await resolveLines(actor, recipe.workspaceId, input.lines);
  const made = await db.$transaction(async (tx) => {
    // two people saving at once: one waits for the other and takes the next number (the unique index is the last word)
    await tx.$queryRaw`SELECT "id" FROM "Recipe" WHERE "id" = ${recipe.id} FOR UPDATE`;
    const last = await tx.recipeVersion.aggregate({ where: { recipeId: recipe.id }, _max: { version: true } });
    const version = (last._max.version ?? 0) + 1;
    const row = await tx.recipeVersion.create({
      data: { recipeId: recipe.id, version, name: input.name, outputUnit: input.outputUnit, note: input.note, createdById: actor.userId, lines: { create: lines } },
      select: { id: true },
    });
    return { versionId: row.id, version };
  });
  await recordMfg(actor, recipe.workspaceId, "recipe_versioned", recipe.id, { version: made.version, name: input.name });
  return made;
}

/** Archive or restore a recipe (never deleted). Orders already made from it are not touched. */
export async function archiveRecipe(actor: Actor, recipeId: string, input: z.infer<typeof archiveRecipeSchema>): Promise<{ ok: true }> {
  const recipe = await db.recipe.findFirst({ where: { id: recipeId, orgId: actor.orgId }, select: { id: true, workspaceId: true, archivedAt: true } });
  if (!recipe) throw notFound();
  const scope = await mfgScope(actor, recipe.workspaceId);
  assertEdit(scope);
  if (input.archived !== (recipe.archivedAt !== null)) {
    await db.recipe.update({ where: { id: recipe.id }, data: { archivedAt: input.archived ? new Date() : null } });
    await recordMfg(actor, recipe.workspaceId, input.archived ? "recipe_archived" : "recipe_restored", recipe.id);
  }
  return { ok: true };
}

// ───────────────────────────────────────── reading orders ─────────────────────────────────────────

const ORDER_INCLUDE = {
  createdBy: { select: { name: true } },
  recipeVersion: { select: { version: true, name: true, outputUnit: true, recipeId: true, recipe: { select: { outputMaterialId: true } } } },
  lines: { orderBy: { position: "asc" }, include: { material: { select: { id: true, name: true, baseUnit: true, currency: true, archivedAt: true } } } },
} satisfies Prisma.ProductionOrderInclude;

type OrderRow = Prisma.ProductionOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

/** What an order put into stock as finished goods (a quantity and a flag, never a price). */
interface FinishedLot {
  id: string;
  materialId: string;
  materialName: string;
  qtyMicro: bigint;
  costPending: boolean;
}

/** One piece of a cost as the screen draws it (live from the lots, or frozen from the rows written at completion). */
interface ViewPiece {
  lineId: string;
  lotReceivedOn: string | null;
  qtyMicro: bigint;
  unitText: string | null;
  amountMinor: bigint | null;
  currency: string | null;
}

function orderItemOf(
  scope: MfgScope,
  o: OrderRow,
  taken: readonly Net[],
  positions: ReadonlyMap<string, Position>,
  lots: ReadonlyMap<string, LotRow>,
  frozen: readonly FrozenRow[] | undefined,
  finished: FinishedLot | undefined,
): OrderItem {
  const mine = taken.filter((n) => n.orderId === o.id && n.qty > 0n);
  const issuedByLine = new Map<string, bigint>();
  for (const n of mine) issuedByLine.set(n.lineId, (issuedByLine.get(n.lineId) ?? 0n) + n.qty);

  const lines: OrderLineItem[] = o.lines.map((l) => {
    const pos = positions.get(l.materialId) ?? EMPTY_POSITION;
    return {
      id: l.id,
      materialId: l.materialId,
      materialName: l.material.name,
      baseUnit: l.material.baseUnit,
      perUnitMicro: num(l.perUnitMicro),
      requiredMicro: num(l.requiredMicro),
      balanceMicro: num(pos.qtyMicro),
      unpricedMicro: num(pos.unpricedQtyMicro),
      issuedMicro: num(issuedByLine.get(l.id) ?? 0n),
      enough: pos.qtyMicro >= l.requiredMicro,
    };
  });

  // the cost: a completed order whose cost was frozen reads the frozen rows; every other order reads its pieces at their lots' price NOW, split by the
  // largest-remainder method so that the pieces add up to the total exactly
  const isFrozen = o.status === "COMPLETED" && frozen !== undefined && frozen.length > 0;
  const pieces: Piece[] = orderedPieces(o.lines, mine, lots);
  const live = costOfOrderPieces(pieces);
  const costIncomplete = !isFrozen && pieces.length > 0 && !live.cost.complete;

  let costView: OrderCost | null = null;
  if (scope.canCost && (isFrozen || pieces.length > 0)) {
    const view: ViewPiece[] = isFrozen
      ? (frozen ?? []).map((r) => {
          const lot = r.lotId ? lots.get(r.lotId) : undefined;
          return {
            lineId: r.lineId,
            lotReceivedOn: lot ? lot.receivedOn.toISOString().slice(0, 10) : null,
            qtyMicro: r.qtyMicro,
            unitText: r.lotTotalMinor !== null && r.lotQtyMicro !== null ? averageText(r.lotTotalMinor, r.lotQtyMicro, r.currency) : averageText(r.valueMinor, r.qtyMicro, r.currency),
            amountMinor: r.valueMinor,
            currency: r.currency,
          };
        })
      : pieces.map((piece, i) => {
          const share = live.shares[i];
          const price = priceOf(piece);
          const currency = share?.currency ?? price?.currency ?? piece.line.material.currency;
          const lot = piece.lot;
          let unitText: string | null = null;
          if (share?.priced && currency) unitText = lot && price ? averageText(price.totalMinor, lot.qtyMicro, currency) : !lot && piece.net.value > 0n ? averageText(piece.net.value, piece.net.qty, currency) : null;
          return {
            lineId: piece.line.id,
            lotReceivedOn: lot ? lot.receivedOn.toISOString().slice(0, 10) : null,
            qtyMicro: piece.net.qty,
            unitText,
            amountMinor: share?.priced ? share.shareMinor : null,
            currency,
          };
        });
    const costLines: OrderCostLine[] = o.lines.flatMap((line) => {
      const own = view.filter((v) => v.lineId === line.id);
      if (own.length === 0) return [];
      return [
        {
          materialName: line.material.name,
          baseUnit: line.material.baseUnit,
          currency: line.material.currency,
          qtyMicro: num(own.reduce((sum, p) => sum + p.qtyMicro, 0n)),
          pieces: own.map((p) => ({ lotReceivedOn: p.lotReceivedOn, qtyMicro: num(p.qtyMicro), unitText: p.unitText, amountMinor: p.amountMinor === null ? null : num(p.amountMinor) })),
        },
      ];
    });
    const totals = isFrozen
      ? [...(frozen ?? []).reduce((acc, r) => acc.set(r.currency, (acc.get(r.currency) ?? 0n) + r.valueMinor), new Map<string, bigint>()).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, totalMinor]) => ({ currency, totalMinor }))
      : live.cost.byCurrency.map((c) => ({ currency: c.currency, totalMinor: c.totalMinor }));
    const actual = o.actualQtyMicro;
    costView = {
      // the cost of ONE output unit is the order's cost (rounded once) over the real output
      totals: totals.map((c) => ({ currency: c.currency, totalMinor: num(c.totalMinor), perUnitText: actual ? perUnitText({ currency: c.currency, totalMinor: c.totalMinor, exact: frac(c.totalMinor) }, actual) : null })),
      lines: costLines,
      frozen: isFrozen,
    };
  }

  const status = isOrderStatus(o.status) ? o.status : "DRAFT";
  return {
    id: o.id,
    seq: o.seq,
    status,
    recipeId: o.recipeVersion.recipeId,
    recipeName: o.recipeVersion.name,
    version: o.recipeVersion.version,
    outputUnit: o.recipeVersion.outputUnit,
    plannedMicro: num(o.plannedQtyMicro),
    actualMicro: o.actualQtyMicro === null ? null : num(o.actualQtyMicro),
    wasteMicro: o.wasteQtyMicro === null ? null : num(o.wasteQtyMicro),
    wasteNote: o.wasteNote,
    note: o.note,
    createdBy: o.createdBy.name,
    createdAt: o.createdAt.toISOString(),
    issuedAt: o.issuedAt ? o.issuedAt.toISOString() : null,
    finishedAt: o.finishedAt ? o.finishedAt.toISOString() : null,
    closedAt: o.closedAt ? o.closedAt.toISOString() : null,
    closeNote: o.closeNote,
    lines,
    costIncomplete,
    cost: costView,
    canIssue: scope.canEdit && status === "DRAFT",
    canComplete: scope.canEdit && status === "ISSUED",
    canCancel: scope.canEdit && status === "DRAFT",
    canReturn: scope.canEdit && status === "ISSUED",
    canEditDraft: scope.canEdit && status === "DRAFT",
    recipeStocked: o.recipeVersion.recipe.outputMaterialId !== null,
    finished: finished ? { materialId: finished.materialId, materialName: finished.materialName, qtyMicro: num(finished.qtyMicro), costPending: finished.costPending } : null,
  };
}

/** The orders of a space that match, as the order screen reads them (also what the reports list). */
export async function ordersOf(scope: MfgScope, where: Prisma.ProductionOrderWhereInput, take: number): Promise<OrderItem[]> {
  const orders = await db.productionOrder.findMany({ where: { orgId: scope.actor.orgId, workspaceId: scope.spaceId, ...where }, orderBy: [{ seq: "desc" }], take, include: ORDER_INCLUDE });
  if (orders.length === 0) return [];
  const ids = orders.map((o) => o.id);
  const taken = await netTaken(db, ids);
  const frozen = await frozenCostOf(db, ids);
  const lotIds = new Set([...taken.flatMap((n) => (n.lotId ? [n.lotId] : [])), ...[...frozen.values()].flatMap((rows) => rows.flatMap((r) => (r.lotId ? [r.lotId] : [])))]);
  const lots = await loadLotsByIds(db, [...lotIds]);
  const positions = await loadSpacePositions(scope.actor.orgId, scope.spaceId);
  const outputIds = orders.flatMap((o) => (o.outputLotId ? [o.outputLotId] : []));
  const outputs = new Map(
    (outputIds.length === 0
      ? []
      : await db.materialLot.findMany({ where: { id: { in: outputIds } }, select: { id: true, materialId: true, qtyMicro: true, costPending: true, costing: { select: { id: true } }, material: { select: { name: true } } } })
    ).map((l) => [l.id, { id: l.id, materialId: l.materialId, materialName: l.material.name, qtyMicro: l.qtyMicro, costPending: l.costPending && l.costing === null }] as const),
  );
  return orders.map((o) => orderItemOf(scope, o, taken, positions, lots, frozen.get(o.id), o.outputLotId ? outputs.get(o.outputLotId) : undefined));
}

/** The orders of a space, newest first, with what each took and (for a cost holder) what it cost; and the recipes a new order can be made from. */
export async function readOrders(actor: Actor, spaceId: string): Promise<OrdersView> {
  const scope = await mfgScope(actor, spaceId);
  const [orders, recipes] = await Promise.all([
    ordersOf(scope, {}, 200),
    db.recipe.findMany({
      where: { orgId: actor.orgId, workspaceId: spaceId, archivedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: LIMITS.list,
      select: { id: true, outputMaterialId: true, versions: { orderBy: { version: "desc" }, take: 1, select: { version: true, name: true, outputUnit: true } } },
    }),
  ]);
  return {
    spaceId,
    spaceName: scope.spaceName,
    canEdit: scope.canEdit,
    canCost: scope.canCost,
    orders,
    recipes: recipes.flatMap((r) => (r.versions[0] ? [{ id: r.id, name: r.versions[0].name, outputUnit: r.versions[0].outputUnit, version: r.versions[0].version, stocked: r.outputMaterialId !== null }] : [])),
  };
}

/** One order (for the answer of a step). */
async function readOrderIn(scope: MfgScope, orderId: string): Promise<OrderItem> {
  const [item] = await ordersOf(scope, { id: orderId }, 1);
  if (!item) throw notFound();
  return item;
}

async function loadOrder(actor: Actor, orderId: string) {
  const order = await db.productionOrder.findFirst({ where: { id: orderId, orgId: actor.orgId }, select: { id: true, workspaceId: true, seq: true } });
  if (!order) throw notFound();
  const scope = await mfgScope(actor, order.workspaceId);
  return { scope, order };
}

// ───────────────────────────────────────── the steps of an order ─────────────────────────────────────────

/** The planned output typed in the form: a positive quantity, not silly. */
function plannedOf(qty: string): bigint {
  const planned = parseQtyMicro(qty);
  if (planned === null || planned === 0n) throw invalid("qty", "mfg.e.qty");
  if (planned > MAX_MOVEMENT_MICRO) throw invalid("qty", "mfg.e.qty_big");
  return planned;
}

/** What an order needs of each material: the recipe line's quantity per output unit times the planned output, rounded half-up once, fixed now. */
function planLines(recipeLines: readonly { materialId: string; qtyMicro: bigint }[], planned: bigint) {
  return recipeLines.map((l, position) => {
    const required = requiredMicro(l.qtyMicro, planned);
    if (required <= 0n) throw invalid("qty", "mfg.e.order_tiny");
    if (required > MAX_MOVEMENT_MICRO) throw invalid("qty", "mfg.e.qty_big");
    return { materialId: l.materialId, position, perUnitMicro: l.qtyMicro, requiredMicro: required };
  });
}

/** «أمر تصنيع جديد»: a DRAFT for a planned quantity of the recipe's newest version; what it needs of each material is fixed now. Nothing moves. */
export async function createOrder(actor: Actor, input: z.infer<typeof createOrderSchema>): Promise<OrderItem> {
  const scope = await mfgScope(actor, input.spaceId);
  assertEdit(scope);
  const recipe = await db.recipe.findFirst({
    where: { id: input.recipeId, orgId: actor.orgId, workspaceId: input.spaceId },
    select: { id: true, archivedAt: true, versions: { orderBy: { version: "desc" }, take: 1, include: { lines: { orderBy: { position: "asc" } } } } },
  });
  if (!recipe) throw invalid("recipeId", "mfg.e.recipe");
  if (recipe.archivedAt) throw invalid("recipeId", "mfg.e.recipe_archived");
  const version = recipe.versions[0];
  if (!version) throw invalid("recipeId", "mfg.e.recipe");
  const planned = plannedOf(input.qty);
  const lines = planLines(version.lines, planned);
  const made = await db.$transaction(async (tx) => {
    // the number of the order: one more than the last of this space (the space's row is the lock)
    await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id" = ${input.spaceId} FOR UPDATE`;
    const last = await tx.productionOrder.aggregate({ where: { workspaceId: input.spaceId }, _max: { seq: true } });
    return tx.productionOrder.create({
      data: { orgId: actor.orgId, workspaceId: input.spaceId, seq: (last._max.seq ?? 0) + 1, recipeVersionId: version.id, plannedQtyMicro: planned, note: input.note, createdById: actor.userId, lines: { create: lines } },
      select: { id: true, seq: true },
    });
  });
  await recordMfg(actor, input.spaceId, "order_created", made.id, { seq: made.seq, recipe: version.name, plannedMicro: num(planned) });
  return readOrderIn(scope, made.id);
}

/**
 * «تعديل المسودة»: while an order is still a DRAFT, and only then, the person who holds `manufacturing.edit` can change its planned quantity, its
 * recipe (it is then made from that recipe's NEWEST version) and its note. What it needs of each material is fixed again from the version and the
 * quantity, replacing the draft's old lines in the same transaction under the order's row lock (so an issue that arrives at the same moment either
 * sees the old plan whole or the new one whole). Nothing moves: a draft has taken nothing. Once the order is issued the database refuses any of it.
 */
export async function updateOrder(actor: Actor, orderId: string, input: z.infer<typeof updateOrderSchema>): Promise<OrderItem> {
  const { scope, order } = await loadOrder(actor, orderId);
  assertEdit(scope);
  const planned = input.qty !== undefined ? plannedOf(input.qty) : null;
  const changed = await db.$transaction(async (tx) => {
    const fresh = await lockOrder(tx, orderId);
    if (fresh.status !== "DRAFT") throw invalid("orderId", "mfg.e.order_state");
    let versionId = fresh.recipeVersionId;
    if (input.recipeId !== undefined) {
      const recipe = await tx.recipe.findFirst({
        where: { id: input.recipeId, orgId: actor.orgId, workspaceId: order.workspaceId },
        select: { archivedAt: true, versions: { orderBy: { version: "desc" }, take: 1, select: { id: true } } },
      });
      if (!recipe || !recipe.versions[0]) throw invalid("recipeId", "mfg.e.recipe");
      if (recipe.archivedAt) throw invalid("recipeId", "mfg.e.recipe_archived");
      versionId = recipe.versions[0].id;
    }
    const nextPlanned = planned ?? fresh.plannedQtyMicro;
    const noteGiven = input.note !== undefined;
    const nextNote = noteGiven ? (input.note && input.note.length > 0 ? input.note : null) : fresh.note;
    const planChanged = versionId !== fresh.recipeVersionId || nextPlanned !== fresh.plannedQtyMicro;
    if (!planChanged && nextNote === fresh.note) return false;
    if (planChanged) {
      const version = await tx.recipeVersion.findUniqueOrThrow({ where: { id: versionId }, select: { lines: { orderBy: { position: "asc" }, select: { materialId: true, qtyMicro: true } } } });
      const lines = planLines(version.lines, nextPlanned);
      // a draft's lines are replaced, never edited in place (the database allows the delete only while the order is a draft)
      await tx.productionOrderLine.deleteMany({ where: { orderId } });
      await tx.productionOrder.update({ where: { id: orderId }, data: { recipeVersionId: versionId, plannedQtyMicro: nextPlanned, note: nextNote } });
      await tx.productionOrderLine.createMany({ data: lines.map((l) => ({ orderId, ...l })) });
    } else {
      await tx.productionOrder.update({ where: { id: orderId }, data: { note: nextNote } });
    }
    return true;
  });
  if (changed) await recordMfg(actor, order.workspaceId, "order_edited", orderId, { seq: order.seq, plan: input.recipeId !== undefined || input.qty !== undefined, note: input.note !== undefined });
  return readOrderIn(scope, orderId);
}

async function lockOrder(tx: Tx, orderId: string) {
  await tx.$queryRaw`SELECT "id" FROM "ProductionOrder" WHERE "id" = ${orderId} FOR UPDATE`;
  return tx.productionOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: { orderBy: { position: "asc" } } } });
}

/** The materials of an order, locked in ONE order (by id) so two orders needing the same materials cannot wait for each other for ever. */
async function lockMaterials(tx: Tx, materialIds: readonly string[]) {
  const sorted = [...new Set(materialIds)].sort();
  const rows = [];
  for (const id of sorted) {
    await tx.$queryRaw`SELECT "id" FROM "Material" WHERE "id" = ${id} FOR UPDATE`;
    rows.push(await tx.material.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, archivedAt: true } }));
  }
  return new Map(rows.map((m) => [m.id, m] as const));
}

/**
 * «صرف المواد»: DRAFT → ISSUED. Everything the order needs is taken out of stock first-in-first-out, lot by lot, as ISSUE movements linked to
 * the order, in ONE transaction under the materials' row locks. If any material is short (or archived), nothing is taken and the order stays a
 * draft. ⚠️ This moves stock. 🔧 The order lists what it took, lot by lot; «إرجاع المواد» puts it all back by reversing movements.
 */
export async function issueOrder(actor: Actor, orderId: string): Promise<OrderItem> {
  const { scope, order } = await loadOrder(actor, orderId);
  assertEdit(scope);
  await db.$transaction(async (tx) => {
    const fresh = await lockOrder(tx, orderId);
    if (fresh.status !== "DRAFT") throw invalid("orderId", "mfg.e.order_state");
    const materials = await lockMaterials(tx, fresh.lines.map((l) => l.materialId));
    for (const line of fresh.lines) {
      const material = materials.get(line.materialId);
      if (!material || material.archivedAt) throw invalid("orderId", "mfg.e.archived");
      const { position } = await loadPosition(tx, line.materialId);
      if (line.requiredMicro > position.qtyMicro) throw invalid(line.materialId, "mfg.e.order_short");
      const plan = planFifo(position, line.requiredMicro);
      if (plan.shortfall > 0n) throw invalid(line.materialId, "mfg.e.order_short");
      for (const piece of plan.pieces) {
        const movement = await tx.materialMovement.create({
          data: {
            orgId: actor.orgId,
            workspaceId: order.workspaceId,
            materialId: line.materialId,
            lotId: piece.lotId,
            kind: "ISSUE",
            qtyMicro: -piece.qtyMicro,
            valueMinor: -piece.valueMinor,
            reason: `أمر تصنيع رقم ${order.seq}`,
            createdById: actor.userId,
          },
          select: { id: true },
        });
        await tx.productionOrderMovement.create({ data: { orderId, lineId: line.id, movementId: movement.id } });
      }
    }
    await tx.productionOrder.update({ where: { id: orderId }, data: { status: "ISSUED", issuedAt: new Date(), issuedById: actor.userId } });
  });
  await recordMfg(actor, order.workspaceId, "order_issued", orderId, { seq: order.seq });
  return readOrderIn(scope, orderId);
}

/** The day of the completion as the UTC midnight the `@db.Date` column keeps. */
const todayDate = (): Date => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

/**
 * «إنهاء الأمر»: ISSUED → COMPLETED with the real output (and an optional waste line). The cost per output unit is the cost of what was taken ÷ this output.
 *
 * Slice 3: when the recipe keeps its finished item in stock («سجّل المنتج النهائي بالمخزون»), the real output is RECEIVED into that material in the same
 * transaction, as ONE lot and one RECEIVE movement linked to the order (`outputLotId`). The lot carries the order's WHOLE cost, so what left stock as
 * materials enters it as the product to the minor unit; its unit cost is `total ÷ output` rounded half-up once. If the cost is not complete (a lot
 * without a price was used) or is in more than one currency, or in a currency other than the finished material's, the lot is received «بدون سعر»
 * (flagged, value 0): never invented, a holder of the cost prices it like any other lot. And a complete cost is frozen (see `freezeOrderCost`).
 *
 * ⚠️ A completed order is not reversed here: its finished goods are in stock now. 🔧 A mistake in the output is a reversal of that receipt with its reason.
 */
export async function completeOrder(actor: Actor, orderId: string, input: z.infer<typeof completeOrderSchema>): Promise<OrderItem> {
  const { scope, order } = await loadOrder(actor, orderId);
  assertEdit(scope);
  const actual = parseQtyMicro(input.actualQty);
  if (actual === null || actual === 0n) throw invalid("actualQty", "mfg.e.qty");
  if (actual > MAX_MOVEMENT_MICRO) throw invalid("actualQty", "mfg.e.qty_big");
  let waste: bigint | null = null;
  if (input.wasteQty && input.wasteQty.trim() !== "") {
    waste = parseQtyMicro(input.wasteQty);
    if (waste === null) throw invalid("wasteQty", "mfg.e.qty");
    if (waste > MAX_MOVEMENT_MICRO) throw invalid("wasteQty", "mfg.e.qty_big");
  }
  const outcome = await db.$transaction(async (tx) => {
    const fresh = await lockOrder(tx, orderId);
    if (fresh.status !== "ISSUED") throw invalid("orderId", "mfg.e.order_state");
    const target = await tx.recipeVersion.findUniqueOrThrow({ where: { id: fresh.recipeVersionId }, select: { recipe: { select: { outputMaterialId: true } } } });
    let outputLotId: string | null = null;
    let pending = false;
    const outputMaterialId = target.recipe.outputMaterialId;
    if (outputMaterialId) {
      await tx.$queryRaw`SELECT "id" FROM "Material" WHERE "id" = ${outputMaterialId} FOR UPDATE`;
      const material = await tx.material.findUniqueOrThrow({ where: { id: outputMaterialId } });
      if (material.archivedAt) throw invalid("orderId", "mfg.e.finished_archived");
      const { position } = await loadPosition(tx, outputMaterialId);
      if (position.qtyMicro + actual > MAX_BALANCE_MICRO) throw invalid("actualQty", "mfg.e.qty_big");
      const lines = await tx.productionOrderLine.findMany({ where: { orderId }, orderBy: { position: "asc" }, select: { id: true, position: true, material: { select: { currency: true } } } });
      const taken = await netTaken(tx, [orderId]);
      const lots = await loadLotsByIds(tx, [...new Set(taken.flatMap((n) => (n.lotId ? [n.lotId] : [])))]);
      const { cost } = costOfOrderPieces(orderedPieces(lines, taken, lots));
      const single = cost.complete && cost.byCurrency.length === 1 ? cost.byCurrency[0] : undefined;
      const priced = single !== undefined && (!material.currency || material.currency === single.currency);
      const amounts = priced && single ? finishedLotCost(single.totalMinor, actual) : { totalMinor: 0n, unitCostMinor: 0n };
      pending = !priced;
      const why = `ناتج أمر تصنيع رقم ${order.seq}`;
      if (priced && single && !material.currency) await tx.material.update({ where: { id: material.id }, data: { currency: single.currency } });
      const lot = await tx.materialLot.create({
        data: {
          orgId: actor.orgId,
          workspaceId: order.workspaceId,
          materialId: material.id,
          receivedOn: todayDate(),
          qtyMicro: actual,
          enteredQtyMicro: actual,
          enteredUnitLabel: material.baseUnit,
          unitCostMinor: amounts.unitCostMinor,
          totalCostMinor: amounts.totalMinor,
          // a lot without a price carries the material's currency, or the placeholder XXX («no currency») while the material has none yet
          currency: priced && single ? single.currency : (material.currency ?? "XXX"),
          costPending: pending,
          proofNote: why,
          createdById: actor.userId,
        },
        select: { id: true },
      });
      await tx.materialMovement.create({
        data: { orgId: actor.orgId, workspaceId: order.workspaceId, materialId: material.id, lotId: lot.id, kind: "RECEIVE", qtyMicro: actual, valueMinor: amounts.totalMinor, reason: why, createdById: actor.userId },
      });
      outputLotId = lot.id;
    }
    await tx.productionOrder.update({
      where: { id: orderId },
      data: { status: "COMPLETED", finishedAt: new Date(), finishedById: actor.userId, actualQtyMicro: actual, wasteQtyMicro: waste, wasteNote: input.wasteNote, outputLotId },
    });
    // the cost is frozen the moment the order is completed with a complete cost
    await freezeOrderCost(tx, orderId);
    return { stocked: outputLotId !== null, pending };
  });
  await recordMfg(actor, order.workspaceId, "order_completed", orderId, { seq: order.seq, actualMicro: num(actual), stocked: outcome.stocked, waiting: outcome.pending });
  return readOrderIn(scope, orderId);
}

/**
 * «سجّل المنتج النهائي بالمخزون»: the recipe starts keeping its finished item in stock. The finished item is a Material of the space (made now, once,
 * named like the recipe, its base unit the recipe's output unit, no price and no stock yet), the recipe points at it, and from then on completing an
 * order of this recipe receives the real output into it. Asking twice changes nothing. Needs `manufacturing.edit`.
 */
export async function enableFinishedStock(actor: Actor, recipeId: string): Promise<{ materialId: string; created: boolean }> {
  const recipe = await db.recipe.findFirst({ where: { id: recipeId, orgId: actor.orgId }, select: { id: true, workspaceId: true, archivedAt: true } });
  if (!recipe) throw notFound();
  const scope = await mfgScope(actor, recipe.workspaceId);
  assertEdit(scope);
  if (recipe.archivedAt) throw invalid("recipeId", "mfg.e.recipe_archived");
  const made = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Recipe" WHERE "id" = ${recipe.id} FOR UPDATE`;
    const fresh = await tx.recipe.findUniqueOrThrow({ where: { id: recipe.id }, select: { outputMaterialId: true, versions: { orderBy: { version: "desc" }, take: 1, select: { name: true, outputUnit: true } } } });
    if (fresh.outputMaterialId) return { materialId: fresh.outputMaterialId, created: false, name: null as string | null };
    const current = fresh.versions[0];
    if (!current) throw invalid("recipeId", "mfg.e.recipe");
    const material = await tx.material.create({
      data: { orgId: actor.orgId, workspaceId: recipe.workspaceId, name: current.name, baseUnit: current.outputUnit, createdById: actor.userId },
      select: { id: true },
    });
    await tx.recipe.update({ where: { id: recipe.id }, data: { outputMaterialId: material.id } });
    return { materialId: material.id, created: true, name: current.name };
  });
  if (made.created) await recordMfg(actor, recipe.workspaceId, "finished_stock_on", recipe.id, { materialId: made.materialId, name: made.name });
  return { materialId: made.materialId, created: made.created };
}

/** «إلغاء»: a DRAFT is cancelled (nothing was taken, so nothing moves). After the issue the way back is «إرجاع المواد». */
export async function cancelOrder(actor: Actor, orderId: string, input: z.infer<typeof closeOrderSchema>): Promise<OrderItem> {
  const { scope, order } = await loadOrder(actor, orderId);
  assertEdit(scope);
  await db.$transaction(async (tx) => {
    const fresh = await lockOrder(tx, orderId);
    if (fresh.status !== "DRAFT") throw invalid("orderId", "mfg.e.order_state");
    await tx.productionOrder.update({ where: { id: orderId }, data: { status: "CANCELLED", closedAt: new Date(), closedById: actor.userId, closeNote: input.reason } });
  });
  await recordMfg(actor, order.workspaceId, "order_cancelled", orderId, { seq: order.seq, reason: input.reason });
  return readOrderIn(scope, orderId);
}

/**
 * «إرجاع المواد»: ISSUED → RETURNED. Every movement the issue wrote is reversed by a new movement (the opposite quantity and value, pointing at
 * the original, linked to the order); the originals stay. All of it or none of it, under the materials' row locks. A completed order cannot be returned.
 */
export async function returnOrder(actor: Actor, orderId: string, input: z.infer<typeof closeOrderSchema>): Promise<OrderItem> {
  const { scope, order } = await loadOrder(actor, orderId);
  assertEdit(scope);
  await db.$transaction(async (tx) => {
    const fresh = await lockOrder(tx, orderId);
    if (fresh.status !== "ISSUED") throw invalid("orderId", "mfg.e.order_state");
    await lockMaterials(tx, fresh.lines.map((l) => l.materialId));
    const links = await tx.productionOrderMovement.findMany({ where: { orderId }, select: { lineId: true, movement: true } });
    const reversed = new Set((await tx.materialMovement.findMany({ where: { reversesId: { in: links.map((l) => l.movement.id) } }, select: { reversesId: true } })).map((m) => m.reversesId));
    const touched = new Set<string>();
    for (const link of links) {
      const original = link.movement;
      if (original.kind !== "ISSUE" || reversed.has(original.id)) continue;
      const back = await tx.materialMovement.create({
        data: {
          orgId: actor.orgId,
          workspaceId: order.workspaceId,
          materialId: original.materialId,
          lotId: original.lotId,
          kind: "REVERSE",
          qtyMicro: -original.qtyMicro,
          valueMinor: -original.valueMinor,
          reason: `إرجاع أمر تصنيع رقم ${order.seq}: ${input.reason}`.slice(0, LIMITS.reason),
          reversesId: original.id,
          createdById: actor.userId,
        },
        select: { id: true },
      });
      await tx.productionOrderMovement.create({ data: { orderId, lineId: link.lineId, movementId: back.id } });
      touched.add(original.materialId);
    }
    // a material never goes over the ceiling a balance may reach, even by a return
    for (const materialId of touched) {
      const sum = await tx.materialMovement.aggregate({ where: { materialId }, _sum: { qtyMicro: true } });
      if ((sum._sum.qtyMicro ?? 0n) > MAX_BALANCE_MICRO) throw invalid(materialId, "mfg.e.qty_big");
    }
    await tx.productionOrder.update({ where: { id: orderId }, data: { status: "RETURNED", closedAt: new Date(), closedById: actor.userId, closeNote: input.reason } });
  });
  await recordMfg(actor, order.workspaceId, "order_returned", orderId, { seq: order.seq, reason: input.reason });
  return readOrderIn(scope, orderId);
}
